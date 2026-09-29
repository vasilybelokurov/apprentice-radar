import { describe, expect, it } from "vitest";
import {
  criteriaFromParams,
  criteriaToParams,
  defaultCriteria,
  haversineMiles,
  nearestLocation,
  search,
  type SearchCriteria,
} from "../src/lib/search.ts";
import type { Vacancy } from "../src/lib/types.ts";

const NOW = Date.parse("2026-09-29T12:00:00Z");
const CAMBRIDGE = { label: "Cambridge, Cambridgeshire", lat: 52.2049, lon: 0.1197 };
// Reference points (approximate town centres).
const ELY = { lat: 52.3995, lon: 0.2624 }; // ~14.9 miles from Cambridge
const LONDON = { lat: 51.5074, lon: -0.1278 }; // ~49 miles from Cambridge

let seq = 0;
function vac(over: Partial<Vacancy> & { at?: { lat: number; lon: number }[] } = {}): Vacancy {
  const { at, ...rest } = over;
  seq++;
  return {
    ref: String(1000 + seq),
    title: "Apprentice",
    employer: "Acme Ltd",
    provider: "College",
    description: "A role.",
    course: { title: "Course", level: 2, route: "Digital", type: "Standard" },
    levelName: "Intermediate",
    posted: "2026-09-20T00:00:00.000Z",
    closes: "2026-10-30T23:59:59.000Z",
    starts: null,
    hoursPerWeek: 37.5,
    duration: "1 year",
    positions: 1,
    pay: { type: "ApprenticeshipMinimum", text: "£16,640 a year", minAnnual: 16640, maxAnnual: 16640 },
    locations: (at ?? [{ lat: 52.2, lon: 0.12 }]).map((p, i) => ({ label: `Place ${i}`, postcode: null, ...p })),
    national: false,
    disabilityConfident: false,
    url: "https://example.org",
    ...rest,
  };
}
// Tests use a 20-mile radius so Ely (~14.9 miles) is inside unless a test says otherwise.
const crit = (over: Partial<SearchCriteria> = {}): SearchCriteria => ({ ...defaultCriteria(), place: CAMBRIDGE, radiusMiles: 20, ...over });
const refs = (vs: Vacancy[], c: SearchCriteria) => search(vs, c, NOW).map((m) => m.vacancy.ref);

describe("distance", () => {
  it("haversine gives known distances", () => {
    expect(haversineMiles(CAMBRIDGE.lat, CAMBRIDGE.lon, ELY.lat, ELY.lon)).toBeCloseTo(14.9, 0);
    expect(haversineMiles(CAMBRIDGE.lat, CAMBRIDGE.lon, LONDON.lat, LONDON.lon)).toBeCloseTo(49, 0);
    expect(haversineMiles(1, 2, 1, 2)).toBe(0);
    // One degree of latitude along a meridian = 2*pi*R/360 = 69.09 miles.
    expect(haversineMiles(0, 0, 1, 0)).toBeCloseTo(69.09, 1);
  });

  it("nearest location skips missing coordinates", () => {
    const v = vac({ at: [LONDON, ELY] });
    v.locations.unshift({ label: "unknown", postcode: null, lat: null, lon: null });
    const n = nearestLocation(v.locations, CAMBRIDGE)!;
    expect(n.location.label).toBe("Place 1");
    expect(n.miles).toBeCloseTo(14.9, 0);
  });
});

