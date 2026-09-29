// DfE Display Advert API v2 client: sequential pagination, retries with backoff for 429/5xx/network
// errors, per-request timeout, and redaction of the API key from every error message.
import { ListPageSchema, VacancySchema, type DfeVacancy, type ListPage } from "./dfe-schema.ts";

export const DFE_BASE_URL = "https://api.apprenticeships.education.gov.uk/vacancies";
/** Largest page size the API accepts (it rejects 101 with "Page size must be between 1 and 100"). */
export const MAX_PAGE_SIZE = 100;

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** Attempts per request, including the first. */
  maxAttempts?: number;
  baseDelayMs?: number;
}

export class DfeApiError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "DfeApiError";
    this.status = status;
  }
}

const RETRYABLE_STATUS = (s: number) => s === 429 || s >= 500;
const MAX_RETRY_AFTER_MS = 60_000;

export function createDfeClient(options: ClientOptions) {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error("DfE API key is empty");
  const baseUrl = options.baseUrl ?? DFE_BASE_URL;
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxAttempts = options.maxAttempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 1_000;

  const redact = (text: string) => text.split(apiKey).join("<redacted>");

  function backoff(attempt: number, retryAfter: string | null): number {
    const seconds = retryAfter === null ? NaN : Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
    const exp = baseDelayMs * 2 ** (attempt - 1);
    return exp / 2 + Math.random() * (exp / 2); // jitter in [exp/2, exp)
  }

  async function getJson(path: string): Promise<unknown> {
    const url = `${baseUrl}${path}`;
    let lastError = "";
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await doFetch(url, {
          headers: { "X-Version": "2", "Ocp-Apim-Subscription-Key": apiKey, Accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        lastError = `network error: ${redact(String(error))}`;
        if (attempt < maxAttempts) await sleep(backoff(attempt, null));
        continue;
      }
      if (response.ok) {
        try {
          return await response.json();
        } catch {
          throw new DfeApiError(`invalid JSON from ${path}`, response.status);
        }
      }
      const body = redact((await response.text().catch(() => "")).slice(0, 300));
      lastError = `HTTP ${response.status} from ${path}: ${body}`;
      if (!RETRYABLE_STATUS(response.status)) throw new DfeApiError(lastError, response.status);
      if (attempt < maxAttempts) await sleep(backoff(attempt, response.headers.get("retry-after")));
    }
    throw new DfeApiError(`gave up after ${maxAttempts} attempts; last error: ${lastError}`, null);
  }

  async function getPage(pageNumber: number): Promise<ListPage> {
    const query = new URLSearchParams({
      PageNumber: String(pageNumber),
      PageSize: String(MAX_PAGE_SIZE),
      Sort: "AgeDesc",
    });
    const parsed = ListPageSchema.safeParse(await getJson(`/vacancy?${query}`));
    if (!parsed.success) throw new DfeApiError(`unexpected page ${pageNumber} shape: ${parsed.error.message}`, null);
    return parsed.data;
  }

  async function getRoutes(): Promise<string[]> {
    const data = (await getJson("/referencedata/courses/routes")) as { routes?: { name?: unknown }[] };
    return (data.routes ?? []).map((r) => r.name).filter((n): n is string => typeof n === "string");
  }

  return { getPage, getRoutes, redact };
}

export type DfeClient = ReturnType<typeof createDfeClient>;

export interface FetchAllResult {
  vacancies: DfeVacancy[];
  sourceCount: number;
  pagesFetched: number;
  invalid: { index: number; issues: string }[];
  duplicates: number;
}

/**
 * Fetches every page. Throws on any request failure, so a partial result is never returned.
 * Invalid items are skipped and reported; duplicates (items shifting between pages mid-sync) are dropped.
 */
export async function fetchAllVacancies(client: Pick<DfeClient, "getPage">): Promise<FetchAllResult> {
  const first = await client.getPage(1);
  const pages = [first];
  for (let page = 2; page <= first.totalPages; page++) pages.push(await client.getPage(page));

  const byRef = new Map<string, DfeVacancy>();
  const invalid: FetchAllResult["invalid"] = [];
  let index = 0;
  let duplicates = 0;
  for (const page of pages) {
    for (const item of page.vacancies) {
      const parsed = VacancySchema.safeParse(item);
      if (!parsed.success) {
        invalid.push({ index, issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      } else if (byRef.has(parsed.data.vacancyReference)) {
        duplicates++;
      } else {
        byRef.set(parsed.data.vacancyReference, parsed.data);
      }
      index++;
    }
  }
  return {
    vacancies: [...byRef.values()],
    sourceCount: first.totalFiltered,
    pagesFetched: pages.length,
    invalid,
    duplicates,
  };
}
