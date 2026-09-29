// One alert run: search current vacancies, drop ones already announced, open one issue for the rest.
import { criteriaFromParams, search } from "../lib/search.ts";
import type { Dataset } from "../lib/types.ts";
import { parseSentRefs, renderDigest, type Digest } from "./digest.ts";
import type { GitHubClient } from "./github.ts";

export interface AlertConfig {
  name: string;
  /** Query string exactly as the site writes it, e.g. "loc=...&lat=...&lon=...&r=5&lvl=2". */
  search: string;
  assignee: string;
  siteUrl: string;
}

/** Issue bodies have a 65,536-character limit; the rest are announced next time. */
export const MAX_ITEMS_PER_ALERT = 50;

export interface RunResult {
  matched: number;
  alreadySent: number;
  announced: number;
  issueNumber: number | null;
  digest: Digest | null;
}

export async function runAlert(
  config: AlertConfig,
  dataset: Dataset,
  github: Pick<GitHubClient, "listAlertIssues" | "ensureLabel" | "createIssue" | "closeIssue">,
  options: { now?: Date; dryRun?: boolean } = {},
): Promise<RunResult> {
  const now = options.now ?? new Date();
  const criteria = criteriaFromParams(new URLSearchParams(config.search));
  if (!criteria.place) throw new Error("alerts.json search must include lat and lon");

  const matches = search(dataset.vacancies, criteria, now.getTime());
  const previous = await github.listAlertIssues();
  const sent = new Set(previous.flatMap((i) => parseSentRefs(i.body)));
  const unsent = matches.filter((m) => !sent.has(m.vacancy.ref));
  const fresh = unsent.slice(0, MAX_ITEMS_PER_ALERT);
  const result: RunResult = { matched: matches.length, alreadySent: matches.length - unsent.length, announced: 0, issueNumber: null, digest: null };
  if (fresh.length === 0) return result;

  const searchUrl = `${config.siteUrl.replace(/\/?$/, "/")}?${config.search}`;
  const digest = renderDigest(fresh, criteria, searchUrl, now);
  result.digest = digest;
  if (options.dryRun) return result;

  await github.ensureLabel();
  // Creating the issue is the delivery: its refs line is what marks these vacancies as sent.
  result.issueNumber = await github.createIssue(digest.title, digest.body, config.assignee);
  result.announced = fresh.length;
  for (const issue of previous) {
    if (issue.state === "open") await github.closeIssue(issue.number).catch((e) => console.warn(String(e)));
  }
  return result;
}