describe("search filters", () => {
  it("excludes closed vacancies", () => {
    const open = vac();
    const closed = vac({ closes: "2026-09-29T11:59:59.000Z" });
    expect(refs([open, closed], crit())).toEqual([open.ref]);
  });

  it("defaults to Level 2 and includes Foundation courses at that level", () => {
    const l2 = vac();
    const l2f = vac({ course: { title: "F", level: 2, route: "Digital", type: "Foundation" } });
    const l3 = vac({ course: { title: "C", level: 3, route: "Digital", type: "Standard" } });
    expect(refs([l2, l2f, l3], crit()).sort()).toEqual([l2.ref, l2f.ref].sort());
    expect(refs([l2, l2f, l3], crit({ levels: [2, 3] }))).toHaveLength(3);
    expect(refs([l2, l2f, l3], crit({ levels: [] }))).toHaveLength(3); // any level
    expect(refs([l2, l2f, l3], crit({ foundationOnly: true }))).toEqual([l2f.ref]);
  });

  it("matches a multi-location vacancy if any location is inside the radius, once", () => {
    const multi = vac({ at: [LONDON, ELY] });
    const results = search([multi], crit({ radiusMiles: 20 }), NOW);
    expect(results).toHaveLength(1);
    expect(results[0]!.nearest!.miles).toBeCloseTo(14.9, 0);
    expect(search([multi], crit({ radiusMiles: 10 }), NOW)).toHaveLength(0);
  });

  it("radius is inclusive and uses the nearest location", () => {
    const ely = vac({ at: [ELY] });
    const d = haversineMiles(CAMBRIDGE.lat, CAMBRIDGE.lon, ELY.lat, ELY.lon);
    expect(search([ely], crit({ radiusMiles: d }), NOW)).toHaveLength(1);
    expect(search([ely], crit({ radiusMiles: d - 0.01 }), NOW)).toHaveLength(0);
  });

  it("excludes located searches for vacancies with no usable coordinates", () => {
    const v = vac();
    v.locations = [{ label: "x", postcode: "ZZ9 9ZZ", lat: null, lon: null }];
    expect(search([v], crit(), NOW)).toHaveLength(0);
    expect(search([v], crit({ place: null }), NOW)).toHaveLength(1);
  });

  it("national vacancies appear only when asked, with no distance, after located ones", () => {
    const nat = vac({ national: true, at: [] });
    const local = vac({ at: [ELY] });
    expect(refs([nat, local], crit())).toEqual([local.ref]);
    const withNat = search([nat, local], crit({ includeNational: true }), NOW);
    expect(withNat.map((m) => m.vacancy.ref)).toEqual([local.ref, nat.ref]);
    expect(withNat[1]!.nearest).toBeNull();
  });

  it("filters by category", () => {
    const a = vac();
    const b = vac({ course: { title: "C", level: 2, route: "Care services", type: "Standard" } });
    expect(refs([a, b], crit({ routes: ["Care services"] }))).toEqual([b.ref]);
  });

  it("keywords: every word must appear, case- and accent-insensitive, across title/employer/course/description", () => {
    const a = vac({ title: "Software Developer", employer: "Café Systems" });
    const b = vac({ title: "Electrician" });
    expect(refs([a, b], crit({ keywords: "software cafe" }))).toEqual([a.ref]);
    expect(refs([a, b], crit({ keywords: "SOFTWARE plumber" }))).toEqual([]);
    expect(refs([a, b], crit({ keywords: "  " }))).toHaveLength(2);
  });

  it("employer filter is a case-insensitive substring match", () => {
    const a = vac({ employer: "Addenbrooke's Hospital" });
    const b = vac({ employer: "Acme" });
    expect(refs([a, b], crit({ employer: "addenbrooke" }))).toEqual([a.ref]);
  });

  it("minimum pay keeps unknown pay unless told otherwise", () => {
    const low = vac();
    const high = vac({ pay: { type: "Custom", text: "£25,000 a year", minAnnual: 25000, maxAnnual: 25000 } });
    const comp = vac({ pay: { type: "CompetitiveSalary", text: "Competitive", minAnnual: null, maxAnnual: null } });
    const range = vac({ pay: { type: "NationalMinimum", text: "£12,480 to £19,827.60 a year", minAnnual: 12480, maxAnnual: 19827.6 } });
    const all = [low, high, comp, range];
    expect(refs(all, crit({ minPay: 20000 })).sort()).toEqual([high.ref, comp.ref].sort());
    expect(refs(all, crit({ minPay: 20000, includeUnknownPay: false }))).toEqual([high.ref]);
    expect(refs(all, crit({ minPay: 15000 })).sort()).toEqual([low.ref, high.ref, comp.ref].sort()); // range uses lower end
    expect(refs(all, crit())).toHaveLength(4); // no minimum: everything
  });

  it("Disability Confident filter", () => {
    const a = vac({ disabilityConfident: true });
    const b = vac();
    expect(refs([a, b], crit({ disabilityConfidentOnly: true }))).toEqual([a.ref]);
  });
});

