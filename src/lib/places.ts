// Resolves a UK place name or postcode to coordinates via Postcodes.io (no key; CORS open).
// Returns every plausible match so the UI can ask the user to choose when a name is ambiguous.
import type { Place } from "./search.ts";

export const POSTCODES_IO_URL = "https://api.postcodes.io";

const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const OUTCODE = /^[A-Z]{1,2}\d[A-Z\d]?$/i;

/** Settlement types, most likely intended first. */
const TYPE_RANK: Record<string, number> = { City: 0, Town: 1, "Suburban Area": 2, Village: 3, "Other Settlement": 4, Hamlet: 5 };

interface PlaceResult {
  name_1: string;
  local_type: string;
  county_unitary: string | null;
  district_borough: string | null;
  region: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
}

export interface PlaceChoice extends Place {
  detail: string;
}

type Fetch = typeof fetch;

async function getJson(fetchImpl: Fetch, url: string): Promise<{ status: number; body: any }> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
  return { status: response.status, body: response.status === 404 ? null : await response.json() };
}

export function rankPlaces(results: PlaceResult[], query: string): PlaceChoice[] {
  const [namePart = "", areaPart = ""] = query.split(",").map((s) => s.trim().toLowerCase());
  const area = areaPart;
  const filtered = results.filter((r) => {
    if (!area) return true;
    return [r.county_unitary, r.district_borough, r.region, r.country].some((x) => x?.toLowerCase().includes(area));
  });
  const pool = filtered.length ? filtered : results;
  const exact = pool.filter((r) => r.name_1.toLowerCase() === namePart);
  const candidates = (exact.length ? exact : pool).filter((r) => r.local_type in TYPE_RANK);
  candidates.sort((a, b) => (TYPE_RANK[a.local_type] ?? 9) - (TYPE_RANK[b.local_type] ?? 9));
  return candidates.slice(0, 8).map((r) => {
    const county = r.county_unitary ?? r.district_borough;
    return {
      label: county ? `${r.name_1}, ${county}` : r.name_1,
      detail: [r.local_type, r.region, r.country].filter(Boolean).join(" · "),
      lat: r.latitude,
      lon: r.longitude,
    };
  });
}

/**
 * Returns candidate places for a query. A single result means it is unambiguous;
 * a place name with a clear City/Town winner is also returned alone.
 */
export async function resolvePlace(query: string, fetchImpl: Fetch = fetch): Promise<PlaceChoice[]> {
  const q = query.trim();
  if (!q) return [];
  if (POSTCODE.test(q)) {
    const { status, body } = await getJson(fetchImpl, `${POSTCODES_IO_URL}/postcodes/${encodeURIComponent(q)}`);
    if (status === 200 && body?.result) {
      const r = body.result;
      return [{ label: r.postcode, detail: [r.admin_district, r.region ?? r.country].filter(Boolean).join(" · "), lat: r.latitude, lon: r.longitude }];
    }
    return [];
  }
  if (OUTCODE.test(q)) {
    const { status, body } = await getJson(fetchImpl, `${POSTCODES_IO_URL}/outcodes/${encodeURIComponent(q)}`);
    if (status === 200 && body?.result?.latitude != null) {
      const r = body.result;
      return [{ label: r.outcode, detail: (r.admin_district ?? []).slice(0, 2).join(", "), lat: r.latitude, lon: r.longitude }];
    }
  }
  const name = q.split(",")[0]!.trim();
  const { status, body } = await getJson(fetchImpl, `${POSTCODES_IO_URL}/places?q=${encodeURIComponent(name)}&limit=50`);
  if (status !== 200 || !Array.isArray(body?.result)) return [];
  const ranked = rankPlaces(body.result as PlaceResult[], q);
  // One clear city/town among exact-name matches: pick it without asking.
  const top = ranked.filter((p) => p.detail.startsWith("City") || p.detail.startsWith("Town"));
  if (q.includes(",") && ranked.length) return [ranked[0]!];
  if (top.length === 1) return [top[0]!];
  return ranked;
}
