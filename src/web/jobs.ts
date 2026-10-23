// Jobs page: Reed jobs within 5 miles of Cambridge judged suitable for an 18-year-old with GCSEs.
import { JOB_CATEGORIES, jobCategory, OTHER_CATEGORY } from "../lib/job-category.ts";
import type { Job, JobsDataset } from "../lib/types.ts";
import { el, fmtDate, loadJson, showFreshness } from "./common.ts";

const PAGE_SIZE = 25;
const SORTS = ["distance", "newest", "closing", "pay"] as const;
type Sort = (typeof SORTS)[number];
/** Rough full-time yearly figure, for sorting only: 37.5 h/week, 5 days/week, 52 weeks. */
const YEARLY_FACTOR: Record<string, number> = { "per annum": 1, "per hour": 37.5 * 52, "per day": 5 * 52, "per week": 52 };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  cat: $<HTMLSelectElement>("cat"),
  q: $<HTMLInputElement>("q"),
  ft: $<HTMLInputElement>("ft"),
  perm: $<HTMLInputElement>("perm"),
  noexp: $<HTMLInputElement>("noexp"),
  nodrive: $<HTMLInputElement>("nodrive"),
  sort: $<HTMLSelectElement>("sort"),
  count: $<HTMLHeadingElement>("count"),
  cards: $<HTMLOListElement>("cards"),
  more: $<HTMLButtonElement>("more"),
  freshness: $<HTMLParagraphElement>("freshness"),
  panel: $<HTMLDetailsElement>("filters-panel"),
  excluded: $<HTMLDetailsElement>("excluded"),
  excludedSummary: $<HTMLElement>("excluded-summary"),
  excludedList: $<HTMLUListElement>("excluded-list"),
};

let data: JobsDataset | null = null;
let shownJobs: Job[] = [];
let shown = 0;

const yearly = (j: Job) => (j.pay.min !== null && j.pay.type && YEARLY_FACTOR[j.pay.type] ? j.pay.min * YEARLY_FACTOR[j.pay.type]! : -Infinity);
const norm = (s: string) => s.toLocaleLowerCase("en-GB");

function compare(a: Job, b: Job, sort: Sort): number {
  const byId = a.id.localeCompare(b.id);
  switch (sort) {
    case "distance":
      return (a.miles ?? Infinity) - (b.miles ?? Infinity) || byId;
    case "newest":
      return (b.posted ?? "").localeCompare(a.posted ?? "") || byId;
    case "closing":
      return (a.expires ?? "9999").localeCompare(b.expires ?? "9999") || byId;
    case "pay":
      return yearly(b) - yearly(a) || byId;
  }
}

function card(j: Job): HTMLLIElement {
  const badges = j.fit.labels.map((l) => {
    const cls = /required|asks|preferred|year/i.test(l) ? "warn" : /training/i.test(l) ? "new" : "info";
    return el("li", { class: `badge ${cls}` }, l);
  });
  // A postcode gives a real distance; a place name ("Cambridge") only places the job somewhere in that town.
  const isPostcode = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(j.location);
  const where =
    isPostcode && j.miles !== null ? `${j.location} · ${j.miles < 10 ? j.miles.toFixed(1) : Math.round(j.miles)} miles` : `${j.location} (no exact address)`;
  const rows: [string, string][] = [
    ["Where", where],
    ["Pay", j.pay.text ?? "Not given"],
    ["Posted", fmtDate(j.posted)],
    ["Closes", fmtDate(j.expires)],
  ];
  return el(
    "li",
    { class: "card" },
    el("h3", {}, el("a", { href: j.url, target: "_blank", rel: "noopener noreferrer" }, j.title)),
    el("p", { class: "employer" }, j.employer ?? "Employer not given"),
    el("p", { class: "course" }, jobCategory(j.title)),
    badges.length ? el("ul", { class: "badges", "aria-label": "Labels" }, ...badges) : null,
    el("dl", {}, ...rows.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])),
    j.summary ? el("p", { class: "summary" }, j.summary) : null,
    el("p", { class: "actions" }, el("a", { href: j.url, target: "_blank", rel: "noopener noreferrer" }, "Read the full advert and apply on Reed ↗")),
  );
}

function renderMore() {
  const next = shownJobs.slice(shown, shown + PAGE_SIZE);
  els.cards.append(...next.map(card));
  shown += next.length;
  els.more.hidden = shown >= shownJobs.length;
  els.more.textContent = `Show more (${shownJobs.length - shown} left)`;
}