describe("sorting", () => {
  const near = vac({ at: [{ lat: 52.21, lon: 0.12 }], posted: "2026-09-01T00:00:00.000Z", closes: "2026-12-01T00:00:00.000Z" });
  const mid = vac({ at: [ELY], posted: "2026-09-25T00:00:00.000Z", closes: "2026-10-05T00:00:00.000Z", pay: { type: "Custom", text: "£30,000 a year", minAnnual: 30000, maxAnnual: 30000 } });
  const comp = vac({ at: [ELY], pay: { type: "CompetitiveSalary", text: "Competitive", minAnnual: null, maxAnnual: null } });
  const all = [comp, mid, near];

  it("distance", () => expect(refs(all, crit({ sort: "distance" }))[0]).toBe(near.ref));
  it("newest", () => expect(refs(all, crit({ sort: "newest" }))[0]).toBe(mid.ref));
  it("closing soonest", () => expect(refs(all, crit({ sort: "closing" }))[0]).toBe(mid.ref));
  it("pay: highest first, no figure last", () => expect(refs(all, crit({ sort: "pay" }))).toEqual([mid.ref, near.ref, comp.ref]));
  it("distance without a place falls back to newest", () => expect(refs(all, crit({ place: null }))[0]).toBe(mid.ref));

  it("is deterministic and paging-safe: same input gives same order, no duplicates", () => {
    const many = Array.from({ length: 120 }, () => vac({ at: [ELY] })); // identical distance and date
    const a = refs(many, crit());
    const b = refs([...many].reverse(), crit());
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(120);
    const pages = [a.slice(0, 25), a.slice(25, 50), a.slice(50)];
    expect(pages.flat()).toEqual(a);
  });
});

describe("URL state", () => {
  it("round-trips a full search", () => {
    const c = crit({ radiusMiles: 30, levels: [2, 3], routes: ["Digital"], keywords: "software", employer: "acme", minPay: 18000, includeUnknownPay: false, disabilityConfidentOnly: true, foundationOnly: true, includeNational: true, sort: "pay" });
    const back = criteriaFromParams(new URLSearchParams(criteriaToParams(c).toString()));
    expect(back).toEqual({ ...c, place: { label: CAMBRIDGE.label, lat: 52.2049, lon: 0.1197 } });
  });

  it("defaults when empty: Level 2, 5 miles, nearest first, unknown pay included", () => {
    expect(criteriaFromParams(new URLSearchParams())).toEqual(defaultCriteria());
    expect(defaultCriteria()).toMatchObject({ levels: [2], radiusMiles: 5, sort: "distance", includeUnknownPay: true, includeNational: false, place: null });
  });

  it("keeps default values out of the URL", () => {
    expect(criteriaToParams(defaultCriteria()).toString()).toBe("");
  });

  it("'any' level round-trips", () => {
    const p = criteriaToParams(crit({ levels: [] }));
    expect(p.get("lvl")).toBe("any");
    expect(criteriaFromParams(p).levels).toEqual([]);
  });

  it("rejects invalid values", () => {
    const c = criteriaFromParams(new URLSearchParams("lat=999&lon=0&r=-5&lvl=9,x&sort=evil&minpay=abc"));
    expect(c.place).toBeNull();
    expect(c.radiusMiles).toBe(5);
    expect(c.levels).toEqual([2]);
    expect(c.sort).toBe("distance");
    expect(c.minPay).toBeNull();
  });
});
