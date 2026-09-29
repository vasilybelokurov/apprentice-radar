// Daily sync: fetch every live DfE vacancy, validate, normalise, fill missing coordinates, and write
// data/vacancies.json. Exits non-zero (writing nothing) if the fetch is incomplete, so a failed run
// never replaces the last good published data.
//
// Usage:
//   DFE_API_KEY=... node scripts/sync.ts [--out data/vacancies.json]
//   npm run sync:local        # macOS: reads the key from the Keychain
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createDfeClient, fetchAllVacancies } from "../src/sync/dfe-client.ts";
import { fillMissingCoordinates } from "../src/sync/geocode.ts";
import { normalizeVacancy } from "../src/sync/normalize.ts";
import type { Dataset } from "../src/lib/types.ts";

/** Minimum share of the source's reported count we must receive before publishing. */
const MIN_COMPLETENESS = 0.98;
/** Maximum share of records allowed to fail validation. */
const MAX_INVALID_SHARE = 0.01;

const outArg = process.argv.indexOf("--out");
const outPath = outArg > 0 ? process.argv[outArg + 1]! : "data/vacancies.json";

const apiKey = process.env.DFE_API_KEY?.trim();
if (!apiKey) {
  console.error("DFE_API_KEY is not set.");
  process.exit(2);
}

const started = Date.now();
const client = createDfeClient({ apiKey });

try {
  const result = await fetchAllVacancies(client);
  const received = result.vacancies.length + result.invalid.length;
  console.log(
    `fetched ${result.pagesFetched} pages: ${result.vacancies.length} valid, ${result.invalid.length} invalid, ` +
      `${result.duplicates} duplicates dropped; source reports ${result.sourceCount}`,
  );
  for (const bad of result.invalid.slice(0, 5)) console.warn(`  invalid item #${bad.index}: ${client.redact(bad.issues)}`);

  if (received < result.sourceCount * MIN_COMPLETENESS) {
    throw new Error(`incomplete fetch: received ${received} of ${result.sourceCount}`);
  }
  if (result.invalid.length > received * MAX_INVALID_SHARE) {
    throw new Error(`too many invalid records: ${result.invalid.length} of ${received} (schema change?)`);
  }

  const now = Date.now();
  const vacancies = result.vacancies.map(normalizeVacancy).filter((v) => Date.parse(v.closes) >= now);
  const geo = await fillMissingCoordinates(vacancies);
  console.log(`coordinates: ${geo.missing} missing, ${geo.filled} filled from postcodes, ${geo.failedBatches} failed batches`);

  vacancies.sort((a, b) => b.posted.localeCompare(a.posted) || a.ref.localeCompare(b.ref));
  const dataset: Dataset = {
    generatedAt: new Date().toISOString(),
    source: "DfE Display Advert API v2",
    sourceCount: result.sourceCount,
    vacancies,
  };
  const json = JSON.stringify(dataset);
  if (json.includes(apiKey)) throw new Error("refusing to write: output contains the API key");

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, json);
  console.log(
    `wrote ${vacancies.length} open vacancies to ${outPath} (${(json.length / 1e6).toFixed(2)} MB) in ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
} catch (error) {
  console.error(`sync failed: ${client.redact(String(error))}`);
  process.exit(1);
}
