// Fills in coordinates for locations the source gives without them, using Postcodes.io bulk lookup
// (POST /postcodes, up to 100 postcodes per request), then /terminated_postcodes for withdrawn ones.
// Best effort: failures leave coordinates null.
import { z } from "zod";
import type { Vacancy } from "../lib/types.ts";

export const POSTCODES_IO_URL = "https://api.postcodes.io";
const BATCH = 100;

const BulkResponse = z.object({
  result: z.array(
    z.object({
      query: z.string(),
      result: z.object({ latitude: z.number().nullable(), longitude: z.number().nullable() }).nullable(),
    }),
  ),
});

const TerminatedResponse = z.object({
  result: z.object({ latitude: z.number().nullable(), longitude: z.number().nullable() }),
});

const MAX_TERMINATED_LOOKUPS = 200;

export interface GeocodeSummary {
  missing: number;
  filled: number;
  failedBatches: number;
}

export async function fillMissingCoordinates(
  vacancies: Vacancy[],
  options: { fetch?: typeof fetch; baseUrl?: string; timeoutMs?: number } = {},
): Promise<GeocodeSummary> {
  const doFetch = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? POSTCODES_IO_URL;
  const targets = vacancies.flatMap((v) => v.locations).filter((l) => l.lat === null && l.postcode);
  const postcodes = [...new Set(targets.map((l) => l.postcode!))];
  const found = new Map<string, { lat: number; lon: number }>();
  let failedBatches = 0;

  for (let i = 0; i < postcodes.length; i += BATCH) {
    const batch = postcodes.slice(i, i + BATCH);
    try {
      const response = await doFetch(`${baseUrl}/postcodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postcodes: batch }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = BulkResponse.parse(await response.json());
      for (const r of parsed.result) {
        if (r.result?.latitude != null && r.result.longitude != null) {
          found.set(r.query.toUpperCase(), { lat: r.result.latitude, lon: r.result.longitude });
        }
      }
    } catch (error) {
      failedBatches++;
      console.warn(`postcode lookup batch failed: ${String(error)}`);
    }
  }

  // Employers sometimes give withdrawn postcodes; Postcodes.io keeps their last known coordinates.
  // There is no bulk endpoint for these, so look them up one by one (capped).
  const unresolved = postcodes.filter((p) => !found.has(p)).slice(0, MAX_TERMINATED_LOOKUPS);
  for (const postcode of unresolved) {
    try {
      const response = await doFetch(`${baseUrl}/terminated_postcodes/${encodeURIComponent(postcode)}`, {
        signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
      });
      if (response.status === 404) continue; // not a known terminated postcode either
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = TerminatedResponse.parse(await response.json());
      if (parsed.result.latitude != null && parsed.result.longitude != null) {
        found.set(postcode, { lat: parsed.result.latitude, lon: parsed.result.longitude });
      }
    } catch (error) {
      failedBatches++;
      console.warn(`terminated postcode lookup failed: ${String(error)}`);
    }
  }

  let filled = 0;
  for (const loc of targets) {
    const hit = found.get(loc.postcode!);
    if (hit) {
      loc.lat = hit.lat;
      loc.lon = hit.lon;
      filled++;
    }
  }
  return { missing: targets.length, filled, failedBatches };
}
