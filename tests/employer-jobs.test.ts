import { describe, expect, it, vi } from "vitest";
import { directJob, employerPay, type DirectAdvert } from "../src/jobs/direct.ts";
import { downingAdvert, vacancyFillerJson } from "../src/jobs/downing.ts";
import { syncHospitality, type EmployerSource } from "../src/jobs/hospitality.ts";
import { mcmullenAdvert, nextPageProps, syncMcmullens } from "../src/jobs/mcmullens.ts";
import { neroAdvert, neroListings } from "../src/jobs/nero.ts";
import { SMART_SOURCES, smartAdvert, syncSmartSource } from "../src/jobs/smartrecruiters.ts";
import { jobCategory } from "../src/lib/job-category.ts";
import { mergeJobs, uniqueJobs } from "../src/lib/jobs-data.ts";
import { jobFit } from "../src/lib/jobs-fit.ts";
import { jsonResponse } from "./fixtures.ts";

const NOW = new Date("2026-10-26T12:00:00Z");
const TODAY = "2026-10-26";
const ad = (over: Partial<DirectAdvert> = {}): DirectAdvert => ({
  id: "1", sourceId: "test", sourceName: "Test employer", sector: "hospitality", title: "Bar & Waiting Staff",
  employer: "Example pub", location: "Cambridge, CB2 3PA", lat: 52.206, lon: 0.12, preciseLocation: true,
  posted: "2026-10-20", expires: null, pay: employerPay("£13 per hour", "per hour"),
  partTime: true, contract: "Temporary", url: "https://example.com/jobs/1", description: "Full training provided. No experience required.", ...over,
});
const source = (sync: EmployerSource["sync"], id = "test"): EmployerSource => ({ id, name: id, url: "https://example.com", sync });
const smart = (id = "1") => ({
  id, name: "Bar & Waiting Staff", releasedDate: "2026-10-20T10:00:00Z", active: true,
  location: { city: "Cambridge", country: "gb", address: "Example pub", postalCode: "CB2 3PA", latitude: "52.206", longitude: "0.12" },
  customField: [
    { fieldLabel: "Salary Range (Advertising)", valueLabel: "Upto £13.25" },
    { fieldLabel: "Compensation Grade", valueLabel: "Team Member in Pub Hourly" },
    { fieldLabel: "Team Member Sub-Type", valueLabel: "Permanent" },
    { fieldLabel: "Job Location", valueLabel: "Example pub" },
  ],
  typeOfEmployment: { id: "part-time", label: "Part-time" },
  postingUrl: `https://jobs.smartrecruiters.com/GreeneKing/${id}-bar-staff`,
  jobAd: { sections: { jobDescription: { text: "Serving drinks." }, qualifications: { text: "Willingness to learn." } } },
});

describe("direct employer normalization", () => {
  it("keeps part-time and temporary entry roles, with source and address", () => {
    expect(directJob(ad(), TODAY)).toMatchObject({ id: "test:1", sourceName: "Test employer", preciseLocation: true,
      fit: { suitable: true, labels: expect.arrayContaining(["Part time", "Temporary"]) } });
  });
  it("rejects expired and distant jobs, and excludes unplaced ones", () => {
    expect(directJob(ad({ expires: "2026-10-25" }), TODAY)).toBeNull();
    expect(directJob(ad({ lat: 51.5 }), TODAY)).toBeNull();
    expect(directJob(ad({ lat: null }), TODAY)?.fit.suitable).toBe(false);
  });
  it("rejects missing adverts and unsafe links", () => {
    expect(() => directJob(ad({ description: "" }), TODAY)).toThrow();
    expect(() => directJob(ad({ url: "javascript:alert(1)" }), TODAY)).toThrow();
  });
  it("does not present salary ceilings as minimum wages", () => {
    expect(employerPay("Upto £13.25", "per hour")).toMatchObject({ min: null, max: 13.25 });
    expect(employerPay("£12.71 - £14.00", "per hour")).toMatchObject({ min: 12.71, max: 14 });
  });
  it("uses hospitality context for ambiguous team-member roles", () => {
    expect(jobCategory("Front Office Team Member", "hospitality")).toBe("Hospitality & catering");
    expect(jobCategory("Night Receptionist", "hospitality")).toBe("Hospitality & catering");
    expect(jobCategory("Kitchen Sales Designer")).toBe("Retail & sales");
    expect(jobCategory("Team Member")).toBe("Other");
    expect(jobCategory("Receptionist / Front of House")).toBe("Office, admin & finance");
  });
  it("distinguishes age-related pay bands from minimum-age requirements", () => {
    const fit = (text: string) => jobFit({ title: "Bar and Waiting Team Member", text, pay: { min: 10.9, type: "per hour" }, partTime: true, contract: "Temporary" });
    expect(fit("18+\n18-20 £10.90\n21+ £12.76").suitable).toBe(true);
    expect(fit("Applicants must be 21+ to apply. Pay £12.76 per hour.").suitable).toBe(false);
  });
});

