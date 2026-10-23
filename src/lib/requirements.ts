// Reads employers' entry requirements to decide whether someone with GCSEs but no A levels
// (or other Level 3 qualification) meets them. Conservative: an essential requirement that is
// not recognisably GCSE-level or a non-qualification (DBS check, driving licence) rules a vacancy out.
import type { Requirement, Vacancy } from "./types.ts";

export type RequirementKind =
  /** GCSEs, Functional Skills, English/maths, or a generic "Level 2 or above". */
  | "gcse"
  /** A levels and equivalents or higher: T Level, BTEC, UCAS points, Level 3+, degree, HNC. */
  | "level3"
  /** DBS check, driving licence, CSCS card, IT skills, experience, "None". */
  | "not-a-qualification"
  /** Anything else, e.g. a Level 2 early years or accounting qualification. */
  | "other";

// "A level" but not "a Level 2 ...", which is the article followed by a level number.
const LEVEL3 =
  /\ba[- ]?levels?\b(?!\s*\d)|\bt[- ]?levels?\b|\bbtec\b|\bucas\b|\bdegree\b|\bbachelor|\bhn[cd]\b|higher technical|\blevel\s*[3-7]\b|\bl[3-7]\b|\blv\s*[3-7]\b|early years educator/i;
const GCSE = /\bgcse|\bfunctional skills\b|^(english|maths?|mathematics)$/i;
const GENERIC_LEVEL_1_2 = /^(level\s*[12]|l[12])(\s+or\s+(above|equivalent))?$/i;
const NOT_A_QUALIFICATION = /\bdbs\b|\bdriv|\blicen[cs]e\b|\bcscs\b|\bcqc\b|\bcomputer skills\b|\bit skills\b|^(it|ict|none)$|\bexperience\b/i;
const DRIVING = /\bdriv|\blicen[cs]e\b/i;

/** Text to classify: the type, or for untyped/"Other" entries the subject. */
function requirementText(r: Requirement): string {
  const type = (r.type ?? "").trim();
  return /^(|other|qualification|undefined)$/i.test(type) ? (r.subject ?? "").trim() : type;
}

export function classifyRequirement(r: Requirement): RequirementKind {
  const text = requirementText(r);
  if (LEVEL3.test(text)) return "level3";
  if (GCSE.test(text) || GENERIC_LEVEL_1_2.test(text.trim())) return "gcse";
  if (NOT_A_QUALIFICATION.test(text)) return "not-a-qualification";
  return "other";
}

export interface GcseFit {
  /** True when every essential requirement is GCSE-level or not a qualification. */
  suitable: boolean;
  /** Essential requirements that rule the vacancy out. */
  blockers: Requirement[];
  /** A levels or equivalent listed as desired (not essential). */
  level3Preferred: boolean;
  /** An essential driving licence. */
  drivingLicence: boolean;
}

export function gcseFit(v: Pick<Vacancy, "requirements">): GcseFit {
  const blockers: Requirement[] = [];
  let level3Preferred = false;
  let drivingLicence = false;
  for (const r of v.requirements) {
    const kind = classifyRequirement(r);
    if (r.essential) {
      if (kind === "level3" || kind === "other") blockers.push(r);
      if (kind === "not-a-qualification" && DRIVING.test(requirementText(r))) drivingLicence = true;
    } else if (kind === "level3") {
      level3Preferred = true;
    }
  }
  return { suitable: blockers.length === 0, blockers, level3Preferred, drivingLicence };
}

/** "GCSE: English and Maths (9-4/A*-C)" from the employer's wording. */
export function describeRequirement(r: Requirement): string {
  const subject = r.subject && r.subject.toLowerCase() !== r.type?.toLowerCase() ? r.subject : null;
  const head = [r.type, subject].filter(Boolean).join(": ") || "Qualification";
  const grade = r.grade && !/^(-|n\/?a)$/i.test(r.grade) && r.grade.toLowerCase() !== r.subject?.toLowerCase() ? r.grade : null;
  return grade ? `${head} (${grade})` : head;
}
