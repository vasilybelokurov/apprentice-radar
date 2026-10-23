// Decides from a job's title, pay and advert text whether it suits an 18-year-old with GCSEs but no
// A levels. Reed has no structured entry requirements, so this reads the wording. Strong signals (a
// degree, A levels, a professional qualification or licence, "experienced", 2+ years) leave a job
// out with a stated reason; softer ones (a bullet asking for some experience) only add a label.
import type { JobFit } from "./types.ts";

/** Bump when the rules change: the sync then re-reads every advert instead of reusing old verdicts. */
export const JOB_RULE_VERSION = 6;

export interface JobInput {
  title: string;
  /** Full advert text, HTML already removed (see htmlToText). */
  text: string;
  pay: { type: string | null; min: number | null };
  partTime: boolean | null;
  contract: string | null;
}

// ---------- title ----------

const APPRENTICE_TITLE = /\bapprentice(ship)?s?\b/i;
const SENIOR_TITLE = /\b(senior|snr|sr|lead|leader|principal|head|director|manager|management|chief|partner|supervisor|vp|expert|experienced)\b/i;
const PROFESSION_TITLE = new RegExp(
  String.raw`\b(engineer|scientist|architect|solicitor|lawyer|barrister|paralegal|accountant|auditor|actuary|doctor|gp|surgeon|dentist|` +
    String.raw`nurse|midwife|physiotherapist|physio|pharmacist|optometrist|psychologist|therapist|social worker|surveyor|teacher|lecturer|` +
    String.raw`professor|postdoc|researcher|analyst|developer|programmer|consultant|specialist|broker|financial advis[eo]r|mortgage advis[eo]r|` +
    String.raw`hr advis[eo]r|underwriter|paraplanner|conveyancer|legal executive|legal secretary|legal pa|executive assistant|bookkeeper|` +
    String.raw`electrician|plumber|mechanic|mot tester|estimator|buyer|town planner|chef de partie|sous chef|recruiter|ecologist|valuer|` +
    String.raw`hlta|higher level teaching assistant|revit|autocad|cad|bim|2nd line|3rd line|second line|third line|hgv|lgv|class [12]|c\+e|cat c)\b`,
  "i",
);
/** Words that make a professional title an entry role ("Junior Electrician", "Electrician's Mate"). */
const TRAINEE_TITLE = /\b(trainee|junior|mate|entry[- ]level|school leavers?)\b/i;

// ---------- pay ----------

/** Pay this high usually means an experienced role (about £32k a year full time), unless the advert offers full training. */
const HIGH_PAY: Record<string, number> = { "per annum": 32_000, "per hour": 18, "per day": 150 };

// ---------- advert text ----------

interface Rule {
  re: RegExp;
  reason: string;
  /** Label to show instead when the advert says it is only preferred. */
  preferred?: string;
  /** Ignore matches on a short line of their own (a heading such as "Skills and Experience Required"). */
  notHeadings?: boolean;
  /** Ignore a match whose text also matches this ("you will have the opportunity to gain experience"). */
  unless?: RegExp;
  /** Ignore a match when the text just before it matches this ("Whether you're an experienced..."). */
  unlessBefore?: RegExp;
  /** Ignore a match in a sentence that matches this (equal-opportunities boilerplate). */
  unlessSentence?: RegExp;
}