describe("SmartRecruiters", () => {
  it("reads full requirements, contract and hourly ceiling", () => {
    expect(smartAdvert(smart(), SMART_SOURCES[0]!, TODAY)).toMatchObject({
      id: "greene-king:1", contract: "Permanent", partTime: true,
      pay: { text: "Upto £13.25 per hour", min: null, max: 13.25, type: "per hour" }, fit: { suitable: true },
    });
    const experienced = smart();
    experienced.jobAd.sections.qualifications.text = "Applicants must have three years of experience.";
    expect(smartAdvert(experienced, SMART_SOURCES[0]!, TODAY)?.fit.suitable).toBe(false);
  });
  it("drops withdrawn adverts", () => {
    expect(smartAdvert({ ...smart(), active: false }, SMART_SOURCES[0]!, TODAY)).toBeNull();
  });
  it("pages beyond 100 adverts and reads every detail", async () => {
    const doFetch = vi.fn(async (url: string | URL | Request) => {
      const u = new URL(String(url));
      if (u.search) {
        const offset = Number(u.searchParams.get("offset"));
        return jsonResponse({ totalFound: 101, content: Array.from({ length: offset ? 1 : 100 }, (_, i) => smart(String(offset + i + 1))) });
      }
      return jsonResponse(smart(u.pathname.split("/").at(-1)!));
    });
    expect(await syncSmartSource(SMART_SOURCES[0]!, doFetch, TODAY)).toHaveLength(101);
    expect(doFetch).toHaveBeenCalledTimes(103);
  });
  it("does not accept a partial search as a successful refresh", async () => {
    await expect(syncSmartSource(SMART_SOURCES[0]!, async () => jsonResponse({ totalFound: 20, content: [smart()] }), TODAY)).rejects.toThrow("incomplete");
  });
});

