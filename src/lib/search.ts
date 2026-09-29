// Search criteria, URL (de)serialisation, matching, distance and sorting.
// Shared by the web page and the alert job so both select exactly the same vacancies.
import type { Location, Vacancy } from "./types.ts";

export const LEVELS = [2, 3, 4, 5, 6, 7] as const;
export const SORTS = ["distance", "newest", "closing", "pay"] as const;
export type Sort = (typeof SORTS)[number];

export const DEFAULT_LOCATION_QUERY = "Cambridge, Cambridgeshire";
export const DEFAULT_RADIUS_MILES = 20;
export const MAX_RADIUS_MILES = 300;
export const DEFAULT_LEVELS = [2];

export interface Place {
  label: string;
  lat: number;
  lon: number;
}

export interface SearchCriteria {
  place: Place | null;
  radiusMiles: number;
  /** Empty means any level. */
  levels: number[];
  /** Empty means any route (category). */
  routes: string[];
  keywords: string;
  employer: string;
  /** Minimum yearly pay, compared with the lower end of the source figure. */
  minPay: number | null;
  /** When a minimum pay is set: also show vacancies with no figure (e.g. "Competitive"). */
  includeUnknownPay: boolean;
  disabilityConfidentOnly: boolean;
  foundationOnly: boolean;
  includeNational: boolean;
  sort: Sort;
}

export const defaultCriteria = (): SearchCriteria => ({
  place: null,
  radiusMiles: DEFAULT_RADIUS_MILES,
  levels: [...DEFAULT_LEVELS],
  routes: [],
  keywords: "",
  employer: "",
  minPay: null,
  includeUnknownPay: true,
  disabilityConfidentOnly: false,
  foundationOnly: false,
  includeNational: false,
  sort: "distance",
});

// ---------- distance ----------

/** Mean Earth radius (IUGG): 6371.0088 km = 3958.7613 miles (1 mile = 1.609344 km exactly). */
export const EARTH_RADIUS_MILES = 6371.0088 / 1.609344;

export function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface Nearest {
  location: Location;
  miles: number;
}

/** Nearest location with coordinates, or null (national vacancy / no usable coordinates). */
export function nearestLocation(locations: Location[], place: Place): Nearest | null {
  let best: Nearest | null = null;
  for (const location of locations) {
    if (location.lat === null || location.lon === null) continue;
    const miles = haversineMiles(place.lat, place.lon, location.lat, location.lon);
    if (!best || miles < best.miles) best = { location, miles };
  }
  return best;
}

// ---------- matching ----------

export interface Match {
  vacancy: Vacancy;
  /** Null when no place is set, or for national vacancies. */
  nearest: Nearest | null;
}

const normalizeText = (s: string) => s.toLocaleLowerCase("en-GB").normalize("NFKD").replace(/[̀-ͯ]/g, "");

function searchableText(v: Vacancy): string {
  return normalizeText([v.title, v.employer, v.course.title, v.course.route, v.description].filter(Boolean).join(" \u0000 "));
}

export function isOpen(v: Vacancy, now: number): boolean {
  return Date.parse(v.closes) >= now;
}

export function matchVacancy(v: Vacancy, c: SearchCriteria, now: number): Match | null {
  if (!isOpen(v, now)) return null;
  if (c.levels.length && (v.course.level === null || !c.levels.includes(v.course.level))) return null;
  if (c.routes.length && (v.course.route === null || !c.routes.includes(v.course.route))) return null;
  if (c.disabilityConfidentOnly && !v.disabilityConfident) return null;
  if (c.foundationOnly && v.course.type !== "Foundation") return null;

  if (c.minPay !== null) {
    if (v.pay.minAnnual === null) {
      if (!c.includeUnknownPay) return null;
    } else if (v.pay.minAnnual < c.minPay) {
      return null;
    }
  }

  const employer = normalizeText(c.employer.trim());
  if (employer && !normalizeText(v.employer ?? "").includes(employer)) return null;

  const words = normalizeText(c.keywords).split(/\s+/).filter(Boolean);
  if (words.length) {
    const text = searchableText(v);
    if (!words.every((w) => text.includes(w))) return null;
  }

  if (v.national) return c.includeNational ? { vacancy: v, nearest: null } : null;
  if (!c.place) return { vacancy: v, nearest: null };
  const nearest = nearestLocation(v.locations, c.place);
  if (!nearest || nearest.miles > c.radiusMiles) return null;
  return { vacancy: v, nearest };
}

