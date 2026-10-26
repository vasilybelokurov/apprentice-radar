// Daily direct-employer sync. Runs without API keys and independently of Reed.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { HospitalityDataset } from "../src/lib/types.ts";
import { syncHospitality, type EmployerSource } from "../src/jobs/hospitality.ts";
import { SMART_SOURCES, syncSmartSource } from "../src/jobs/smartrecruiters.ts";
import { MCMULLENS, syncMcmullens } from "../src/jobs/mcmullens.ts";
import { NERO, syncNero } from "../src/jobs/nero.ts";
import { DOWNING, syncDowning } from "../src/jobs/downing.ts";

const outIndex = process.argv.indexOf("--out");
const out = outIndex >= 0 ? process.argv[outIndex + 1]! : "data/hospitality.json";
if (!out) throw new Error("--out requires a filename");
const candidates: HospitalityDataset[] = [];
try { candidates.push(JSON.parse(readFileSync(out, "utf8"))); } catch { /* First local run. */ }
try {
  const r = await fetch("https://vasilybelokurov.github.io/apprentice-radar/hospitality.json", { signal: AbortSignal.timeout(20_000) });
  if (r.ok) candidates.push(await r.json() as HospitalityDataset);
} catch { /* A local snapshot can still be used. */ }
const previous = candidates.filter((d) => Array.isArray(d.sources) && Array.isArray(d.jobs))
  .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0] ?? null;
const sources: EmployerSource[] = SMART_SOURCES.map((s) => ({ ...s, sync: () => syncSmartSource(s) }));
sources.push({ ...MCMULLENS, sync: () => syncMcmullens() });
sources.push({ ...NERO, sync: () => syncNero() });
sources.push({ ...DOWNING, sync: () => syncDowning() });
const dataset = await syncHospitality(sources, previous);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(`${out}.tmp`, JSON.stringify(dataset));
renameSync(`${out}.tmp`, out);
for (const s of dataset.sources) {
  console.log(`${s.name}: ${s.status}, ${s.count} local adverts, ${dataset.jobs.filter((j) => j.sourceId === s.id && j.fit.suitable).length} suitable`);
}