const mc = () => ({
  id: "abc", status: "ACTIVE", title: "Christmas Temp Bar and Waiting Team Member", description: "No experience required.",
  companyName: "Example pub", contractType: "TEMPORARY", hoursType: "PART_TIME",
  location: { country: "GB", formattedAddress: "Cambridge CB2 3PA", geoLocation: { coordinates: [[0.12, 52.206]] } },
  remuneration: { description: "£12.76 per hour", interval: "HOURLY", ranges: [{ type: "FIXED", value: 12.76 }] },
});
const listing = { id: "abc", validFrom: "2026-10-20", validTo: "2026-11-05" };
const next = (props: unknown) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: props } })}</script>`;
describe("McMullen", () => {
  it("reads seasonal contracts and closing dates from structured data", () => {
    expect(mcmullenAdvert(mc(), listing, TODAY)).toMatchObject({ contract: "Temporary", partTime: true, expires: "2026-11-05", fit: { suitable: true } });
    expect(mcmullenAdvert({ ...mc(), status: "CLOSED" }, listing, TODAY)).toBeNull();
    expect(() => nextPageProps("<h1>Home</h1>")).toThrow();
  });
  it("uses the active listing and reads the full advert", async () => {
    const doFetch = vi.fn(async (url: string | URL | Request) => new Response(next(String(url).includes("current-vacancies")
      ? { totalResults: 1, vacancies: [listing] } : { vacancy: mc() })));
    expect(await syncMcmullens(doFetch, TODAY)).toHaveLength(1);
    expect(doFetch.mock.calls[0]![0]).toContain("location=52.20486%2C0.11968");
  });
});

const neroCard = '<a href=/search/123/barista><input name=salary value="to £12.71"><input name=workingPattern value="Full Time"></a><span id=vacancy-count-display hx-swap-oob=true> 1 </span>';
const neroData = () => ({
  "@type": "JobPosting", title: "Barista", url: "https://careers.caffenero.com/search/123/barista",
  description: "&lt;p&gt;No experience required.&lt;/p&gt;", datePosted: "20/10/2026 09:00:00", validThrough: "28/10/2026 01:00:00", employmentType: "Permanent",
  jobLocation: { address: { streetAddress: "11 Market Street", addressLocality: "Cambridge Market St", postalCode: "CB2 3PA", addressCountry: "United Kingdom", geo: { latitude: 52.206, longitude: 0.12 } } },
  baseSalary: { currency: "GBP", value: { unitText: "HOUR", value: 12.71 } },
});
describe("Caffè Nero", () => {
  it("validates search completeness and decodes the full structured advert", () => {
    const list = neroListings(neroCard);
    const html = `<script type="application/ld+json">${JSON.stringify(neroData())}</script>`;
    expect(neroAdvert(html, list[0]!, TODAY)).toMatchObject({ expires: "2026-10-28", partTime: false,
      pay: { min: null, max: 12.71 }, fit: { suitable: true } });
    expect(neroAdvert(html, list[0]!, "2026-10-29")).toBeNull();
    expect(() => neroListings(neroCard.replace("> 1 </span>", "> 2 </span>"))).toThrow("incomplete");
    expect(() => neroListings("Access denied")).toThrow();
    expect(neroListings('<span id="vacancy-count-display">0</span>')).toEqual([]);
  });
});

describe("Downing", () => {
  it("unwraps the public feed's double-encoded JSON", () => {
    expect(vacancyFillerJson('["abc"]')).toEqual(["abc"]);
    expect(vacancyFillerJson(["abc"])).toEqual(["abc"]);
  });
  it("preserves casual contracts and excludes closed/test adverts", () => {
    const raw = { Id: "1", JobTitle: "Catering Assistant", Company: "Downing College", Description: "Full training provided.",
      Link: "https://app.vacancy-filler.co.uk/job?e=abc", Location: "Cambridge", PostCode: "CB2 1DQ", Latitude: "52.2001581", Longitude: "0.1242224",
      PostingDateISO: "2026-10-20T12:00:00Z", ExpiryDateISO: "2026-11-02T12:00:00Z", SalaryFrom: 12.96, SalaryTo: 12.96,
      SalaryPeriod: "Per Hour", Currency: "&pound;", JobType: "Casual", JobTypeTime: "Zero Hours", IsTestAdvert: false };
    expect(downingAdvert(raw, TODAY)).toMatchObject({ contract: "Casual", partTime: null, fit: { suitable: true, labels: ["No experience needed / training given", "Casual"] } });
    expect(downingAdvert(raw, "2026-11-03")).toBeNull();
    expect(downingAdvert({ ...raw, IsTestAdvert: true }, TODAY)).toBeNull();
  });
});

describe("source failures and combining feeds", () => {
  it("keeps a failing source's original freshness while replacing a successful source", async () => {
    const j = directJob(ad(), TODAY)!;
    const old = await syncHospitality([source(async () => [j])], null, new Date("2026-10-25T12:00:00Z"));
    const result = await syncHospitality([source(async () => { throw new Error("offline"); }),
      source(async () => [directJob(ad({ sourceId: "other", url: "https://example.com/other" }), TODAY)!], "other")], old, NOW);
    expect(result.jobs).toHaveLength(2);
    expect(result.sources[0]).toMatchObject({ status: "cached", lastSuccessAt: "2026-10-25T12:00:00.000Z" });
    expect(result.sources[1]?.status).toBe("ok");
    expect(mergeJobs(null, result)?.generatedAt).toBe("2026-10-25T12:00:00.000Z");
  });
  it("removes withdrawn jobs on a successful empty refresh", async () => {
    const old = await syncHospitality([source(async () => [directJob(ad(), TODAY)!])], null, NOW);
    expect((await syncHospitality([source(async () => [])], old, NOW)).jobs).toEqual([]);
  });
  it("expires cached data after a week and never reuses another rule version", async () => {
    const old = await syncHospitality([source(async () => [directJob(ad(), TODAY)!])], null, new Date("2026-10-01"));
    const failed = source(async () => { throw new Error("offline"); });
    expect((await syncHospitality([failed], old, NOW)).sources[0]?.status).toBe("unavailable");
    expect((await syncHospitality([failed], { ...old, generatedAt: NOW.toISOString(), ruleVersion: -1 }, NOW)).jobs).toEqual([]);
  });
  it("deduplicates source IDs and tracking URLs without collapsing different vacancies", () => {
    const j = directJob(ad(), TODAY)!;
    expect(uniqueJobs([j, { ...j, id: "other:1", url: `${j.url}?utm_source=feed` }])).toHaveLength(1);
    expect(uniqueJobs([{ ...j, url: "https://example.com/apply?e=a" }, { ...j, id: "test:2", url: "https://example.com/apply?e=b" }])).toHaveLength(2);
    expect(mergeJobs(null, null)).toBeNull();
  });
});
