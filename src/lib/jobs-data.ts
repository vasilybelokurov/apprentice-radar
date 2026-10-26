import type { HospitalityDataset, Job, JobsDataset } from "./types.ts";

/** The same source ID or application URL is one advert; distinct shifts/roles are preserved. */
export function uniqueJobs(jobs: Job[]): Job[] {
  const ids = new Set<string>();
  const urls = new Set<string>();
  return jobs.filter((j) => {
    const url = new URL(j.url);
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(oga|referrer|source)$/i.test(key)) url.searchParams.delete(key);
    url.hash = "";
    const canonical = url.toString();
    if (ids.has(j.id) || urls.has(canonical)) return false;
    ids.add(j.id);
    urls.add(canonical);
    return true;
  });
}

export function mergeJobs(reed: JobsDataset | null, employers: HospitalityDataset | null): JobsDataset | null {
  const base = reed ?? employers;
  if (!base) return null;
  if (reed && employers && (reed.radiusMiles !== employers.radiusMiles || reed.origin.lat !== employers.origin.lat || reed.origin.lon !== employers.origin.lon)) {
    throw new Error("Job feeds have different search areas");
  }
  const dates = [reed?.generatedAt, ...(employers?.sources.map((s) => s.lastSuccessAt) ?? [])]
    .filter((d): d is string => !!d).sort();
  return { ...base, source: "Reed and direct employers", generatedAt: dates[0] ?? base.generatedAt,
    jobs: uniqueJobs([...(reed?.jobs ?? []), ...(employers?.jobs ?? [])]) };
}
