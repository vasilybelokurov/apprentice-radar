// Converts Reed search results and job details into the published Job model.
import { decodeEntities, htmlToText, jobFit, titleReasons } from "../lib/jobs-fit.ts";
import type { Job } from "../lib/types.ts";
import type { ReedDetails, ReedSearchItem } from "./reed-client.ts";

const SUMMARY_CHARS = 280;

/** Reed dates are dd/mm/yyyy; returns an ISO date (yyyy-mm-dd) or null. */
export function reedDate(s: string | null | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((s ?? "").trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

const money = (n: number) => (Number.isInteger(n) ? `£${n.toLocaleString("en-GB")}` : `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** "£14.24 - £15.00 per hour" from figures, when Reed gives no salary text. */
export function payText(min: number | null, max: number | null, type: string | null): string | null {
  if (min === null && max === null) return null;
  const range = min !== null && max !== null && max !== min ? `${money(min)} - ${money(max)}` : money((min ?? max)!);
  return type ? `${range} ${type}` : range;
}

const httpsUrl = (url: string | null | undefined, id: number) => {
  try {
    const u = new URL(url ?? "");
    if (u.protocol === "https:" && u.hostname.endsWith("reed.co.uk")) return u.toString();
  } catch {
    // fall through
  }
  return `https://www.reed.co.uk/jobs/${id}`;
};

function summary(text: string): string | null {
  const flat = text.replace(/\s*\n\s*/g, " ").replace(/•\s*/g, "").trim();
  if (!flat) return null;
  return flat.length <= SUMMARY_CHARS ? flat : `${flat.slice(0, SUMMARY_CHARS).replace(/\s+\S*$/, "")}…`;
}

export interface Placed {
  lat: number | null;
  lon: number | null;
  miles: number | null;
}

/** Verdict for a job whose advert was not read: its location or title already rules it out. */
function unread(title: string, extraReasons: string[]): Job["fit"] {
  const reasons = [...extraReasons];
  const evidence = extraReasons.map(() => "Location given by Reed");
  for (const r of titleReasons(title)) {
    reasons.push(r);
    evidence.push(`Job title: ${title}`);
  }
  return { suitable: false, reasons, evidence, labels: [] };
}

/** A job ruled out by its title or location: no details needed. */
export function jobFromSearch(item: ReedSearchItem, placed: Placed, extraReasons: string[] = []): Job {
  const text = htmlToText(item.jobDescription ?? "");
  const type = null;
  const min = item.minimumSalary ?? null;
  const max = item.maximumSalary ?? null;
  return {
    id: String(item.jobId),
    title: decodeEntities(item.jobTitle).trim(),
    employer: item.employerName ? decodeEntities(item.employerName).trim() || null : null,
    location: item.locationName?.trim() || "Not given",
    ...placed,
    posted: reedDate(item.date),
    expires: reedDate(item.expirationDate),
    pay: { text: payText(min, max, type), type, min, max, minYearly: null },
    partTime: null,
    contract: null,
    summary: summary(text),
    url: httpsUrl(item.jobUrl, item.jobId),
    fullAdvert: false,
    fit: unread(decodeEntities(item.jobTitle), extraReasons),
  };
}

/** A job read in full: the suitability rule runs on the whole advert. */
export function jobFromDetails(item: ReedSearchItem, d: ReedDetails, placed: Placed): Job {
  const text = htmlToText(d.jobDescription ?? item.jobDescription ?? "");
  const type = d.salaryType?.trim() || null;
  const min = d.minimumSalary ?? item.minimumSalary ?? null;
  const max = d.maximumSalary ?? item.maximumSalary ?? null;
  const contract = d.contractType?.trim() || null;
  const partTime = d.partTime ?? null;
  return {
    id: String(item.jobId),
    title: decodeEntities(d.jobTitle ?? item.jobTitle).trim(),
    employer: item.employerName ? decodeEntities(item.employerName).trim() || null : null,
    location: item.locationName?.trim() || "Not given",
    ...placed,
    posted: reedDate(d.datePosted ?? item.date),
    expires: reedDate(d.expirationDate ?? item.expirationDate),
    pay: { text: (d.salary && decodeEntities(d.salary).trim()) || payText(min, max, type), type, min, max, minYearly: d.yearlyMinimumSalary ?? null },
    partTime,
    contract,
    summary: summary(text),
    url: httpsUrl(d.jobUrl ?? item.jobUrl, item.jobId),
    fullAdvert: true,
    fit: jobFit({ title: decodeEntities(d.jobTitle ?? item.jobTitle).trim(), text, pay: { type, min }, partTime, contract }),
  };
}
