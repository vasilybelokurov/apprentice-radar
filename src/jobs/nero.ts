// Caffè Nero's public search and JobPosting JSON-LD. The POST submits search filters only.
import { z } from "zod";
import { decodeEntities } from "../lib/jobs-fit.ts";
import type { Job } from "../lib/types.ts";
import { directJob, employerPay, fetchPublic, JOB_ORIGIN, JOB_RADIUS } from "./direct.ts";

const BASE = "https://careers.caffenero.com";
export const NERO = { id: "caffe-nero", name: "Caffè Nero", url: `${BASE}/search` };
interface NeroListing { id: string; path: string; salary: string; workingPattern: string }

export function neroListings(html: string): NeroListing[] {
  const count = /\bid=["']?vacancy-count-display["']?[^>]*>\s*(\d+)/i.exec(html);
  if (!count) throw new Error("Caffè Nero search count missing");
  const listings: NeroListing[] = [];
  const cards = [...html.matchAll(/<a\b[^>]*href=["']?(\/search\/(\d+)\/[\w-]+)["']?[^>]*>([\s\S]*?)<\/a>/gi)];
  for (const m of cards) {
    const fields = new Map<string, string>();
    for (const input of m[3]!.matchAll(/<input\b([^>]+)>/gi)) {
      const attrs = new Map([...input[1]!.matchAll(/([\w-]+)=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
        .map((a) => [a[1]!, decodeEntities(a[2] ?? a[3] ?? a[4] ?? "")]));
      if (attrs.has("name")) fields.set(attrs.get("name")!, attrs.get("value") ?? "");
    }
    if (!fields.has("salary") || !fields.has("workingPattern")) throw new Error("Caffè Nero result fields missing");
    listings.push({ id: m[2]!, path: m[1]!, salary: fields.get("salary")!, workingPattern: fields.get("workingPattern")! });
  }
  if (new Set(listings.map((j) => j.id)).size !== Number(count[1])) throw new Error("Caffè Nero results incomplete");
  return listings;
}

const Posting = z.object({
  "@type": z.literal("JobPosting"), title: z.string().min(1), url: z.url(), description: z.string().min(1),
  datePosted: z.string(), validThrough: z.string().nullish(), employmentType: z.string(),
  jobLocation: z.object({ address: z.object({
    streetAddress: z.string(), addressLocality: z.string(), postalCode: z.string(), addressCountry: z.string(),
    geo: z.object({ latitude: z.number(), longitude: z.number() }),
  }) }),
  baseSalary: z.object({ currency: z.literal("GBP"), value: z.object({ unitText: z.string() }) }).optional(),
});

function neroDate(s: string | null | undefined): string | null {
  if (!s?.trim()) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s|$)/.exec(s);
  if (!m) throw new Error("Unrecognised Caffè Nero date");
  return z.iso.date().parse(`${m[3]}-${m[2]}-${m[1]}`);
}

export function neroAdvert(html: string, listing: NeroListing, today?: string): Job | null {
  const scripts = [...html.matchAll(/<script\b[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)];
  const raw = scripts.map((s) => JSON.parse(s[1]!)).find((s) => s["@type"] === "JobPosting");
  const d = Posting.parse(raw);
  if (d.url !== `${BASE}${listing.path}`) throw new Error("Caffè Nero advert URL does not match listing");
  const a = d.jobLocation.address;
  if (!/^(United Kingdom|GB)$/i.test(a.addressCountry)) return null;
  const type = d.baseSalary?.value.unitText === "HOUR" ? "per hour" : null;
  // The JSON-LD amount is a ceiling when the actual listing says "to £…".
  const salary = listing.salary.replace(/^to\s+/i, "Up to ");
  return directJob({
    id: listing.id, sourceId: NERO.id, sourceName: NERO.name, sector: "hospitality", title: decodeEntities(d.title),
    employer: `Caffè Nero · ${decodeEntities(a.addressLocality)}`,
    location: `${decodeEntities(a.streetAddress)}, ${decodeEntities(a.addressLocality)}, ${a.postalCode}`,
    lat: a.geo.latitude, lon: a.geo.longitude, preciseLocation: true,
    posted: neroDate(d.datePosted), expires: neroDate(d.validThrough),
    pay: employerPay(type ? `${salary} ${type}` : salary, type),
    partTime: /part time/i.test(listing.workingPattern) ? true : /full time/i.test(listing.workingPattern) ? false : null,
    contract: /fixed/i.test(d.employmentType) ? "Contract" : d.employmentType,
    url: d.url, description: decodeEntities(d.description),
  }, today);
}

export async function syncNero(doFetch: typeof fetch = fetch, today?: string): Promise<Job[]> {
  const body = new URLSearchParams({
    Lat: String(JOB_ORIGIN.lat), Lng: String(JOB_ORIGIN.lon), distance: String(JOB_RADIUS),
    Keywords: "", sortBy: "distance", BusinessArea: "0", ContractType: "", IsRemote: "false", IsEvent: "false",
    ViewMode: "", BrandId: "", ShowFavorites: "",
  });
  const response = await fetchPublic(`${BASE}/search/searchvacancies`, doFetch, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "HX-Request": "true", Referer: NERO.url }, body,
  });
  const listings = neroListings(await response.text());
  const jobs: Job[] = [];
  for (const listing of listings) {
    const html = await (await fetchPublic(`${BASE}${listing.path}`, doFetch)).text();
    const job = neroAdvert(html, listing, today);
    if (job) jobs.push(job);
  }
  return jobs;
}
