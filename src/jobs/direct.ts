// Shared rules for employer feeds. No credentials or application submissions are involved.
import { htmlToText, jobFit } from "../lib/jobs-fit.ts";
import { haversineMiles } from "../lib/search.ts";
import type { Job } from "../lib/types.ts";

export const JOB_ORIGIN = { label: "Cambridge, Cambridgeshire", lat: 52.20486, lon: 0.11968 };
export const JOB_RADIUS = 5;

export interface DirectAdvert {
  id: string;
  sourceId: string;
  sourceName: string;
  sector?: "hospitality";
  title: string;
  employer: string;
  location: string;
  lat: number | null;
  lon: number | null;
  preciseLocation: boolean;
  posted: string | null;
  expires: string | null;
  pay: Job["pay"];
  partTime: boolean | null;
  contract: string | null;
  url: string;
  description: string;
}

export function directJob(ad: DirectAdvert, today = new Date().toISOString().slice(0, 10)): Job | null {
  if (ad.expires && ad.expires < today) return null;
  const url = new URL(ad.url);
  if (url.protocol !== "https:") throw new Error("Employer advert must have an HTTPS URL");
  const located = ad.lat !== null && ad.lon !== null && Number.isFinite(ad.lat) && Number.isFinite(ad.lon)
    && Math.abs(ad.lat) <= 90 && Math.abs(ad.lon) <= 180;
  const miles = located ? haversineMiles(JOB_ORIGIN.lat, JOB_ORIGIN.lon, ad.lat!, ad.lon!) : null;
  if (miles !== null && miles > JOB_RADIUS) return null;
  const text = htmlToText(ad.description);
  if (!text.trim()) throw new Error(`Missing advert text for ${ad.id}`);
  const fit = jobFit({ ...ad, text });
  if (miles === null) {
    fit.suitable = false;
    fit.reasons.push("Location could not be placed within 5 miles of Cambridge");
    fit.evidence.push(ad.location);
  }
  const { description: _description, ...fields } = ad;
  const flat = text.replace(/\s+/g, " ");
  return {
    ...fields,
    id: `${ad.sourceId}:${ad.id}`,
    miles: miles === null ? null : Math.round(miles * 100) / 100,
    summary: flat.length > 280 ? `${flat.slice(0, 280).replace(/\s+\S*$/, "")}…` : flat,
    fullAdvert: true,
    fit,
  };
}

/** Retries transient failures only; a broken page/schema must not look like an empty feed. */
export async function fetchPublic(url: string, doFetch: typeof fetch = fetch, init: RequestInit = {}): Promise<Response> {
  let failure: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await doFetch(url, { ...init, signal: AbortSignal.timeout(25_000), headers: { Accept: "application/json, text/html", ...init.headers } });
      if (r.ok) return r;
      if (r.status !== 429 && r.status < 500) throw new PermanentFetchError(`HTTP ${r.status} from ${url}`);
      failure = new Error(`HTTP ${r.status} from ${url}`);
    } catch (e) {
      if (e instanceof PermanentFetchError) throw e;
      failure = e;
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
  throw failure;
}
class PermanentFetchError extends Error {}

/** Preserve source wording and distinguish an advertised ceiling from a minimum. */
export function employerPay(text: string | null, type: string | null): Job["pay"] {
  const figures = [...(text ?? "").matchAll(/£\s*([\d,]+(?:\.\d+)?)/g)].map((m) => Number(m[1]!.replaceAll(",", "")));
  const ceiling = /\bup\s*to\b/i.test(text ?? "");
  const min = ceiling ? null : figures[0] ?? null;
  const max = figures.at(-1) ?? null;
  return { text, type, min, max, minYearly: type === "per annum" ? min : null };
}
