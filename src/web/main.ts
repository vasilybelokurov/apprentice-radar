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
import { card, el, gcseExtras, loadDataset, showFreshness } from "./common.ts";

const PAGE_SIZE = 25;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  form: $<HTMLFormElement>("filters"),
  loc: $<HTMLInputElement>("loc"),
  locGo: $<HTMLButtonElement>("loc-go"),
  locStatus: $<HTMLParagraphElement>("loc-status"),
  locChoices: $<HTMLUListElement>("loc-choices"),
  radius: $<HTMLSelectElement>("radius"),
  levels: $<HTMLDivElement>("levels"),
  routes: $<HTMLDivElement>("routes"),
  routesSummary: $<HTMLElement>("routes-summary"),
  routesClear: $<HTMLButtonElement>("routes-clear"),
  q: $<HTMLInputElement>("q"),
  emp: $<HTMLInputElement>("emp"),
  minpay: $<HTMLInputElement>("minpay"),
  unk: $<HTMLInputElement>("unk"),
  dc: $<HTMLInputElement>("dc"),
  fdn: $<HTMLInputElement>("fdn"),
  gcse: $<HTMLInputElement>("gcse"),
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

// ---------- filters <-> criteria ----------

function buildStaticControls(vacancies: Vacancy[]) {
  els.levels.replaceChildren(
    ...LEVELS.map((n) => {
      const box = el("input", { type: "checkbox", value: String(n), id: `lvl-${n}` });
      return el("label", { class: "check", for: `lvl-${n}` }, box, `Level ${n}`);
    }),
  );
  // Categories in today's data, plus any from the URL that no current vacancy uses (so they can be unticked).
  const fromData = vacancies.map((v) => v.course.route).filter((r): r is string => !!r);
  const routes = [...new Set([...fromData, ...criteria.routes])].sort();
  els.routes.replaceChildren(
    ...routes.map((r, i) => {
      const box = el("input", { type: "checkbox", value: r, id: `route-${i}` });
      return el("label", { class: "check", for: `route-${i}` }, box, r);
    }),
  );
}

function routeBoxes() {
  return [...els.routes.querySelectorAll<HTMLInputElement>("input")];
}

function writeRoutesSummary(routes: string[]) {
  els.routesSummary.textContent = routes.length === 0 ? "All categories" : routes.length === 1 ? routes[0]! : `${routes.length} categories`;
  els.routesClear.hidden = routes.length === 0;
}

function writeControls(c: SearchCriteria) {
  els.loc.value = c.place?.label ?? "";
  if (![...els.radius.options].some((o) => o.value === String(c.radiusMiles))) {
    els.radius.append(el("option", { value: String(c.radiusMiles) }, `Within ${c.radiusMiles} miles`));
  }
  els.radius.value = String(c.radiusMiles);
  for (const box of els.levels.querySelectorAll<HTMLInputElement>("input")) box.checked = c.levels.includes(Number(box.value));
  for (const box of routeBoxes()) box.checked = c.routes.includes(box.value);
  writeRoutesSummary(c.routes);
  els.q.value = c.keywords;
  els.emp.value = c.employer;
  els.minpay.value = c.minPay === null ? "" : String(c.minPay);
  els.unk.checked = c.includeUnknownPay;
  els.dc.checked = c.disabilityConfidentOnly;
  els.fdn.checked = c.foundationOnly;
  els.gcse.checked = c.gcseOnly;
  els.nat.checked = c.includeNational;
  els.sort.value = c.sort;
}

function readControls(): SearchCriteria {
  const minpay = els.minpay.value.trim() === "" ? null : Number(els.minpay.value);
  return {
    ...criteria,
    radiusMiles: Number(els.radius.value),
    levels: [...els.levels.querySelectorAll<HTMLInputElement>("input:checked")].map((b) => Number(b.value)),
    routes: routeBoxes().filter((b) => b.checked).map((b) => b.value),
    keywords: els.q.value,
    employer: els.emp.value,
    minPay: minpay !== null && Number.isFinite(minpay) && minpay >= 0 ? minpay : null,
    includeUnknownPay: els.unk.checked,
    disabilityConfidentOnly: els.dc.checked,
    foundationOnly: els.fdn.checked,
    gcseOnly: els.gcse.checked,
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

function renderMore() {
  const now = Date.now();
  const next = matches.slice(shown, shown + PAGE_SIZE);
  els.cards.append(...next.map((m) => card(m, now, criteria.gcseOnly ? gcseExtras(m) : {})));
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
  dataset = await loadDataset();
  if (!dataset) {
    els.count.textContent = "Couldn't load vacancy data. Please reload the page.";
    return;
  }
  showFreshness(els.freshness, dataset);

  buildStaticControls(dataset.vacancies);
  writeControls(criteria);
  if (window.matchMedia("(max-width: 899px)").matches) els.panel.open = false;

  const onChange = () => {
    criteria = readControls();
    writeRoutesSummary(criteria.routes);
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
  els.routesClear.addEventListener("click", () => {
    for (const box of routeBoxes()) box.checked = false;
    onChange();
  });
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
