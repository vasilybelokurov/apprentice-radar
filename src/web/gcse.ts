// Fixed view: Cambridge apprenticeships open to a school leaver with GCSEs but no A levels.
import { describeRequirement, gcseFit, type GcseFit } from "../lib/requirements.ts";
import { criteriaToParams, defaultCriteria, search, SORTS, type Match, type SearchCriteria, type Sort } from "../lib/search.ts";
import type { Dataset } from "../lib/types.ts";
import { card, el, loadDataset, showFreshness } from "./common.ts";

const PAGE_SIZE = 25;
/** Same place as the site default and alerts.json. */
const CAMBRIDGE = { label: "Cambridge, Cambridgeshire", lat: 52.20486, lon: 0.11968 };
const RADIUS_MILES = 5;
/** Degree apprenticeships (Levels 6-7) are left out: they normally need A levels or equivalent. */
const LEVELS = [2, 3, 4, 5];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  count: $<HTMLHeadingElement>("count"),
  sort: $<HTMLSelectElement>("sort"),
  cards: $<HTMLOListElement>("cards"),
  more: $<HTMLButtonElement>("more"),
  freshness: $<HTMLParagraphElement>("freshness"),
  excluded: $<HTMLDetailsElement>("excluded"),
  excludedSummary: $<HTMLElement>("excluded-summary"),
  excludedList: $<HTMLUListElement>("excluded-list"),
  fullSearch: $<HTMLAnchorElement>("full-search"),
};

let dataset: Dataset | null = null;
let suitable: { match: Match; fit: GcseFit }[] = [];
let shown = 0;

const criteria = (sort: Sort): SearchCriteria => ({ ...defaultCriteria(), place: CAMBRIDGE, radiusMiles: RADIUS_MILES, levels: LEVELS, sort });

function requirementsRow(match: Match): [string, Node | string] {
  const reqs = [...match.vacancy.requirements].sort((a, b) => Number(b.essential) - Number(a.essential));
  if (reqs.length === 0) return ["Entry requirements", "None listed"];
  return [
    "Entry requirements",
    el("ul", { class: "reqs" }, ...reqs.map((r) => el("li", {}, `${r.essential ? "Essential" : "Preferred"}: ${describeRequirement(r)}`))),
  ];
}

function renderMore() {
  const now = Date.now();
  const next = suitable.slice(shown, shown + PAGE_SIZE);
  els.cards.append(
    ...next.map(({ match, fit }) => {
      const badges: [string, string][] = [];
      if (fit.level3Preferred) badges.push(["A levels or equivalent preferred", "warn"]);
      if (fit.drivingLicence) badges.push(["Driving licence required", "warn"]);
      return card(match, now, { badges, rows: [requirementsRow(match)] });
    }),
  );
  shown += next.length;
  els.more.hidden = shown >= suitable.length;
  els.more.textContent = `Show more (${suitable.length - shown} left)`;
}

function update() {
  if (!dataset) return;
  const sort = els.sort.value as Sort;
  const matches = search(dataset.vacancies, criteria(sort));
  const fits = matches.map((match) => ({ match, fit: gcseFit(match.vacancy) }));
  suitable = fits.filter((f) => f.fit.suitable);
  const left = fits.filter((f) => !f.fit.suitable);

  shown = 0;
  els.cards.replaceChildren();
  const n = suitable.length;
  els.count.textContent = `${n} apprenticeship${n === 1 ? "" : "s"} within ${RADIUS_MILES} miles of Cambridge`;
  if (n === 0) {
    els.cards.append(el("li", { class: "empty" }, "None open right now. New vacancies are added daily."));
    els.more.hidden = true;
  } else {
    renderMore();
  }

  els.excluded.hidden = left.length === 0;
  els.excludedSummary.textContent = `${left.length} other vacanc${left.length === 1 ? "y" : "ies"} nearby left out because they need more than GCSEs`;
  els.excludedList.replaceChildren(
    ...left.map(({ match, fit }) =>
      el(
        "li",
        {},
        el("a", { href: match.vacancy.url, target: "_blank", rel: "noopener noreferrer" }, match.vacancy.title),
        ` (Level ${match.vacancy.course.level ?? "?"}) needs: ${fit.blockers.map(describeRequirement).join("; ")}`,
      ),
    ),
  );
}

async function start() {
  els.fullSearch.href = `./?${criteriaToParams({ ...criteria("distance"), levels: [] }).toString()}`;
  dataset = await loadDataset();
  if (!dataset) {
    els.count.textContent = "Couldn't load vacancy data. Please reload the page.";
    return;
  }
  showFreshness(els.freshness, dataset);
  const fromUrl = new URLSearchParams(location.search).get("sort");
  if (fromUrl && (SORTS as readonly string[]).includes(fromUrl)) els.sort.value = fromUrl;
  els.sort.addEventListener("change", () => {
    history.replaceState(null, "", els.sort.value === "distance" ? location.pathname : `?sort=${els.sort.value}`);
    update();
  });
  els.more.addEventListener("click", renderMore);
  update();
}

start();
