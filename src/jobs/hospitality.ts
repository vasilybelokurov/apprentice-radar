import { JOB_RULE_VERSION } from "../lib/jobs-fit.ts";
import { uniqueJobs } from "../lib/jobs-data.ts";
import type { HospitalityDataset, Job, JobSourceStatus } from "../lib/types.ts";
import { JOB_ORIGIN, JOB_RADIUS } from "./direct.ts";

export interface EmployerSource {
  id: string;
  name: string;
  url: string;
  sync: () => Promise<Job[]>;
}

/** One source's failure cannot erase other sources or give old adverts a new freshness date. */
export async function syncHospitality(
  sources: EmployerSource[], previous: HospitalityDataset | null, now = new Date(),
): Promise<HospitalityDataset> {
  const checkedAt = now.toISOString();
  const today = checkedAt.slice(0, 10);
  const jobs: Job[] = [];
  const statuses: JobSourceStatus[] = [];
  for (const source of sources) {
    const status: JobSourceStatus = {
      id: source.id, name: source.name, url: source.url, checkedAt, lastSuccessAt: null, status: "unavailable", count: 0,
    };
    let items: Job[];
    try {
      items = await source.sync();
      if (items.some((j) => j.sourceId !== source.id)) throw new Error("Unexpected job source");
      status.status = "ok";
      status.lastSuccessAt = checkedAt;
    } catch (error) {
      console.warn(`${source.name}: ${String(error)}`);
      const oldStatus = previous?.sources.find((s) => s.id === source.id);
      const last = oldStatus?.lastSuccessAt;
      // Stop displaying unverified adverts after a week, even when no closing date was supplied.
      const reusable = previous?.ruleVersion === JOB_RULE_VERSION && last &&
        now.getTime() - Date.parse(last) <= 7 * 86_400_000;
      items = reusable ? previous.jobs.filter((j) => j.sourceId === source.id) : [];
      status.lastSuccessAt = last ?? null;
      status.status = reusable ? "cached" : "unavailable";
    }
    const current = items.filter((j) => !j.expires || j.expires >= today);
    jobs.push(...current);
    status.count = current.length;
    statuses.push(status);
  }
  return {
    generatedAt: checkedAt, source: "Direct employer vacancies", ruleVersion: JOB_RULE_VERSION,
    origin: JOB_ORIGIN, radiusMiles: JOB_RADIUS, jobs: uniqueJobs(jobs), sources: statuses,
  };
}