function update() {
  if (!data) return;
  const words = norm(els.q.value).split(/\s+/).filter(Boolean);
  const sort = els.sort.value as Sort;
  const today = new Date().toISOString().slice(0, 10);
  const open = data.jobs.filter((j) => !j.expires || j.expires >= today);

  const suitable = open.filter((j) => j.fit.suitable);
  writeCategoryOptions(suitable);
  shownJobs = suitable
    .filter((j) => !els.cat.value || jobCategory(j.title) === els.cat.value)
    .filter((j) => !words.length || words.every((w) => norm(`${j.title} ${j.employer ?? ""} ${j.summary ?? ""}`).includes(w)))
    .filter((j) => !els.ft.checked || j.partTime === false)
    .filter((j) => !els.perm.checked || j.contract === "Permanent")
    .filter((j) => !els.noexp.checked || !j.fit.labels.some((l) => /asks for/i.test(l)))
    .filter((j) => !els.nodrive.checked || !j.fit.labels.includes("Driving licence required"))
    .sort((a, b) => compare(a, b, sort));

  shown = 0;
  els.cards.replaceChildren();
  const n = shownJobs.length;
  els.count.textContent = `${n} job${n === 1 ? "" : "s"} within ${data.radiusMiles} miles of Cambridge`;
  if (n === 0) {
    els.cards.append(el("li", { class: "empty" }, "No jobs match these filters."));
    els.more.hidden = true;
  } else {
    renderMore();
  }

  // Left out: within the radius but judged unsuitable. Unplaced jobs (vague location) are listed last.
  const left = open.filter((j) => !j.fit.suitable).sort((a, b) => compare(a, b, "distance"));
  els.excluded.hidden = left.length === 0;
  els.excludedSummary.textContent = `${left.length} other job${left.length === 1 ? "" : "s"} left out, with the reason`;
  els.excludedList.replaceChildren(
    ...left.map((j) =>
      el(
        "li",
        {},
        el("a", { href: j.url, target: "_blank", rel: "noopener noreferrer" }, j.title),
        j.employer ? ` (${j.employer})` : "",
        el("ul", {}, ...j.fit.reasons.map((r, i) => el("li", {}, el("strong", {}, r), j.fit.evidence[i] ? `: “${j.fit.evidence[i]}”` : ""))),
      ),
    ),
  );
}

/** "Type of work" options with today's counts; types with no jobs are left out. */
function writeCategoryOptions(suitable: Job[]) {
  const counts = new Map<string, number>();
  for (const j of suitable) counts.set(jobCategory(j.title), (counts.get(jobCategory(j.title)) ?? 0) + 1);
  const names = [...JOB_CATEGORIES.map(([name]) => name), OTHER_CATEGORY].filter((n) => counts.has(n) || n === els.cat.value);
  const selected = els.cat.value;
  els.cat.replaceChildren(
    el("option", { value: "" }, `All types (${suitable.length})`),
    ...names.map((n) => el("option", { value: n }, `${n} (${counts.get(n) ?? 0})`)),
  );
  els.cat.value = selected;
}

function saveUrl() {
  const p = new URLSearchParams();
  if (els.cat.value) p.set("type", els.cat.value);
  if (els.q.value.trim()) p.set("q", els.q.value.trim());
  for (const box of [els.ft, els.perm, els.noexp, els.nodrive]) if (box.checked) p.set(box.id, "1");
  if (els.sort.value !== "distance") p.set("sort", els.sort.value);
  const qs = p.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

async function start() {
  const params = new URLSearchParams(location.search);
  els.q.value = (params.get("q") ?? "").slice(0, 100);
  // Select the type from the URL now; writeCategoryOptions() rebuilds the list with counts once data loads.
  const type = (params.get("type") ?? "").slice(0, 60);
  if (type) {
    els.cat.append(el("option", { value: type }, type));
    els.cat.value = type;
  }
  for (const box of [els.ft, els.perm, els.noexp, els.nodrive]) box.checked = params.get(box.id) === "1";
  const sort = params.get("sort");
  if (sort && (SORTS as readonly string[]).includes(sort)) els.sort.value = sort;
  if (window.matchMedia("(max-width: 899px)").matches) els.panel.open = false;

  data = await loadJson<JobsDataset>("./jobs.json");
  if (!data) {
    els.count.textContent = "The jobs list isn't available yet. Please try again later.";
    return;
  }
  showFreshness(els.freshness, data);

  const onChange = () => {
    saveUrl();
    update();
  };
  for (const box of [els.ft, els.perm, els.noexp, els.nodrive]) box.addEventListener("change", onChange);
  els.sort.addEventListener("change", onChange);
  els.cat.addEventListener("change", onChange);
  let t: ReturnType<typeof setTimeout> | undefined;
  els.q.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(onChange, 250);
  });
  $<HTMLFormElement>("filters").addEventListener("submit", (e) => e.preventDefault());
  els.more.addEventListener("click", renderMore);
  update();
}

start();
