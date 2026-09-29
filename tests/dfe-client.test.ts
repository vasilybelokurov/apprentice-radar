import { describe, expect, it, vi } from "vitest";
import { createDfeClient, fetchAllVacancies } from "../src/sync/dfe-client.ts";
import { dfeItem, jsonResponse, page } from "./fixtures.ts";

const KEY = "test-key-0123456789abcdef";
const noSleep = async () => {};

function client(fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) {
  return createDfeClient({ apiKey: KEY, fetch: fetchImpl, sleep: noSleep, ...extra });
}

describe("DfE client requests", () => {
  it("sends v2 headers and page size 100", async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(page([], 1, 1, 0)));
    await client(f as unknown as typeof fetch).getPage(1);
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toContain("/vacancy?PageNumber=1&PageSize=100&Sort=AgeDesc");
    expect(String(url)).not.toContain(KEY);
    expect(init!.headers).toMatchObject({ "X-Version": "2", "Ocp-Apim-Subscription-Key": KEY });
  });

  it("retries 429 and 5xx, then succeeds", async () => {
    const responses = [jsonResponse({}, 429, { "Retry-After": "1" }), jsonResponse({}, 503), jsonResponse(page([], 1, 1, 0))];
    const f = vi.fn(async () => responses.shift()!);
    const sleep = vi.fn(async () => {});
    await createDfeClient({ apiKey: KEY, fetch: f as unknown as typeof fetch, sleep }).getPage(1);
    expect(f).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 1000); // honours Retry-After seconds
  });

  it("retries network errors", async () => {
    let calls = 0;
    const f = vi.fn(async () => {
      if (calls++ === 0) throw new TypeError("fetch failed");
      return jsonResponse(page([], 1, 1, 0));
    });
    await client(f as unknown as typeof fetch).getPage(1);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("does not retry 401 and redacts the key from the error", async () => {
    const f = vi.fn(async () => new Response(`bad key ${KEY}`, { status: 401 }));
    const error = await client(f as unknown as typeof fetch).getPage(1).catch((e: Error) => e);
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(error)).toContain("HTTP 401");
    expect(String(error)).not.toContain(KEY);
    expect(String(error)).toContain("<redacted>");
  });

  it("gives up after maxAttempts on persistent 500", async () => {
    const f = vi.fn(async () => jsonResponse({}, 500));
    const error = await client(f as unknown as typeof fetch, { maxAttempts: 3 }).getPage(1).catch((e: Error) => e);
    expect(f).toHaveBeenCalledTimes(3);
    expect(String(error)).toContain("gave up after 3 attempts");
  });

  it("rejects an unexpected page shape", async () => {
    const f = vi.fn(async () => jsonResponse({ vacancies: "nope" }));
    await expect(client(f as unknown as typeof fetch).getPage(1)).rejects.toThrow(/unexpected page 1 shape/);
  });

  it("rejects an empty key", () => {
    expect(() => createDfeClient({ apiKey: "  " })).toThrow(/empty/);
  });
});

describe("fetchAllVacancies", () => {
  const ref = (n: number) => dfeItem({ vacancyReference: String(n) });

  it("reads every page reported by totalPages", async () => {
    const pages = [page([ref(1), ref(2)], 1, 3, 5), page([ref(3), ref(4)], 2, 3, 5), page([ref(5)], 3, 3, 5)];
    const getPage = vi.fn(async (n: number) => ({ ...pages[n - 1]! }));
    const result = await fetchAllVacancies({ getPage });
    expect(getPage).toHaveBeenCalledTimes(3);
    expect(result.vacancies.map((v) => v.vacancyReference)).toEqual(["1", "2", "3", "4", "5"]);
    expect(result).toMatchObject({ sourceCount: 5, pagesFetched: 3, duplicates: 0, invalid: [] });
  });

  it("drops duplicates that shift across page boundaries", async () => {
    const pages = [page([ref(1), ref(2)], 1, 2, 3), page([ref(2), ref(3)], 2, 2, 3)];
    const result = await fetchAllVacancies({ getPage: async (n) => pages[n - 1]! });
    expect(result.vacancies).toHaveLength(3);
    expect(result.duplicates).toBe(1);
  });

  it("skips and reports invalid items without failing", async () => {
    const pages = [page([ref(1), { vacancyReference: "bad" }], 1, 1, 2)];
    const result = await fetchAllVacancies({ getPage: async (n) => pages[n - 1]! });
    expect(result.vacancies).toHaveLength(1);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0]!.issues).toMatch(/title/);
  });

  it("fails entirely when any page fails, never returning partial data", async () => {
    const getPage = async (n: number) => {
      if (n === 2) throw new Error("HTTP 500");
      return page([ref(n)], n, 3, 3);
    };
    await expect(fetchAllVacancies({ getPage })).rejects.toThrow("HTTP 500");
  });

  it("handles zero vacancies", async () => {
    const result = await fetchAllVacancies({ getPage: async () => page([], 1, 0, 0) });
    expect(result.vacancies).toEqual([]);
  });
});
