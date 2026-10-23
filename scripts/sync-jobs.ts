// Daily jobs sync: Reed jobs around Cambridge, placed with Postcodes.io, kept within 5 miles, each
// judged by the "GCSEs, no A levels" rule, written to data/jobs.json.
//
// Full adverts are fetched only for jobs not already in the published jobs.json (same rule version),
// so a normal day costs a few dozen Reed requests. If Reed fails or the key is missing, the last
// published jobs.json is kept, so a jobs problem never blocks the apprenticeship deploy.
//
// Usage:
//   REED_API_KEY=... node scripts/sync-jobs.ts [--out data/jobs.json] [--fresh]
//   npm run sync:jobs:local     # macOS: reads the key from the Keychain
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createReedClient, searchAll, type ReedClient } from "../src/jobs/reed-client.ts";
import { locateNames, VAGUE_LOCATIONS } from "../src/jobs/locate.ts";
import { jobFromDetails, jobFromSearch, type Placed } from "../src/jobs/normalize.ts";
import { JOB_RULE_VERSION, titleReasons } from "../src/lib/jobs-fit.ts";
import { haversineMiles } from "../src/lib/search.ts";
import type { Job, JobsDataset } from "../src/lib/types.ts";

const ORIGIN = { label: "Cambridge, Cambridgeshire", lat: 52.20486, lon: 0.11968 };
const RADIUS_MILES = 5;
/** Reed's own radius is loose (its "5 miles" includes towns 15 miles out), so search wider and measure. */
const SEARCH_MILES = 10;
const SITE_URL = "https://vasilybelokurov.github.io/apprentice-radar/";
const MIN_COMPLETENESS = 0.95;
const MAX_FAILED_DETAILS = 0.1;
const DETAILS_PAUSE_MS = 150;

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const outPath = arg("--out") ?? "data/jobs.json";
const fresh = process.argv.includes("--fresh");

async function loadPrevious(): Promise<JobsDataset | null> {
  try {
    const r = await fetch(new URL("jobs.json", SITE_URL), { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    return r.ok ? ((await r.json()) as JobsDataset) : null;
  } catch {
    return null;
  }
}

function write(dataset: JobsDataset, apiKey: string) {
  const json = JSON.stringify(dataset);
  if (apiKey && json.includes(apiKey)) throw new Error("refusing to write: output contains the API key");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, json);
  return json.length;
}

/** Keeps the last published data; exits 0 so the rest of the deploy goes ahead. */
function keepPrevious(previous: JobsDataset | null, why: string, apiKey: string): never {
  if (previous) {
    write(previous, apiKey);
    console.warn(`jobs sync skipped (${why}); kept the published jobs.json from ${previous.generatedAt}`);
  } else {
    console.warn(`jobs sync skipped (${why}); no earlier jobs.json to keep, the jobs page will say so`);
  }
  process.exit(0);
}

const apiKey = process.env.REED_API_KEY?.trim() ?? "";
const started = Date.now();
const previous = fresh ? null : await loadPrevious();
if (!apiKey) keepPrevious(previous, "REED_API_KEY is not set", apiKey);

const client: ReedClient = createReedClient({ apiKey });
try {
  const search = await searchAll(client, "Cambridge", SEARCH_MILES);
  const received = search.items.length + search.invalid;
  console.log(
    `Reed search (${SEARCH_MILES} mi, 3 passes): ${search.items.length} unique, ${search.invalid} invalid; Reed reports ${search.totalResults}`,
  );
  if (received < search.totalResults * MIN_COMPLETENESS) throw new Error(`incomplete search: ${received} of ${search.totalResults}`);
  if (search.invalid > received * 0.02) throw new Error(`too many invalid results: ${search.invalid} (schema change?)`);

  const names = search.items.map((j) => j.locationName?.trim() ?? "");
  const coords = await locateNames(names, ORIGIN);

  const reusable = new Map<string, Job>();
  if (previous?.ruleVersion === JOB_RULE_VERSION) for (const j of previous.jobs) if (j.fullAdvert) reusable.set(j.id, j);

  const jobs: Job[] = [];
  let outside = 0;
  let reused = 0;
  let fetched = 0;
  let failed = 0;
  for (const item of search.items) {
    const name = item.locationName?.trim() ?? "";
    const c = coords.get(name);
    if (!c) {
      // Unplaced: keep only as an excluded entry, so the page can say why.
      const why = !name || VAGUE_LOCATIONS.test(name) ? `Location only given as "${name || "not given"}"` : `Location "${name}" could not be placed`;
      jobs.push(jobFromSearch(item, { lat: null, lon: null, miles: null }, [why]));
      continue;
    }
    const miles = haversineMiles(ORIGIN.lat, ORIGIN.lon, c.lat, c.lon);
    if (miles > RADIUS_MILES) {
      outside++;
      continue;
    }
    const placed: Placed = { lat: c.lat, lon: c.lon, miles: Math.round(miles * 100) / 100 };
    if (titleReasons(item.jobTitle).length) {
      jobs.push(jobFromSearch(item, placed));
      continue;
    }
    const cached = reusable.get(String(item.jobId));
    if (cached) {
      jobs.push({ ...cached, ...placed });
      reused++;
      continue;
    }
    try {
      if (fetched > 0) await new Promise((r) => setTimeout(r, DETAILS_PAUSE_MS));
      fetched++;
      jobs.push(jobFromDetails(item, await client.details(item.jobId), placed));
    } catch (error) {
      failed++;
      console.warn(`details for ${item.jobId} failed: ${client.redact(String(error))}`);
    }
  }
  if (fetched > 0 && failed > fetched * MAX_FAILED_DETAILS) throw new Error(`${failed} of ${fetched} advert requests failed`);

  jobs.sort((a, b) => (a.miles ?? Infinity) - (b.miles ?? Infinity) || a.id.localeCompare(b.id));
  const dataset: JobsDataset = {
    generatedAt: new Date().toISOString(),
    source: "Reed.co.uk Jobseeker API",
    ruleVersion: JOB_RULE_VERSION,
    origin: ORIGIN,
    radiusMiles: RADIUS_MILES,
    jobs,
  };
  const bytes = write(dataset, apiKey);
  const suitable = jobs.filter((j) => j.fit.suitable).length;
  console.log(
    `jobs: ${jobs.length} kept (${suitable} suitable), ${outside} beyond ${RADIUS_MILES} mi; adverts: ${fetched} fetched, ${reused} reused, ${failed} failed; ` +
      `${(bytes / 1e6).toFixed(2)} MB in ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
} catch (error) {
  keepPrevious(previous, client.redact(String(error)), apiKey);
}
