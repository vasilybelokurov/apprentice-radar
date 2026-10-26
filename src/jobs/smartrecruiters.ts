// Public Posting API: https://developers.smartrecruiters.com/docs/endpoints
import { z } from "zod";
import { haversineMiles } from "../lib/search.ts";
import type { Job } from "../lib/types.ts";
import { directJob, employerPay, fetchPublic, JOB_ORIGIN, JOB_RADIUS } from "./direct.ts";
import { locateNames } from "./locate.ts";

const coordinate = z.union([z.number(), z.string()]).nullish().transform((s) => s == null || s === "" ? null : Number(s))
  .refine((n) => n === null || Number.isFinite(n));
const Posting = z.object({
  id: z.string().min(1), name: z.string().min(1), releasedDate: z.iso.datetime(),
  location: z.object({
    city: z.string(), country: z.string(), address: z.string().optional(), postalCode: z.string().optional(),
    latitude: coordinate, longitude: coordinate,
  }),
  customField: z.array(z.object({ fieldLabel: z.string(), valueLabel: z.string().optional() })).default([]),
  typeOfEmployment: z.object({ id: z.string(), label: z.string() }).optional(),
});
const Page = z.object({ totalFound: z.number().int().nonnegative(), content: z.array(Posting) });
const Detail = Posting.extend({
  active: z.boolean(), postingUrl: z.url(),
  jobAd: z.object({ sections: z.record(z.string(), z.object({ text: z.string() })) }),
});
export type SmartDetail = z.infer<typeof Detail>;

export interface SmartSource {
  id: string;
  name: string;
  company: string;
  url: string;
}
export const SMART_SOURCES: SmartSource[] = [
  { id: "greene-king", name: "Greene King", company: "GreeneKing", url: "https://jobs.greeneking.co.uk/" },
  { id: "accor", name: "Accor hotels", company: "AccorHotel", url: "https://careers.accor.com/" },
];

export function smartAdvert(raw: unknown, source: SmartSource, today?: string): Job | null {
  const d = Detail.parse(raw);
  if (!d.active || d.location.country.toLowerCase() !== "gb") return null;
  if (new URL(d.postingUrl).hostname !== "jobs.smartrecruiters.com") throw new Error("Unexpected posting URL");
  const field = (...names: string[]) => d.customField.find((f) => names.includes(f.fieldLabel))?.valueLabel ?? null;
  const venue = field("Job Location", "Hotel Region Europe and North Africa");
  const payText = field("Salary Range (Advertising)") ?? field("Pay Range");
  const grade = field("Compensation Grade") ?? "";
  const payType = /hourly|per hour/i.test(`${grade} ${payText ?? ""}`) ? "per hour"
    : /per annum|per year|annual/i.test(payText ?? "") ? "per annum" : null;
  const schedule = field("Position Time Type", "Job Schedule") ?? d.typeOfEmployment?.label ?? "";
  const contractText = field("Team Member Sub-Type", "Job Type") ?? "";
  const contract = /fixed|contract/i.test(contractText) ? "Contract" : /temporary|casual/i.test(contractText) ? "Temporary"
    : /permanent/i.test(contractText) ? "Permanent" : null;
  // Job and qualification sections first: the card should describe the work, not corporate benefits.
  const sections = d.jobAd.sections;
  const description = ["jobDescription", "qualifications", "additionalInformation", "companyDescription"]
    .map((k) => sections[k]?.text ?? "").join("\n");
  return directJob({
    id: d.id, sourceId: source.id, sourceName: source.name, sector: "hospitality",
    title: d.name, employer: venue ? `${venue} · ${source.name}` : source.name,
    location: [d.location.address, d.location.city, d.location.postalCode].filter(Boolean).join(", "),
    lat: d.location.latitude, lon: d.location.longitude,
    preciseLocation: !!d.location.address || !!d.location.postalCode,
    posted: d.releasedDate.slice(0, 10), expires: null,
    pay: employerPay(payText && payType && !/per hour|hourly|per annum|per year|annual/i.test(payText) ? `${payText} ${payType}` : payText, payType),
    partTime: /part[ -]time/i.test(schedule) ? true : /full[ -]time/i.test(schedule) ? false : null,
    contract, url: d.postingUrl, description,
  }, today);
}

export async function syncSmartSource(source: SmartSource, doFetch: typeof fetch = fetch, today?: string): Promise<Job[]> {
  const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(source.company)}/postings`;
  const postings = new Map<string, z.infer<typeof Posting>>();
  let complete = false;
  for (let offset = 0; offset < 5000; offset += 100) {
    const q = new URLSearchParams({ country: "gb", city: "Cambridge", limit: "100", offset: String(offset) });
    const page = Page.parse(await (await fetchPublic(`${base}?${q}`, doFetch)).json());
    for (const posting of page.content) postings.set(posting.id, posting);
    if (offset + page.content.length >= page.totalFound) {
      if (postings.size < page.totalFound) throw new Error(`${source.name}: incomplete/duplicate search results`);
      complete = true;
      break;
    }
    if (page.content.length !== 100) throw new Error(`${source.name}: incomplete page`);
  }
  if (!complete) throw new Error(`${source.name}: pagination limit reached`);

  const jobs: Job[] = [];
  // Four at a time; fetch the full, current advert on every run so changes and withdrawals are respected.
  const items = [...postings.values()];
  for (let i = 0; i < items.length; i += 4) {
    const batch = await Promise.all(items.slice(i, i + 4).map(async (p) => {
      if (p.location.country.toLowerCase() !== "gb") return null;
      if (p.location.latitude !== null && p.location.longitude !== null &&
        haversineMiles(JOB_ORIGIN.lat, JOB_ORIGIN.lon, p.location.latitude, p.location.longitude) > JOB_RADIUS) return null;
      const raw = await (await fetchPublic(`${base}/${encodeURIComponent(p.id)}`, doFetch)).json();
      const d = Detail.parse(raw);
      if (d.id !== p.id) throw new Error("Posting ID changed between list and detail");
      if (d.location.latitude === null || d.location.longitude === null) {
        const place = d.location.postalCode || d.location.city;
        const coords = (await locateNames([place], JOB_ORIGIN, { fetch: doFetch })).get(place);
        d.location.latitude = coords?.lat ?? null;
        d.location.longitude = coords?.lon ?? null;
      }
      return smartAdvert(d, source, today);
    }));
    jobs.push(...batch.filter((j): j is Job => j !== null));
  }
  return jobs;
}
