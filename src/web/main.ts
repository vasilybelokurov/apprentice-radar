// Browser entry: loads vacancies.json, keeps filters in the URL, renders matching vacancy cards.
import { resolvePlace, type PlaceChoice } from "../lib/places.ts";
import {
  DEFAULT_LOCATION_QUERY,
  LEVELS,
  criteriaFromParams,
  criteriaToParams,
  search,
  type Match,
  type SearchCriteria,
} from "../lib/search.ts";
import type { Dataset, Vacancy } from "../lib/types.ts";

const PAGE_SIZE = 25;
const DAY_MS = 86_400_000;
const NEW_DAYS = 7;
const CLOSING_SOON_DAYS = 7;
const STALE_HOURS = 48;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  form: $<HTMLFormElement>("filters"),
  loc: $<HTMLInputElement>("loc"),
  locGo: $<HTMLButtonElement>("loc-go"),
  locStatus: $<HTMLParagraphElement>("loc-status"),
  locChoices: $<HTMLUListElement>("loc-choices"),
  radius: $<HTMLSelectElement>("radius"),
  levels: $<HTMLDivElement>("levels"),
  route: $<HTMLSelectElement>("route"),
  q: $<HTMLInputElement>("q"),
  emp: $<HTMLInputElement>("emp"),
  minpay: $<HTMLInputElement>("minpay"),
  unk: $<HTMLInputElement>("unk"),
  dc: $<HTMLInputElement>("dc"),
  fdn: $<HTMLInputElement>("fdn"),
  nat: $<HTMLInputElement>("nat"),
  sort: $<HTMLSelectElement>("sort"),
  reset: $<HTMLButtonElement>("reset"),
  count: $<HTMLHeadingElement>("count"),
  cards: $<HTMLOListElement>("cards"),
  more: $<HTMLButtonElement>("more"),
  freshness: $<HTMLParagraphElement>("freshness"),
  panel: $<HTMLDetailsElement>("filters-panel"),
};

let dataset: Dataset | null = null;
let criteria: SearchCriteria = criteriaFromParams(new URLSearchParams(location.search));
let matches: Match[] = [];
let shown = 0;

// ---------- formatting ----------

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const fmtDate = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : "Not given");
const fmtMiles = (m: number) => (m < 10 ? m.toFixed(1) : Math.round(m).toString());

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string | null)[]) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) if (c !== null) node.append(c);
  return node;
}

// ---------- filters <-> criteria ----------

function buildStaticControls(vacancies: Vacancy[]) {
  els.levels.replaceChildren(
    ...LEVELS.map((n) => {
      const box = el("input", { type: "checkbox", value: String(n), id: `lvl-${n}` });
      return el("label", { class: "check", for: `lvl-${n}` }, box, `Level ${n}`);
    }),
  );
  const routes = [...new Set(vacancies.map((v) => v.course.route).filter((r): r is string => !!r))].sort();
  for (const r of routes) els.route.append(el("option", { value: r }, r));
}

function writeControls(c: SearchCriteria) {
  els.loc.value = c.place?.label ?? "";
  if (![...els.radius.options].some((o) => o.value === String(c.radiusMiles))) {
    els.radius.append(el("option", { value: String(c.radiusMiles) }, `Within ${c.radiusMiles} miles`));
  }
  els.radius.value = String(c.radiusMiles);
  for (const box of els.levels.querySelectorAll<HTMLInputElement>("input")) box.checked = c.levels.includes(Number(box.value));
  els.route.value = c.routes[0] ?? "";
  els.q.value = c.keywords;
  els.emp.value = c.employer;
  els.minpay.value = c.minPay === null ? "" : String(c.minPay);
  els.unk.checked = c.includeUnknownPay;
  els.dc.checked = c.disabilityConfidentOnly;
  els.fdn.checked = c.foundationOnly;
  els.nat.checked = c.includeNational;
  els.sort.value = c.sort;
}