/** Company boasts, not demands: "we have a proven track record", "our experienced team". */
const ABOUT_COMPANY = /\b(we|we've|our|they|their|the company|the firm|the business|who)\b[^.\n]*$/i;

const RULES: Rule[] = [
  // "degree", but not "a high degree of accuracy", "-20 degrees" or "360 degree".
  { re: /(?<!\d\s*)\bdegree\b(?!\s+of\b)|\bbachelor'?s\b|\b(bsc|msc|ph\.?d|postgraduate|graduate)\b/i, reason: "Needs a degree", preferred: "Degree preferred" },
  // Case-sensitive "A level", so "at a level that..." does not match.
  { re: /\bA[- ]?[Ll]evels?\b(?!\s*\d)(?!\s+of\b)|\bUCAS\b/, reason: "Needs A levels", preferred: "A levels preferred" },
  {
    re: /\b(level|lvl|nvq|l)\s*[3-7]\b/i,
    reason: "Needs a Level 3 or higher qualification",
    preferred: "Level 3 qualification preferred",
    // "NVQ level 2 or level 3": Level 2 is enough.
    unlessBefore: /\b(level|nvq|l)\s*2\s*(or|\/|-)\s*$/i,
  },
  {
    re: /\b(AAT|ACCA|CIMA|ACA|CeMAP|CII|SIA|CPCS|NPORS|IPAF|JIB|ECS card|Gas Safe|GDC|NMC|HCPC|HLTA|RTPI|City (&|and) Guilds|1[78]th [Ee]dition)\b/,
    reason: "Needs a professional qualification or licence",
    preferred: "Professional qualification preferred",
  },
  {
    re: /\b(fully|suitably|appropriately|professionally|must be|you are|you're) qualified\b|\bqualified (electrician|plumber|chef|accountant|teacher|nurse|technician|mechanic|engineer|practitioner)\b/i,
    reason: "Needs to be qualified",
    // "Progression to Qualified Electrician", "once you're qualified" describe the future, not a demand.
    unlessBefore: /\b(to|into|train|training|become|becoming|towards|progression|progress|once|until|when|even if)\b[^.\n]{0,60}$/i,
    unlessSentence: /\b(applications?|applicants|candidates|eligible|equal opportunit)/i,
  },
  { re: /\b(HGV|LGV|C\+E|Class [12]\b|Cat(egory)? C1?\b|C1 licen[cs]e|7\.5 ?t(onne)?)/, reason: "Needs an HGV or category C licence" },
  { re: /\b(FLT|fork ?lift|counterbalance|reach truck)\b[^.\n]{0,30}\b(licen[cs]e|certificate|ticket)/i, reason: "Needs a forklift licence", preferred: "Forklift licence preferred" },
  { re: /\b(over|aged|minimum age( of)?|at least)\s*(21|22|23|24|25)\b|\b(21|25)\s*(\+|or over)/i, reason: "Must be 21 or over" },
  {
    re: /\b(are you|we need|you are|you're|you will be|must be|hiring|seeking|recruit|recruiting|looking for|for)\s+(an?\s+)?((skilled|reliable|confident|motivated|enthusiastic|dedicated|friendly|proactive|highly|suitably|and|,)\s*){0,4}experienced\b/i,
    reason: "Needs previous experience",
    preferred: "Experience preferred",
    // "Whether you're an experienced TA or looking to take the next step..." welcomes both.
    unlessBefore: /\bwhether\b[^.\n]*$/i,
    unlessSentence: /\bwhether\b[^.\n]*\bor\b/i,
  },
  {
    re: /\b(proven|extensive|significant|substantial|demonstrable|solid|strong)\s+([\w-]+\s+){0,2}?(track record|experience|background)\b/i,
    reason: "Needs proven experience",
    preferred: "Experience preferred",
    unlessBefore: ABOUT_COMPANY,
  },
  {
    re: /\bexperience\b[^.\n]{0,50}\b(essential|required|a must|mandatory)\b/i,
    reason: "Needs previous experience",
    preferred: "Experience preferred",
    notHeadings: true,
    unless: /\b(not|no)\b|n't\b/i,
  },
  {
    re: /\b(you|candidates?|the (ideal|successful) candidate|applicants?)\s+(will|must|should|need to|needs to|will need to)\s+(have|possess|bring|hold|be able to demonstrate)\b[^.\n]{0,120}\bexperience\b|\bmust (have|possess)\b[^.\n]{0,40}\bexperience\b|\brequires? (you|candidates|applicants) to have\b[^.\n]{0,80}\bexperience\b/i,
    reason: "Needs previous experience",
    preferred: "Experience preferred",
    unless: /\b(gain|gaining|develop|build|get|grow|opportunit|chance)/i,
  },
  {
    re: /\b(strong|in[- ]depth|thorough|expert|extensive|detailed|sound)\s+(working\s+)?(knowledge|understanding)\s+(of|in)\b/i,
    reason: "Needs specialist knowledge",
    preferred: "Specialist knowledge preferred",
    unlessBefore: ABOUT_COMPANY,
  },
  // Pay-to-train schemes advertised as jobs.
  {
    re: /\bcourse fees?\b|\bfees apply\b|\bguaranteed? (a )?job offer\b|\bmini-course\b|\bcareer switch\b|\b(spread|pay|cost of) (the cost of )?(your|the) training\b/i,
    reason: "Paid training course, not a job",
  },
];

/** Softer: a bullet or sentence asking for experience in something. Labelled, not excluded. */
const SOME_EXPERIENCE = /^(•\s*)?((has|have|with|you have|you'll have|you will have|you will ideally bring)\s+)?((previous|prior|relevant|practical|recent|some)\s+)?([\w-]+\s+){0,3}?experience\b/i;

const EXPERIENCE_YEARS = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*\+?\s*(?:-\s*\d+\s*)?(?:years?|yrs?)['’]?\s+(?:of\s+)?(?:[\w-]+\s+){0,4}?experience\b/i;
const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
/** The sentence talks about the applicant, not the company ("with over 30 years' experience, the firm..."). */
const ABOUT_APPLICANT = /^\s*•|\b(you|your|candidate|applicant|minimum|at least|required|essential|must|ideally|need|needed)\b/i;

/** Negation shortly before a match ("no degree needed", "don't need A levels")... */
const NEGATED_BEFORE = /\b(no|not|zero|without|don'?t|doesn'?t|isn'?t|aren'?t|never|nor)\b[^.\n]{0,40}$/i;
/** ...or after it ("a degree is not required"). */
const NEGATED_AFTER = /^[^.\n]{0,60}\b(not|isn'?t|aren'?t)\s+(required|necessary|essential|needed|a requirement)\b/i;
const PREFERRED_WORD = /\b(desirable|desired|preferred|preferable|advantageous|advantage|a plus|bonus|ideally|nice to have|beneficial|useful|welcomed?|would be great|is a plus)\b/i;
/** Section headings in adverts. */
const PREFERRED_HEADING = /^(•\s*)?(desirable|nice to have|bonus|preferred|advantageous|it would be (great|nice|beneficial)|ideally|you will ideally)\b[^\n]{0,60}$/i;
const REQUIRED_HEADING = /^(•\s*)?(essential|requirements?|what you('ll| will) need|what we('re| are) looking for|about you|you will have|you'll have|key skills|skills and experience|the ideal candidate)\b[^\n]{0,60}$/i;

const DRIVING = /\b(driving licen[cs]e|own (car|transport|vehicle)|drivers? licen[cs]e)\b/i;
const TRAINING_GIVEN =
  /\b(no (previous |prior |relevant )?experience (is )?(needed|necessary|required)|(previous |prior )?experience is not (essential|necessary|required)|full training (is |will be )?(given|provided)|training (is |will be )?provided|we will train|entry[- ]level|school leavers?)\b/i;

interface Context {
  /** Whole sentence or bullet. */
  text: string;
  before: string;
  after: string;
  /** The nearest heading above, if the advert has one. */
  heading: "preferred" | "required" | null;
}

/** The sentence (or bullet) around a match, and the advert heading it sits under. */
function contextAt(text: string, index: number, length: number): Context {
  const start = Math.max(text.lastIndexOf(". ", index), text.lastIndexOf("\n", index)) + 1;
  const ends = [text.indexOf(". ", index + length), text.indexOf("\n", index + length)].filter((n) => n >= 0);
  const end = ends.length ? Math.min(...ends) : text.length;
  let heading: Context["heading"] = null;
  const linesAbove = text.slice(Math.max(0, index - 800), start).split("\n").reverse();
  for (const line of linesAbove.slice(0, 15)) {
    const l = line.trim();
    if (PREFERRED_HEADING.test(l) && !/^•/.test(l)) {
      heading = "preferred";
      break;
    }
    if (REQUIRED_HEADING.test(l) && !/^•/.test(l)) {
      heading = "required";
      break;
    }
  }
  return { text: text.slice(start, end), before: text.slice(start, index), after: text.slice(index + length, end), heading };
}

const isNegated = (c: Context) => NEGATED_BEFORE.test(c.before) || NEGATED_AFTER.test(c.after);

/** Preferred if the cue comes before the match, right after it (no comma or bracket between), or the heading says so. */
const isPreferred = (c: Context) => PREFERRED_WORD.test(c.before) || PREFERRED_WORD.test(c.after.split(/[,(]/)[0] ?? "") || c.heading === "preferred";

type Strength = "required" | "preferred" | "negated";

interface Found {
  strength: Strength;
  /** The sentence that decided it. */
  quote: string;
}

const quote = (c: Context) => {
  const t = c.text.replace(/^\s*•\s*/, "").trim();
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
};

function find(text: string, re: RegExp, options: Pick<Rule, "notHeadings" | "unless" | "unlessBefore" | "unlessSentence"> = {}): Found | null {
  const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let best: Found | null = null;
  for (const m of text.matchAll(global)) {
    if (options.unless?.test(m[0])) continue;
    const c = contextAt(text, m.index, m[0].length);
    if (options.notHeadings && c.text.trim().length <= 45 && !/^\s*•/.test(c.text)) continue;
    if (options.unlessBefore?.test(c.before) || options.unlessSentence?.test(c.text)) continue;
    const s: Strength = isNegated(c) ? "negated" : isPreferred(c) ? "preferred" : "required";
    if (s === "required") return { strength: s, quote: quote(c) };
    if (s === "preferred" || best === null) best = { strength: s, quote: quote(c) };
  }
  return best;
}

function minYearsOfExperience(text: string): { years: number; quote: string } {
  let most = 0;
  let evidence = "";
  for (const m of text.matchAll(new RegExp(EXPERIENCE_YEARS.source, "gi"))) {
    const c = contextAt(text, m.index, m[0].length);
    if (!ABOUT_APPLICANT.test(c.text) || isNegated(c) || isPreferred(c)) continue;
    const raw = m[1]!.toLowerCase();
    const n = WORD_NUMBERS[raw] ?? Number(raw);
    if (Number.isFinite(n) && n <= 15 && n > most) {
      most = n;
      evidence = quote(c);
    }
  }
  return { years: most, quote: evidence };
}

/** Lines (usually bullets) that ask for experience and are not marked as preferred. */
function experienceAsks(text: string): string[] {
  const asks: string[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const l = line.trim();
    const at = text.indexOf(line, offset);
    offset = at + line.length;
    if (!SOME_EXPERIENCE.test(l) || NEGATED_BEFORE.test(l) || NEGATED_AFTER.test(l) || PREFERRED_WORD.test(l)) continue;
    if (contextAt(text, at, line.length).heading === "preferred") continue;
    asks.push(l.replace(/^•\s*/, "").slice(0, 160));
  }
  return asks;
}

const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "’", "&rsquo;": "’", "&lsquo;": "‘", "&pound;": "£", "&ndash;": "–", "&mdash;": "—" };

/** Decodes the HTML entities Reed uses, including numeric ones such as &#163; (£). */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e);
}

/** Turns advert HTML into plain text: one line per paragraph or heading, "• " for list items. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<\s*(br|\/p|\/li|\/h\d|\/div|\/ul|\/ol)\s*\/?>/gi, "\n")
      .replace(/<\s*li[^>]*>/gi, "\n• ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    // Plain-text bullets ("* item", "- item", "· item", "o item") become "• item".
    .replace(/^[*\-·o]\s+/gm, "• ")
    .trim();
}

/** Title-only verdict: lets the sync skip fetching adverts for jobs ruled out by their title. */
export function titleReasons(title: string): string[] {
  if (APPRENTICE_TITLE.test(title)) return ["Apprenticeship (see the apprenticeship search)"];
  if (SENIOR_TITLE.test(title)) return ["Senior or management role"];
  if (PROFESSION_TITLE.test(title) && !TRAINEE_TITLE.test(title)) return ["Role needs professional qualifications or experience"];
  return [];
}

export function jobFit(job: JobInput): JobFit {
  const reasons = [...titleReasons(job.title)];
  const evidence = reasons.map(() => `Job title: ${job.title}`);
  const labels: string[] = [];
  const exclude = (reason: string, quote: string) => {
    if (reasons.includes(reason)) return;
    reasons.push(reason);
    evidence.push(quote);
  };

  const trainingGiven = TRAINING_GIVEN.test(job.text);
  const limit = job.pay.type ? HIGH_PAY[job.pay.type] : undefined;
  if (limit !== undefined && job.pay.min !== null && job.pay.min >= limit && !trainingGiven) {
    exclude("Pay suggests an experienced role", `Pay from ${job.pay.min} ${job.pay.type}`);
  }

  for (const rule of RULES) {
    const f = find(job.text, rule.re, rule);
    if (f?.strength === "required") exclude(rule.reason, f.quote);
    else if (f?.strength === "preferred" && rule.preferred) labels.push(rule.preferred);
  }
  const years = minYearsOfExperience(job.text);
  if (years.years >= 2) exclude(`Needs ${years.years}+ years' experience`, years.quote);
  else if (years.years === 1) labels.push("Asks for a year's experience");
  else {
    // One bullet asking for experience is common even in entry jobs; several mean an experienced hire.
    const asks = experienceAsks(job.text);
    if (asks.length >= 2) exclude("Needs previous experience", asks.slice(0, 2).join(" / "));
    else if (asks.length === 1) labels.push("Asks for some experience");
  }

  if (find(job.text, DRIVING)?.strength === "required") labels.push("Driving licence required");
  if (trainingGiven) labels.push("No experience needed / training given");
  if (job.partTime) labels.push("Part time");
  if (job.contract && job.contract !== "Permanent") labels.push(job.contract === "Contract" ? "Fixed-term contract" : job.contract);

  return { suitable: reasons.length === 0, reasons, evidence, labels: [...new Set(labels)] };
}
