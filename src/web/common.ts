// Shared by the pages: data loading, freshness notice and vacancy cards.
import { describeRequirement, gcseFit } from "../lib/requirements.ts";
import type { Match } from "../lib/search.ts";
import type { Dataset } from "../lib/types.ts";

const DAY_MS = 86_400_000;
const NEW_DAYS = 7;
const CLOSING_SOON_DAYS = 7;
const STALE_HOURS = 48;

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const fmtDate = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : "Not given");
const fmtMiles = (m: number) => (m < 10 ? m.toFixed(1) : Math.round(m).toString());

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string | null)[]) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) if (c !== null) node.append(c);
  return node;
}

/** Loads a published JSON file (vacancies.json, jobs.json); null on failure. */
export async function loadJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export const loadDataset = () => loadJson<Dataset>("./vacancies.json");

export function showFreshness(target: HTMLElement, dataset: Pick<Dataset, "generatedAt">) {
  const ageHours = (Date.now() - Date.parse(dataset.generatedAt)) / 3_600_000;
  target.textContent = `Data updated ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(dataset.generatedAt))}`;
  if (ageHours > STALE_HOURS) {
    target.textContent += " · may be out of date; check closing dates on the official page";
    target.classList.add("stale");
  }
}

export interface CardExtras {
  /** Extra labels: [text, class] with class "new" | "soon" | "info" | "warn". */
  badges?: [string, string][];
  /** Extra rows appended to the details list. */
  rows?: [string, Node | string][];
}

/** Entry requirements row and labels, shown when the "Open with GCSEs" filter is on. */
export function gcseExtras(m: Match): CardExtras {
  const fit = gcseFit(m.vacancy);
  const badges: [string, string][] = [];
  if (fit.level3Preferred) badges.push(["A levels or equivalent preferred", "warn"]);
  if (fit.drivingLicence) badges.push(["Driving licence required", "warn"]);
  const reqs = [...m.vacancy.requirements].sort((a, b) => Number(b.essential) - Number(a.essential));
  const value: Node | string = reqs.length
    ? el("ul", { class: "reqs" }, ...reqs.map((r) => el("li", {}, `${r.essential ? "Essential" : "Preferred"}: ${describeRequirement(r)}`)))
    : "None listed";
  return { badges, rows: [["Entry requirements", value]] };
}

export function card(m: Match, now: number, extras: CardExtras = {}): HTMLLIElement {
  const v = m.vacancy;
  const badges: HTMLElement[] = [];
  const badge = (text: string, cls: string) => badges.push(el("li", { class: `badge ${cls}` }, text));
  if (now - Date.parse(v.posted) <= NEW_DAYS * DAY_MS) badge("New", "new");
  if (Date.parse(v.closes) - now <= CLOSING_SOON_DAYS * DAY_MS) badge("Closing soon", "soon");
  for (const [text, cls] of extras.badges ?? []) badge(text, cls);
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
  rows.push(...(extras.rows ?? []));

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