function readControls(): SearchCriteria {
  const minpay = els.minpay.value.trim() === "" ? null : Number(els.minpay.value);
  return {
    ...criteria,
    radiusMiles: Number(els.radius.value),
    levels: [...els.levels.querySelectorAll<HTMLInputElement>("input:checked")].map((b) => Number(b.value)),
    routes: els.route.value ? [els.route.value] : [],
    keywords: els.q.value,
    employer: els.emp.value,
    minPay: minpay !== null && Number.isFinite(minpay) && minpay >= 0 ? minpay : null,
    includeUnknownPay: els.unk.checked,
    disabilityConfidentOnly: els.dc.checked,
    foundationOnly: els.fdn.checked,
    includeNational: els.nat.checked,
    sort: els.sort.value as SearchCriteria["sort"],
  };
}

function saveUrl() {
  const qs = criteriaToParams(criteria).toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

// ---------- location ----------

function setPlace(p: PlaceChoice) {
  criteria = { ...criteria, place: { label: p.label, lat: p.lat, lon: p.lon } };
  els.loc.value = p.label;
  els.locStatus.textContent = p.detail ? `Using ${p.label} (${p.detail})` : `Using ${p.label}`;
  els.locStatus.classList.remove("error");
  els.locChoices.hidden = true;
  update();
}

async function findLocation(query: string) {
  const q = query.trim();
  if (!q) {
    criteria = { ...criteria, place: null };
    els.locStatus.textContent = "No location: showing vacancies anywhere in England.";
    els.locChoices.hidden = true;
    update();
    return;
  }
  els.locStatus.textContent = "Looking up location…";
  els.locStatus.classList.remove("error");
  let choices: PlaceChoice[];
  try {
    choices = await resolvePlace(q);
  } catch {
    els.locStatus.textContent = "Couldn't reach the location service. Check your connection and try again.";
    els.locStatus.classList.add("error");
    return;
  }
  if (choices.length === 0) {
    els.locStatus.textContent = `No UK place or postcode found for "${q}".`;
    els.locStatus.classList.add("error");
    els.locChoices.hidden = true;
  } else if (choices.length === 1) {
    setPlace(choices[0]!);
  } else {
    els.locStatus.textContent = `Several places match "${q}". Choose one:`;
    els.locChoices.replaceChildren(
      ...choices.map((c) => {
        const b = el("button", { type: "button" }, c.label, el("small", {}, c.detail));
        b.addEventListener("click", () => setPlace(c));
        return el("li", {}, b);
      }),
    );
    els.locChoices.hidden = false;
  }
}

// ---------- results ----------

function card(m: Match, now: number): HTMLLIElement {
  const v = m.vacancy;
  const badges: HTMLElement[] = [];
  const badge = (text: string, cls: string) => badges.push(el("li", { class: `badge ${cls}` }, text));
  if (now - Date.parse(v.posted) <= NEW_DAYS * DAY_MS) badge("New", "new");
  if (Date.parse(v.closes) - now <= CLOSING_SOON_DAYS * DAY_MS) badge("Closing soon", "soon");
  if (v.disabilityConfident) badge("Disability Confident", "info");
  if (v.national) badge("Recruiting nationally", "info");
  if (v.course.type === "Foundation") badge("Foundation", "info");

  let where: string;
  if (v.national) where = "Recruiting nationally (no single location)";
  else if (m.nearest) where = `${m.nearest.location.label} · ${fmtMiles(m.nearest.miles)} miles`;
  else where = v.locations[0]?.label ?? "Not given";
  const others = v.locations.length - 1;

  const rows: [string, Node | string][] = [
    ["Where", others > 0 ? `${where} (also ${others} other location${others > 1 ? "s" : ""})` : where],
    ["Pay", v.pay.text ?? "Not given"],
    ["Closes", fmtDate(v.closes)],
    ["Starts", fmtDate(v.starts)],
    ["Posted", fmtDate(v.posted)],
  ];
  if (v.duration) rows.push(["Duration", v.duration]);

  const level = v.course.level ? `Level ${v.course.level}` : "Level not given";
  const title = el("a", { href: v.url, target: "_blank", rel: "noopener noreferrer" }, v.title);
  return el(
    "li",
    { class: "card" },
    el("h3", {}, title),
    el("p", { class: "employer" }, v.employer ?? "Employer not given"),
    el("p", { class: "course" }, [level, v.course.title, v.course.route].filter(Boolean).join(" · ")),
    badges.length ? el("ul", { class: "badges", "aria-label": "Labels" }, ...badges) : null,
    el("dl", {}, ...rows.flatMap(([k, val]) => [el("dt", {}, k), el("dd", {}, val)])),
    el(
      "p",
      { class: "actions" },
      el("a", { href: v.url, target: "_blank", rel: "noopener noreferrer" }, "View and apply on Find an apprenticeship ↗"),
    ),
  );
}

function renderMore() {
  const now = Date.now();
  const next = matches.slice(shown, shown + PAGE_SIZE);
  els.cards.append(...next.map((m) => card(m, now)));
  shown += next.length;
  els.more.hidden = shown >= matches.length;
  els.more.textContent = `Show more (${matches.length - shown} left)`;
}

function update() {
  if (!dataset) return;
  saveUrl();
  matches = search(dataset.vacancies, criteria);
  shown = 0;
  els.cards.replaceChildren();
  const where = criteria.place ? ` within ${criteria.radiusMiles} miles of ${criteria.place.label}` : " in England";
  const n = matches.length;
  els.count.textContent = `${n.toLocaleString("en-GB")} apprenticeship${n === 1 ? "" : "s"}${where}`;
  if (n === 0) {
    els.cards.append(el("li", { class: "empty" }, "No open vacancies match these filters. Try a wider distance, another level, or fewer keywords."));
    els.more.hidden = true;
    return;
  }
  renderMore();
}

// ---------- start ----------

function debounce(fn: () => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

async function start() {
  try {
    const response = await fetch("./vacancies.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    dataset = (await response.json()) as Dataset;
  } catch {
    els.count.textContent = "Couldn't load vacancy data. Please reload the page.";
    return;
  }

  const ageHours = (Date.now() - Date.parse(dataset.generatedAt)) / 3_600_000;
  els.freshness.textContent = `Data updated ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(dataset.generatedAt))}`;
  if (ageHours > STALE_HOURS) {
    els.freshness.textContent += " · may be out of date; check closing dates on the official page";
    els.freshness.classList.add("stale");
  }

  buildStaticControls(dataset.vacancies);
  writeControls(criteria);
  if (window.matchMedia("(max-width: 899px)").matches) els.panel.open = false;

  const onChange = () => {
    criteria = readControls();
    update();
  };
  els.form.addEventListener("change", (e) => {
    if (e.target !== els.loc) onChange();
  });
  els.sort.addEventListener("change", onChange);
  const typed = debounce(onChange, 250);
  for (const input of [els.q, els.emp, els.minpay]) input.addEventListener("input", typed);
  els.locGo.addEventListener("click", () => findLocation(els.loc.value));
  els.loc.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      findLocation(els.loc.value);
    }
  });
  els.form.addEventListener("submit", (e) => e.preventDefault());
  els.more.addEventListener("click", renderMore);
  els.reset.addEventListener("click", () => {
    criteria = criteriaFromParams(new URLSearchParams());
    writeControls(criteria);
    findLocation(DEFAULT_LOCATION_QUERY);
  });

  // First visit (no location in the URL): resolve the default place through the same lookup.
  const hasLocationParam = new URLSearchParams(location.search).has("lat");
  if (!criteria.place && !hasLocationParam) await findLocation(DEFAULT_LOCATION_QUERY);
  else update();
}

start();
