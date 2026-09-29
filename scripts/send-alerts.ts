// Weekly alert: opens a GitHub issue (assigned to the owner, who gets GitHub's email) listing
// vacancies that match alerts.json and were not in any earlier alert issue.
//
// Usage (in GitHub Actions, GITHUB_TOKEN and GITHUB_REPOSITORY are provided):
//   node scripts/send-alerts.ts
// Local preview without creating anything (needs a token that can read issues, e.g. from `gh auth token`):
//   GITHUB_TOKEN="$(gh auth token)" GITHUB_REPOSITORY=vasilybelokurov/apprentice-radar node scripts/send-alerts.ts --dry-run
// Options: --data <path>  use a local vacancies.json instead of the live site's copy
import { readFileSync } from "node:fs";
import { runAlert, type AlertConfig } from "../src/alerts/run.ts";
import { createGitHubClient } from "../src/alerts/github.ts";
import type { Dataset } from "../src/lib/types.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const dryRun = process.argv.includes("--dry-run");
const config = JSON.parse(readFileSync("alerts.json", "utf8")) as AlertConfig;

const token = process.env.GITHUB_TOKEN ?? "";
const repo = process.env.GITHUB_REPOSITORY ?? "";
if (!token || !repo) {
  console.error("GITHUB_TOKEN and GITHUB_REPOSITORY must be set.");
  process.exit(2);
}
const github = createGitHubClient({ token, repo });

try {
  const dataPath = arg("--data");
  let dataset: Dataset;
  if (dataPath) {
    dataset = JSON.parse(readFileSync(dataPath, "utf8")) as Dataset;
  } else {
    const url = new URL("vacancies.json", config.siteUrl.replace(/\/?$/, "/"));
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`could not load ${url}: HTTP ${r.status}`);
    dataset = (await r.json()) as Dataset;
  }
  const ageHours = (Date.now() - Date.parse(dataset.generatedAt)) / 3_600_000;
  console.log(`data: ${dataset.vacancies.length} vacancies, generated ${dataset.generatedAt} (${ageHours.toFixed(1)} h ago)`);
  if (ageHours > 72) throw new Error("vacancy data is more than 3 days old; is the daily sync failing?");

  const result = await runAlert(config, dataset, github, { dryRun });
  console.log(`"${config.name}": ${result.matched} current matches, ${result.alreadySent} already sent, ${result.digest?.refs.length ?? 0} new`);
  if (dryRun && result.digest) console.log(`\n--- ${result.digest.title} ---\n${result.digest.body}`);
  else if (result.issueNumber) console.log(`opened issue #${result.issueNumber} for @${config.assignee}`);
  else console.log("nothing new: no issue opened");
} catch (error) {
  console.error(`alerts failed: ${github.redact(String(error))}`);
  process.exit(1);
}
