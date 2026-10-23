// Places Reed job locations (a postcode such as "CB10AN", or a place name such as "Royston") with
// Postcodes.io. A name with several matches resolves to the one nearest the search origin, since
// Reed returned the job for a search around that origin. Vague areas ("Cambridgeshire", "United
// Kingdom") are left unplaced.
import { z } from "zod";
import { haversineMiles, type Place } from "../lib/search.ts";

export const POSTCODES_IO_URL = "https://api.postcodes.io";
const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
/** Areas too large to give a distance for. */
export const VAGUE_LOCATIONS = /^(united kingdom|uk|england|great britain|remote|nationwide|cambridgeshire|hertfordshire|essex|suffolk|norfolk|bedfordshire|east of england|east anglia)$/i;

export interface Coordinates {
  lat: number;
  lon: number;
}

const BulkResponse = z.object({
  result: z.array(z.object({ query: z.string(), result: z.object({ latitude: z.number().nullable(), longitude: z.number().nullable() }).nullable() })),
});
const PlacesResponse = z.object({
  result: z.array(z.object({ name_1: z.string(), latitude: z.number(), longitude: z.number() })).nullable(),
});

const normalName = (s: string) => s.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();

export async function locateNames(
  names: string[],
  origin: Place,
  options: { fetch?: typeof fetch; baseUrl?: string; timeoutMs?: number } = {},
): Promise<Map<string, Coordinates | null>> {
  const doFetch = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? POSTCODES_IO_URL;
  const timeout = () => AbortSignal.timeout(options.timeoutMs ?? 20_000);
  const out = new Map<string, Coordinates | null>();
  const unique = [...new Set(names)];

  const postcodes = unique.filter((n) => POSTCODE.test(n.trim()));
  for (let i = 0; i < postcodes.length; i += 100) {
    const batch = postcodes.slice(i, i + 100);
    try {
      const r = await doFetch(`${baseUrl}/postcodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postcodes: batch.map((p) => p.trim()) }),
        signal: timeout(),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const parsed = BulkResponse.parse(await r.json());
      parsed.result.forEach((row, k) => {
        const lat = row.result?.latitude;
        const lon = row.result?.longitude;
        out.set(batch[k]!, lat != null && lon != null ? { lat, lon } : null);
      });
    } catch (error) {
      console.warn(`postcode lookup failed: ${String(error)}`);
    }
  }

  for (const name of unique) {
    if (out.has(name) || POSTCODE.test(name.trim())) continue;
    if (!name.trim() || VAGUE_LOCATIONS.test(name.trim())) {
      out.set(name, null);
      continue;
    }
    try {
      const r = await doFetch(`${baseUrl}/places?q=${encodeURIComponent(name.trim())}&limit=50`, { signal: timeout() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const places = PlacesResponse.parse(await r.json()).result ?? [];
      const exact = places.filter((p) => normalName(p.name_1) === normalName(name));
      let best: Coordinates | null = null;
      let bestMiles = Infinity;
      for (const p of exact) {
        const miles = haversineMiles(origin.lat, origin.lon, p.latitude, p.longitude);
        if (miles < bestMiles) {
          bestMiles = miles;
          best = { lat: p.latitude, lon: p.longitude };
        }
      }
      out.set(name, best);
    } catch (error) {
      console.warn(`place lookup failed for "${name}": ${String(error)}`);
    }
  }
  return out;
}
