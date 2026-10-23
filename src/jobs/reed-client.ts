// Reed Jobseeker API client (https://www.reed.co.uk/developers/jobseeker): search pages and job details,
// with retries for 429/5xx/network errors, a per-request timeout, and the key redacted from every error.
import { z } from "zod";

export const REED_BASE_URL = "https://www.reed.co.uk/api/1.0";
/** Largest page the search accepts. */
export const REED_PAGE_SIZE = 100;

const text = z.string().nullish();
const num = z.number().nullish();

export const ReedSearchItemSchema = z.object({
  jobId: z.number(),
  employerName: text,
  jobTitle: z.string().min(1),
  locationName: text,
  minimumSalary: num,
  maximumSalary: num,
  /** dd/mm/yyyy */
  date: text,
  expirationDate: text,
  jobDescription: text,
  jobUrl: text,
});
export type ReedSearchItem = z.infer<typeof ReedSearchItemSchema>;

const SearchPageSchema = z.object({ totalResults: z.number().int().nonnegative(), results: z.array(z.unknown()) });

export const ReedDetailsSchema = z.object({
  jobId: z.number(),
  jobTitle: text,
  jobDescription: text,
  salary: text,
  salaryType: text,
  minimumSalary: num,
  maximumSalary: num,
  yearlyMinimumSalary: num,
  partTime: z.boolean().nullish(),
  fullTime: z.boolean().nullish(),
  contractType: text,
  datePosted: text,
  expirationDate: text,
  jobUrl: text,
});
export type ReedDetails = z.infer<typeof ReedDetailsSchema>;

export class ReedApiError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "ReedApiError";
    this.status = status;
  }
}

export interface ReedClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
}

export function createReedClient(options: ReedClientOptions) {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error("Reed API key is empty");
  const baseUrl = options.baseUrl ?? REED_BASE_URL;
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxAttempts = options.maxAttempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 1_000;
  // Basic auth: the key is the user name, the password is empty.
  const authorization = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
  const redact = (s: string) => s.split(apiKey).join("<redacted>").split(authorization).join("<redacted>");

  async function getJson(path: string): Promise<unknown> {
    let lastError = "";
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await doFetch(`${baseUrl}${path}`, { headers: { Authorization: authorization, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        lastError = `network error: ${redact(String(error))}`;
        if (attempt < maxAttempts) await sleep(baseDelayMs * 2 ** (attempt - 1));
        continue;
      }
      if (response.ok) {
        try {
          return await response.json();
        } catch {
          throw new ReedApiError(`invalid JSON from ${path}`, response.status);
        }
      }
      const body = redact((await response.text().catch(() => "")).slice(0, 300));
      lastError = `HTTP ${response.status} from ${path}: ${body}`;
      if (response.status !== 429 && response.status < 500) throw new ReedApiError(lastError, response.status);
      if (attempt < maxAttempts) await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
    throw new ReedApiError(`gave up after ${maxAttempts} attempts; last error: ${lastError}`, null);
  }

  async function searchPage(locationName: string, distanceMiles: number, skip: number) {
    const q = new URLSearchParams({
      locationName,
      distanceFromLocation: String(distanceMiles),
      resultsToTake: String(REED_PAGE_SIZE),
      resultsToSkip: String(skip),
    });
    const parsed = SearchPageSchema.safeParse(await getJson(`/search?${q}`));
    if (!parsed.success) throw new ReedApiError(`unexpected search page shape: ${parsed.error.message}`, null);
    return parsed.data;
  }

  async function details(jobId: number): Promise<ReedDetails> {
    const parsed = ReedDetailsSchema.safeParse(await getJson(`/jobs/${jobId}`));
    if (!parsed.success) throw new ReedApiError(`unexpected details shape for ${jobId}: ${parsed.error.message}`, null);
    return parsed.data;
  }

  return { searchPage, details, redact };
}

export type ReedClient = ReturnType<typeof createReedClient>;

export interface SearchAllResult {
  items: ReedSearchItem[];
  totalResults: number;
  invalid: number;
  duplicates: number;
}

/**
 * Every search result, de-duplicated by jobId. Results shift between pages while paging (a job seen
 * on page 3 reappears on page 4 and another is skipped), so the whole search runs `passes` times (default 3).
 */
export async function searchAll(
  client: Pick<ReedClient, "searchPage">,
  locationName: string,
  distanceMiles: number,
  options: { passes?: number; maxPages?: number } = {},
): Promise<SearchAllResult> {
  const passes = options.passes ?? 3;
  const maxPages = options.maxPages ?? 50;
  const byId = new Map<number, ReedSearchItem>();
  let totalResults = 0;
  let invalid = 0;
  let duplicates = 0;
  for (let pass = 0; pass < passes; pass++) for (let page = 0; page < maxPages; page++) {
    const data = await client.searchPage(locationName, distanceMiles, page * REED_PAGE_SIZE);
    totalResults = data.totalResults;
    for (const raw of data.results) {
      const item = ReedSearchItemSchema.safeParse(raw);
      if (!item.success) invalid++;
      else if (byId.has(item.data.jobId)) duplicates++;
      else byId.set(item.data.jobId, item.data);
    }
    if (data.results.length < REED_PAGE_SIZE || (page + 1) * REED_PAGE_SIZE >= totalResults) break;
  }
  return { items: [...byId.values()], totalResults, invalid, duplicates };
}
