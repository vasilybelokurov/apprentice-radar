import { describe, expect, it } from "vitest";
import { locateNames } from "../src/jobs/locate.ts";
import { jobFromDetails, jobFromSearch, payText, reedDate } from "../src/jobs/normalize.ts";
import { createReedClient, ReedApiError, searchAll, type ReedDetails, type ReedSearchItem } from "../src/jobs/reed-client.ts";
import { jsonResponse } from "./fixtures.ts";

const KEY = "11111111-2222-3333-4444-555555555555";
const CAMBRIDGE = { label: "Cambridge", lat: 52.20486, lon: 0.11968 };

const item = (jobId: number, over: Partial<ReedSearchItem> = {}): ReedSearchItem => ({
  jobId,
  employerName: "Acme",
  jobTitle: "Warehouse Operative",
  locationName: "Cambridge",
  minimumSalary: 13,
  maximumSalary: 13,
  date: "12/10/2026",
  expirationDate: "23/11/2026",
  jobDescription: "Short snippet",
  jobUrl: `https://www.reed.co.uk/jobs/warehouse-operative/${jobId}`,
  ...over,
});

describe("Reed client", () => {
  it("sends the key as Basic auth user name and never puts it in errors", async () => {
    const seen: string[] = [];
    const client = createReedClient({
      apiKey: KEY,
      fetch: async (_url, init) => {
        seen.push(new Headers(init?.headers).get("Authorization") ?? "");
        return new Response(`bad key ${KEY}`, { status: 401 });
      },
    });
    const error = await client.details(1).catch((e: unknown) => e);
    expect(seen[0]).toBe(`Basic ${Buffer.from(`${KEY}:`).toString("base64")}`);
    expect(error).toBeInstanceOf(ReedApiError);
    expect(String(error)).not.toContain(KEY);
    expect(String(error)).toContain("<redacted>");
  });

  it("retries 429 and 5xx, then succeeds", async () => {
    let calls = 0;
    const client = createReedClient({
      apiKey: KEY,
      sleep: async () => {},
      fetch: async () => (++calls < 3 ? new Response("busy", { status: calls === 1 ? 429 : 503 }) : jsonResponse({ jobId: 5, jobTitle: "X" })),
    });
    expect((await client.details(5)).jobId).toBe(5);
    expect(calls).toBe(3);
  });

  it("searchAll pages through results, runs three passes and de-duplicates", async () => {
    const pages: Record<number, number[]> = { 0: Array.from({ length: 100 }, (_, i) => i + 1), 100: [100, 101, 102] };
    let requests = 0;
    const client = {
      searchPage: async (_loc: string, _miles: number, skip: number) => {
        requests++;
        return { totalResults: 103, results: (pages[skip] ?? []).map((id) => item(id)) };
      },
    };
    const r = await searchAll(client, "Cambridge", 10);
    expect(r.items.map((i) => i.jobId)).toHaveLength(102); // job 100 repeated across pages
    expect(requests).toBe(6); // 2 pages x 3 passes
    expect(r.totalResults).toBe(103);
  });
});

describe("locateNames", () => {
  it("places postcodes in bulk and names by the nearest match; leaves vague areas unplaced", async () => {
    const fetchStub = async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/postcodes")) {
        const { postcodes } = JSON.parse(String(init?.body)) as { postcodes: string[] };
        return jsonResponse({ result: postcodes.map((q) => ({ query: q, result: q === "CB10AN" ? { latitude: 52.19, longitude: 0.14 } : null })) });
      }
      if (u.includes("/places?q=Royston")) {
        return jsonResponse({
          result: [
            { name_1: "Royston", latitude: 53.6, longitude: -1.45 }, // Barnsley
            { name_1: "Royston", latitude: 52.05, longitude: -0.02 }, // Hertfordshire, nearer Cambridge
          ],
        });
      }
      return jsonResponse({ result: [] });
    };
    const out = await locateNames(["CB10AN", "Royston", "Cambridgeshire", "United Kingdom", "ZZ99ZZ"], CAMBRIDGE, { fetch: fetchStub as typeof fetch });
    expect(out.get("CB10AN")).toEqual({ lat: 52.19, lon: 0.14 });
    expect(out.get("Royston")).toEqual({ lat: 52.05, lon: -0.02 });
    expect(out.get("Cambridgeshire")).toBeNull();
    expect(out.get("United Kingdom")).toBeNull();
    expect(out.get("ZZ99ZZ")).toBeNull();
  });
});

describe("normalize", () => {
  it("reads Reed dates and builds pay text", () => {
    expect(reedDate("23/11/2026")).toBe("2026-11-23");
    expect(reedDate("2026-11-23")).toBeNull();
    expect(payText(14.24, 15, "per hour")).toBe("£14.24 - £15 per hour");
    expect(payText(25000, 25000, "per annum")).toBe("£25,000 per annum");
    expect(payText(null, null, null)).toBeNull();
  });

  it("a job read in full gets the rule's verdict and the Reed fields", () => {
    const details: ReedDetails = {
      jobId: 7,
      jobTitle: "Waking Night Support Worker - Child &amp; Youth",
      jobDescription: "<p>Full training will be provided.</p><ul><li>Full UK driving licence</li></ul>",
      salary: "&#163;13.60 per hour",
      salaryType: "per hour",
      minimumSalary: 13.6,
      maximumSalary: 13.6,
      yearlyMinimumSalary: null,
      partTime: true,
      fullTime: false,
      contractType: "Temporary",
      datePosted: "10/10/2026",
      expirationDate: "20/11/2026",
      jobUrl: "javascript:alert(1)",
    };
    const j = jobFromDetails(item(7), details, { lat: 52.2, lon: 0.12, miles: 0.3 });
    expect(j).toMatchObject({
      id: "7",
      title: "Waking Night Support Worker - Child & Youth",
      pay: { text: "£13.60 per hour", type: "per hour", min: 13.6 },
      partTime: true,
      contract: "Temporary",
      posted: "2026-10-10",
      url: "https://www.reed.co.uk/jobs/7",
      fullAdvert: true,
      fit: { suitable: true },
    });
    expect(j.fit.labels).toEqual(expect.arrayContaining(["Driving licence required", "Part time", "Temporary"]));
  });

  it("an unread job carries the location or title reason", () => {
    const j = jobFromSearch(item(8, { jobTitle: "Senior Buyer" }), { lat: null, lon: null, miles: null }, ['Location only given as "Cambridgeshire"']);
    expect(j.fit).toMatchObject({ suitable: false, reasons: ['Location only given as "Cambridgeshire"', "Senior or management role"] });
    expect(j.fullAdvert).toBe(false);
  });
});
