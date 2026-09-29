import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parseSentRefs, renderDigest } from "../src/alerts/digest.ts";
import { createGitHubClient, type Issue } from "../src/alerts/github.ts";
import { MAX_ITEMS_PER_ALERT, runAlert, type AlertConfig } from "../src/alerts/run.ts";
import { criteriaFromParams, search } from "../src/lib/search.ts";
import type { Dataset, Vacancy } from "../src/lib/types.ts";
import { jsonResponse } from "./fixtures.ts";

const NOW = new Date("2026-10-05T07:23:00Z");
const config: AlertConfig = {
  name: "test",
  search: "loc=Cambridge%2C+Cambridgeshire&lat=52.20486&lon=0.11968&r=5&lvl=2",
  assignee: "vasilybelokurov",
  siteUrl: "https://example.github.io/apprentice-radar/",
};

let n = 0;
function vac(over: Partial<Vacancy> = {}): Vacancy {
  n++;
  return {
    ref: String(2000 + n),
    title: `Apprentice ${n}`,
    employer: "Acme",
    provider: null,
    description: null,
    course: { title: "Course", level: 2, route: "Digital", type: "Standard" },
    levelName: "Intermediate",
    posted: "2026-09-20T00:00:00.000Z",
    closes: "2026-10-30T23:59:59.000Z",
    starts: null,
    hoursPerWeek: null,
    duration: null,
    positions: 1,
    pay: { type: "Custom", text: "£18,000 a year", minAnnual: 18000, maxAnnual: 18000 },
    locations: [{ label: "Cambridge CB1 1AA", postcode: "CB1 1AA", lat: 52.2, lon: 0.12 }],
    national: false,
    disabilityConfident: false,
    url: "https://www.findapprenticeship.service.gov.uk/apprenticeship/reference/1",
    ...over,
  };
}
const dataset = (vacancies: Vacancy[]): Dataset => ({ generatedAt: NOW.toISOString(), source: "test", sourceCount: vacancies.length, vacancies });

/** In-memory stand-in for the GitHub issues API. */
function fakeGitHub(initial: Issue[] = [], failCreate = false) {
  const issues = [...initial];
  return {
    issues,
    listAlertIssues: vi.fn(async () => issues.map((i) => ({ ...i }))),
    ensureLabel: vi.fn(async () => {}),
    createIssue: vi.fn(async (_title: string, body: string, _assignee: string) => {
      if (failCreate) throw new Error("GitHub create issue failed: HTTP 502");
      const number = issues.length + 1;
      issues.push({ number, state: "open", body });
      return number;
    }),
    closeIssue: vi.fn(async (number: number) => {
      issues.find((i) => i.number === number)!.state = "closed";
    }),
  };
}

describe("digest", () => {
  it("round-trips the refs marker", () => {
    const c = criteriaFromParams(new URLSearchParams(config.search));
    const matches = search([vac(), vac()], c, NOW.getTime());
    const d = renderDigest(matches, c, "https://x/", NOW, "vasilybelokurov");
    expect(parseSentRefs(d.body)).toEqual(d.refs);
    expect(d.title).toBe("2 new apprenticeships near Cambridge (5 Oct 2026)");
    expect(d.body).toContain("within 5 miles of Cambridge, Cambridgeshire · Level 2");
  });

  it("escapes Markdown in source text", () => {
    const c = criteriaFromParams(new URLSearchParams(config.search));
    const d = renderDigest(search([vac({ title: "Chef [urgent](http://evil)" })], c, NOW.getTime()), c, "https://x/", NOW, "vasilybelokurov");
    expect(d.body).toContain("Chef \\[urgent\\](http://evil)");
  });

  it("reads nothing from bodies without a marker", () => {
    expect(parseSentRefs("hello")).toEqual([]);
    expect(parseSentRefs(null)).toEqual([]);
  });
});

