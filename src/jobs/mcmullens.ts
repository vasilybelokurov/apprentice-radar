// The public careers pages embed the same structured vacancy data their UI uses.
// Read active search results first; old advert URLs can redirect to the homepage.
import { z } from "zod";
import type { Job } from "../lib/types.ts";
import { directJob, fetchPublic, JOB_ORIGIN, JOB_RADIUS } from "./direct.ts";

export const MCMULLENS = { id: "mcmullens", name: "McMullen pubs", url: "https://mcmullens-v2.applyto.us/current-vacancies" };
const origin = new URL(MCMULLENS.url).origin;
const Item = z.object({ id: z.string().regex(/^[A-Za-z0-9-]+$/), validFrom: z.iso.date(), validTo: z.iso.date() });
const Search = z.object({ totalResults: z.number().int().nonnegative(), vacancies: z.array(Item) });
const Advert = z.object({
  id: z.string(), status: z.string(), title: z.string().min(1), description: z.string().min(1),
  companyName: z.string(), contractType: z.string(), hoursType: z.string(),
  location: z.object({
    country: z.string(), formattedAddress: z.string(),
    geoLocation: z.object({ coordinates: z.array(z.tuple([z.number(), z.number()])).min(1) }),
  }),
  remuneration: z.object({
    description: z.string(), interval: z.string(),
    ranges: z.array(z.object({ type: z.string(), value: z.number() })),
  }),
});

export function nextPageProps(html: string): unknown {
  const script = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!script) throw new Error("Careers page no longer contains vacancy data");
  const d = z.object({ props: z.object({ pageProps: z.unknown() }) }).parse(JSON.parse(script[1]!));
  return d.props.pageProps;
}

export function mcmullenAdvert(raw: unknown, listing: z.infer<typeof Item>, today?: string): Job | null {
  const d = Advert.parse(raw);
  if (d.id !== listing.id) throw new Error("Advert does not match the search result");
  if (d.status !== "ACTIVE" || d.location.country.toUpperCase() !== "GB") return null;
  const [lon, lat] = d.location.geoLocation.coordinates[0]!;
  const type = ({ HOURLY: "per hour", YEARLY: "per annum", DAILY: "per day", WEEKLY: "per week" } as Record<string, string>)[d.remuneration.interval] ?? null;
  const range = (t: string) => d.remuneration.ranges.find((r) => r.type === t)?.value ?? null;
  const fixed = range("FIXED");
  // Some adverts have a FIXED field despite saying "up to" in their wording.
  const min = /\bup\s*to\b/i.test(d.remuneration.description) ? null : range("MIN") ?? fixed;
  const max = range("MAX") ?? fixed;
  return directJob({
    id: d.id, sourceId: MCMULLENS.id, sourceName: MCMULLENS.name, sector: "hospitality", title: d.title,
    employer: `${d.companyName} · McMullen`, location: d.location.formattedAddress, lat, lon, preciseLocation: true,
    posted: listing.validFrom, expires: listing.validTo,
    pay: { text: d.remuneration.description, type, min, max, minYearly: type === "per annum" ? min : null },
    partTime: d.hoursType === "PART_TIME" ? true : d.hoursType === "FULL_TIME" ? false : null,
    contract: ({ PERMANENT: "Permanent", TEMPORARY: "Temporary", CONTRACT: "Contract", CASUAL: "Casual" } as Record<string, string>)[d.contractType] ?? null,
    url: `${origin}/job/${d.id}`, description: d.description,
  }, today);
}

export async function syncMcmullens(doFetch: typeof fetch = fetch, today?: string): Promise<Job[]> {
  const listings = new Map<string, z.infer<typeof Item>>();
  let complete = false;
  for (let start = 0; start < 1500; start += 15) {
    const q = new URLSearchParams({ location: `${JOB_ORIGIN.lat},${JOB_ORIGIN.lon}`, distance: String(JOB_RADIUS), start: String(start) });
    const page = Search.parse(nextPageProps(await (await fetchPublic(`${MCMULLENS.url}?${q}`, doFetch)).text()));
    for (const item of page.vacancies) listings.set(item.id, item);
    if (start + page.vacancies.length >= page.totalResults) {
      if (listings.size < page.totalResults) throw new Error("McMullen search returned duplicate/missing pages");
      complete = true;
      break;
    }
    if (page.vacancies.length !== 15) throw new Error("McMullen search incomplete");
  }
  if (!complete) throw new Error("McMullen pagination limit reached");
  const jobs: Job[] = [];
  for (const item of listings.values()) {
    const response = await fetchPublic(`${origin}/job/${item.id}`, doFetch);
    // A redirect to the home page means the vacancy has been withdrawn since the search.
    if (response.url && new URL(response.url).pathname === "/") continue;
    const detail = z.object({ vacancy: z.unknown() }).parse(nextPageProps(await response.text()));
    const job = mcmullenAdvert(detail.vacancy, item, today);
    if (job) jobs.push(job);
  }
  return jobs;
}