function compare(a: Match, b: Match, sort: Sort): number {
  const byRef = a.vacancy.ref.localeCompare(b.vacancy.ref);
  switch (sort) {
    case "distance": {
      // Located vacancies first by distance; national ones (no distance) after, newest first.
      const da = a.nearest?.miles ?? Infinity;
      const db = b.nearest?.miles ?? Infinity;
      if (da !== db) return da - db;
      return b.vacancy.posted.localeCompare(a.vacancy.posted) || byRef;
    }
    case "newest":
      return b.vacancy.posted.localeCompare(a.vacancy.posted) || byRef;
    case "closing":
      return a.vacancy.closes.localeCompare(b.vacancy.closes) || byRef;
    case "pay": {
      // Explicit figures first, highest first; vacancies with no figure last.
      const pa = a.vacancy.pay.minAnnual ?? -Infinity;
      const pb = b.vacancy.pay.minAnnual ?? -Infinity;
      if (pa !== pb) return pb - pa;
      return byRef;
    }
  }
}

export function search(vacancies: Vacancy[], c: SearchCriteria, now = Date.now()): Match[] {
  const matches: Match[] = [];
  for (const v of vacancies) {
    const m = matchVacancy(v, c, now);
    if (m) matches.push(m);
  }
  const sort = c.sort === "distance" && !c.place ? "newest" : c.sort;
  return matches.sort((a, b) => compare(a, b, sort));
}

// ---------- URL state ----------

const clampNumber = (raw: string | null, min: number, max: number): number | null => {
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

/** Parses URL search params; invalid values fall back to defaults, never throw. */
export function criteriaFromParams(params: URLSearchParams): SearchCriteria {
  const c = defaultCriteria();
  const lat = clampNumber(params.get("lat"), -90, 90);
  const lon = clampNumber(params.get("lon"), -180, 180);
  const label = (params.get("loc") ?? "").trim().slice(0, 120);
  if (lat !== null && lon !== null) c.place = { label: label || `${lat.toFixed(3)}, ${lon.toFixed(3)}`, lat, lon };

  c.radiusMiles = clampNumber(params.get("r"), 1, MAX_RADIUS_MILES) ?? DEFAULT_RADIUS_MILES;
  if (params.has("lvl")) {
    const raw = params.get("lvl")!;
    c.levels = raw === "any" ? [] : [...new Set(raw.split(",").map(Number))].filter((n) => (LEVELS as readonly number[]).includes(n)).sort();
    if (raw !== "any" && c.levels.length === 0) c.levels = [...DEFAULT_LEVELS];
  }
  c.routes = [...new Set(params.getAll("route").map((r) => r.trim()).filter(Boolean))].slice(0, 20);
  c.keywords = (params.get("q") ?? "").slice(0, 100);
  c.employer = (params.get("emp") ?? "").slice(0, 100);
  c.minPay = clampNumber(params.get("minpay"), 0, 1_000_000);
  c.includeUnknownPay = params.get("unk") !== "0";
  c.disabilityConfidentOnly = params.get("dc") === "1";
  c.foundationOnly = params.get("fdn") === "1";
  c.includeNational = params.get("nat") === "1";
  const sort = params.get("sort");
  if (sort && (SORTS as readonly string[]).includes(sort)) c.sort = sort as Sort;
  return c;
}

/** Serialises only values that differ from the defaults, so URLs stay short. */
export function criteriaToParams(c: SearchCriteria): URLSearchParams {
  const d = defaultCriteria();
  const p = new URLSearchParams();
  if (c.place) {
    p.set("loc", c.place.label);
    p.set("lat", c.place.lat.toFixed(5));
    p.set("lon", c.place.lon.toFixed(5));
  }
  if (c.radiusMiles !== d.radiusMiles) p.set("r", String(c.radiusMiles));
  const levels = [...c.levels].sort().join(",");
  if (levels !== d.levels.join(",")) p.set("lvl", levels || "any");
  for (const r of c.routes) p.append("route", r);
  if (c.keywords.trim()) p.set("q", c.keywords.trim());
  if (c.employer.trim()) p.set("emp", c.employer.trim());
  if (c.minPay !== null) p.set("minpay", String(c.minPay));
  if (!c.includeUnknownPay) p.set("unk", "0");
  if (c.disabilityConfidentOnly) p.set("dc", "1");
  if (c.foundationOnly) p.set("fdn", "1");
  if (c.includeNational) p.set("nat", "1");
  if (c.sort !== d.sort) p.set("sort", c.sort);
  return p;
}