describe("runAlert", () => {
  it("announces current matches once, then nothing on the next run", async () => {
    const a = vac();
    const b = vac();
    const far = vac({ locations: [{ label: "London", postcode: null, lat: 51.5, lon: -0.13 }] });
    const gh = fakeGitHub();

    const first = await runAlert(config, dataset([a, b, far]), gh, { now: NOW });
    expect(first).toMatchObject({ matched: 2, alreadySent: 0, announced: 2, issueNumber: 1 });
    expect(gh.createIssue).toHaveBeenCalledWith(expect.any(String), expect.any(String), "vasilybelokurov");
    // The @mention is what triggers GitHub's email (self-assignment does not notify).
    expect(gh.createIssue.mock.calls[0]![1].startsWith("@vasilybelokurov ")).toBe(true);

    const second = await runAlert(config, dataset([a, b, far]), gh, { now: NOW });
    expect(second).toMatchObject({ matched: 2, alreadySent: 2, announced: 0, issueNumber: null });
    expect(gh.createIssue).toHaveBeenCalledTimes(1);
  });

  it("announces only vacancies that are new since the last alert, and closes the previous issue", async () => {
    const a = vac();
    const gh = fakeGitHub();
    await runAlert(config, dataset([a]), gh, { now: NOW });
    const c = vac();
    const r = await runAlert(config, dataset([a, c]), gh, { now: NOW });
    expect(r.digest!.refs).toEqual([c.ref]);
    expect(gh.issues.map((i) => i.state)).toEqual(["closed", "open"]);
  });

  it("a failed issue creation records nothing, so the next run retries", async () => {
    const a = vac();
    const failing = fakeGitHub([], true);
    await expect(runAlert(config, dataset([a]), failing, { now: NOW })).rejects.toThrow("HTTP 502");
    expect(failing.issues).toHaveLength(0);
    const retry = await runAlert(config, dataset([a]), fakeGitHub(failing.issues), { now: NOW });
    expect(retry.announced).toBe(1);
  });

  it("skips closed vacancies and caps a single alert", async () => {
    const closed = vac({ closes: "2026-10-01T00:00:00.000Z" });
    const many = Array.from({ length: MAX_ITEMS_PER_ALERT + 5 }, () => vac());
    const gh = fakeGitHub();
    const r = await runAlert(config, dataset([closed, ...many]), gh, { now: NOW });
    expect(r.announced).toBe(MAX_ITEMS_PER_ALERT);
    expect(r.digest!.refs).not.toContain(closed.ref);
    const next = await runAlert(config, dataset([closed, ...many]), gh, { now: NOW });
    expect(next.announced).toBe(5); // the remainder goes out next time
  });

  it("dry run opens nothing", async () => {
    const gh = fakeGitHub();
    const r = await runAlert(config, dataset([vac()]), gh, { now: NOW, dryRun: true });
    expect(r.digest).not.toBeNull();
    expect(gh.createIssue).not.toHaveBeenCalled();
  });

  it("the committed alerts.json is valid and targets Cambridge, Level 2, 5 miles", () => {
    const committed = JSON.parse(readFileSync("alerts.json", "utf8")) as AlertConfig;
    const c = criteriaFromParams(new URLSearchParams(committed.search));
    expect(c.place).toMatchObject({ label: "Cambridge, Cambridgeshire", lat: 52.20486, lon: 0.11968 });
    expect(c).toMatchObject({ radiusMiles: 5, levels: [2] });
    expect(committed.assignee).toBe("vasilybelokurov");
  });
});

describe("GitHub client", () => {
  it("sends the token only in the header and redacts it from errors", async () => {
    const token = "ghs_secret_token_123";
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).not.toContain(token);
      expect((init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`);
      return new Response(`bad credentials ${token}`, { status: 401 });
    });
    const gh = createGitHubClient({ token, repo: "o/r", fetch: f as unknown as typeof fetch });
    const error = await gh.listAlertIssues().catch((e: Error) => e);
    expect(String(error)).toContain("HTTP 401");
    expect(String(error)).not.toContain(token);
  });

  it("lists every page of alert issues and ignores pull requests", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ number: i + 1, state: "closed", body: "" }));
    const page2 = [{ number: 101, state: "open", body: "" }, { number: 102, state: "open", body: "", pull_request: {} }];
    const f = vi.fn(async (url: string | URL | Request) => jsonResponse(new URL(String(url)).searchParams.get("page") === "1" ? page1 : page2));
    const gh = createGitHubClient({ token: "t", repo: "o/r", fetch: f as unknown as typeof fetch });
    expect(await gh.listAlertIssues()).toHaveLength(101);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("treats an existing label as fine", async () => {
    const f = vi.fn(async () => jsonResponse({ message: "Validation Failed" }, 422));
    await createGitHubClient({ token: "t", repo: "o/r", fetch: f as unknown as typeof fetch }).ensureLabel();
  });
});
