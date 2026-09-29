// Renders the weekly alert issue (Markdown) and reads back which vacancies earlier issues contained.
import type { Match, SearchCriteria } from "../lib/search.ts";

/** Hidden line in each issue body listing the vacancy references it announced. */
const REFS_MARKER = /<!--\s*alert-refs:\s*([\w,\s-]*)-->/;

export function parseSentRefs(body: string | null | undefined): string[] {
  const m = REFS_MARKER.exec(body ?? "");
  return m?.[1] ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
const fmtDate = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : "not given");
// Keep source text from breaking the Markdown layout (links, headings, tables).
const md = (s: string) => s.replace(/[\\`*_[\]<>|#]/g, (c) => `\\${c}`).replace(/\s+/g, " ").trim();

export function describeCriteria(c: SearchCriteria): string {
  const parts: string[] = [];
  parts.push(c.place ? `within ${c.radiusMiles} miles of ${c.place.label}` : "anywhere in England");
  parts.push(c.levels.length ? `Level ${c.levels.join(", ")}` : "any level");
  if (c.routes.length) parts.push(c.routes.join(", "));
  if (c.keywords.trim()) parts.push(`keywords "${c.keywords.trim()}"`);
  if (c.employer.trim()) parts.push(`employer "${c.employer.trim()}"`);
  if (c.minPay !== null) parts.push(`pay from £${c.minPay.toLocaleString("en-GB")}${c.includeUnknownPay ? " (or not stated)" : ""}`);
  if (c.disabilityConfidentOnly) parts.push("Disability Confident only");
  if (c.foundationOnly) parts.push("Foundation only");
  if (c.includeNational) parts.push("including national roles");
  return parts.join(" · ");
}

export interface Digest {
  title: string;
  body: string;
  refs: string[];
}

export function renderDigest(matches: Match[], c: SearchCriteria, searchUrl: string, today: Date, mention: string): Digest {
  const n = matches.length;
  const where = c.place ? ` near ${c.place.label.split(",")[0]}` : "";
  const title = `${n} new apprenticeship${n === 1 ? "" : "s"}${where} (${dateFmt.format(today)})`;
  const items = matches.map((m, i) => {
    const v = m.vacancy;
    const level = v.course.level ? `Level ${v.course.level}` : "Level not given";
    const location = v.national
      ? "Recruiting nationally"
      : m.nearest
        ? `${md(m.nearest.location.label)} · ${m.nearest.miles.toFixed(1)} miles`
        : md(v.locations[0]?.label ?? "Location not given");
    const others = v.locations.length > 1 ? ` (+${v.locations.length - 1} other locations)` : "";
    return [
      `### ${i + 1}. [${md(v.title)}](${v.url})`,
      `**${md(v.employer ?? "Employer not given")}** · ${level}${v.course.title ? ` · ${md(v.course.title)}` : ""}`,
      "",
      `- Where: ${location}${others}`,
      `- Pay: ${md(v.pay.text ?? "not given")}`,
      `- Closes: ${fmtDate(v.closes)} · Starts: ${fmtDate(v.starts)}`,
    ].join("\n");
  });
  const body = [
    // The @mention is what makes GitHub notify (and email) the owner: an issue assigned via the
    // workflow token counts as the owner's own action, which GitHub never notifies about.
    `@${mention} **${n} new vacanc${n === 1 ? "y" : "ies"}** since the last alert, for: ${md(describeCriteria(c))}.`,
    "",
    `[See every current match on Apprentice Radar](${searchUrl})`,
    "",
    ...items.flatMap((item) => [item, ""]),
    "---",
    "Sent weekly by the `Send alerts` workflow. Apply on the official Find an apprenticeship page for each vacancy.",
    "",
    `<!-- alert-refs: ${matches.map((m) => m.vacancy.ref).join(",")} -->`,
  ].join("\n");
  return { title, body, refs: matches.map((m) => m.vacancy.ref) };
}
