// Public vacancy feed embedded in Downing College's staff-vacancies page.
import { z } from "zod";
import type { Job } from "../lib/types.ts";
import { directJob, fetchPublic } from "./direct.ts";
import { payText } from "./normalize.ts";

export const DOWNING = { id: "downing", name: "Downing College", url: "https://www.dow.cam.ac.uk/people/vacancies/staff-vacancies" };
const SETTINGS = "https://new-smart-feed.vacancy-filler.co.uk/Career_Page_Files/Downing%20College/vf-settings.dc.js";
const BASE = "https://sf.vacancy-filler.co.uk/CareerPage";
// This API sometimes JSON-encodes its payload twice, depending on the Accept header.
export const vacancyFillerJson = (raw: unknown): unknown => typeof raw === "string" ? JSON.parse(raw) : raw;
const Advert = z.object({
  Id: z.string(), JobTitle: z.string().min(1), Company: z.literal("Downing College"), Description: z.string().min(1),
  Link: z.url(), Location: z.string(), PostCode: z.string(),
  Latitude: z.string(), Longitude: z.string(),
  PostingDateISO: z.iso.datetime(), ExpiryDateISO: z.iso.datetime(),
  SalaryFrom: z.number().nullable(), SalaryTo: z.number().nullable(), SalaryPeriod: z.string(), Currency: z.string(),
  JobType: z.string(), JobTypeTime: z.string(), IsTestAdvert: z.boolean(),
});

export function downingAdvert(raw: unknown, today?: string): Job | null {
  const d = Advert.parse(raw);
  if (d.IsTestAdvert) return null;
  if (new URL(d.Link).hostname !== "app.vacancy-filler.co.uk") throw new Error("Unexpected Downing advert URL");
  const type = d.SalaryPeriod.toLowerCase() || null;
  const sterling = /^(£|&pound;|GBP)$/.test(d.Currency);
  const min = sterling ? d.SalaryFrom : null;
  const max = sterling ? d.SalaryTo : null;
  return directJob({
    id: d.Id, sourceId: DOWNING.id, sourceName: DOWNING.name, title: d.JobTitle.trim(), employer: d.Company,
    location: `${d.Location}, ${d.PostCode}`, preciseLocation: !!d.PostCode,
    lat: d.Latitude.trim() ? Number(d.Latitude) : null, lon: d.Longitude.trim() ? Number(d.Longitude) : null,
    posted: d.PostingDateISO.slice(0, 10), expires: d.ExpiryDateISO.slice(0, 10),
    pay: { text: sterling ? payText(min, max, type) : null, type, min, max, minYearly: type === "per annum" ? min : null },
    partTime: /part time/i.test(d.JobTypeTime) ? true : /full time/i.test(d.JobTypeTime) ? false : null,
    contract: d.JobType || null, url: d.Link, description: d.Description,
  }, today);
}

export async function syncDowning(doFetch: typeof fetch = fetch, today?: string): Promise<Job[]> {
  const settings = await (await fetchPublic(SETTINGS, doFetch)).text();
  // This is a public feed identifier published in the college's page, not a private API credential.
  const id = /['"]APIid['"]\s*:\s*['"]([\w-]+)['"]/.exec(settings)?.[1];
  if (!id) throw new Error("Downing public feed identifier missing");
  const ids = z.array(z.string().min(1)).max(500).parse(vacancyFillerJson(await (await fetchPublic(`${BASE}/GetResultList?${new URLSearchParams({ id })}`, doFetch)).json()));
  const jobs: Job[] = [];
  for (const itemId of new Set(ids)) {
    const raw = await (await fetchPublic(`${BASE}/GetItem?${new URLSearchParams({ id: itemId })}`, doFetch)).json();
    const d = Advert.parse(vacancyFillerJson(raw));
    if (d.Id !== itemId) throw new Error("Downing returned a different advert");
    const job = downingAdvert(d, today);
    if (job) jobs.push(job);
  }
  return jobs;
}
