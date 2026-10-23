// Compact vacancy model published to the site (data/vacancies.json) and used by search and alerts.

export interface Location {
  /** Source address lines 2-4 plus postcode, as written by the source. */
  label: string;
  postcode: string | null;
  lat: number | null;
  lon: number | null;
}

export interface Pay {
  /** DfE wageType: ApprenticeshipMinimum | NationalMinimum | Custom | CompetitiveSalary. */
  type: string | null;
  /** Source wording, e.g. "£16,640 a year" or "Competitive". Always shown to the user. */
  text: string | null;
  /** Yearly amounts read from the source wording; null when the source gives no figure. */
  minAnnual: number | null;
  maxAnnual: number | null;
}

/** One entry requirement, as the employer wrote it (DfE "qualifications"). */
export interface Requirement {
  /** DfE weighting "Essential"; anything else ("Desired") is false. */
  essential: boolean;
  /** Source qualification type, e.g. "GCSE" or "A Level"; free text for some employers. */
  type: string | null;
  subject: string | null;
  grade: string | null;
}

export interface Vacancy {
  ref: string;
  title: string;
  employer: string | null;
  provider: string | null;
  description: string | null;
  course: {
    title: string | null;
    level: number | null;
    route: string | null;
    /** DfE course type, e.g. "Standard" or "Foundation". */
    type: string | null;
  };
  /** DfE level name, e.g. "Intermediate" (Level 2). */
  levelName: string | null;
  posted: string;
  closes: string;
  starts: string | null;
  hoursPerWeek: number | null;
  duration: string | null;
  positions: number | null;
  pay: Pay;
  requirements: Requirement[];
  locations: Location[];
  national: boolean;
  disabilityConfident: boolean;
  url: string;
}

export interface Dataset {
  generatedAt: string;
  source: string;
  /** Count reported by the source (totalFiltered) at sync time. */
  sourceCount: number;
  vacancies: Vacancy[];
}

// ---------- jobs (Reed) ----------

/** Verdict of the "suitable with GCSEs, no A levels" rule (src/lib/jobs-fit.ts). */
export interface JobFit {
  suitable: boolean;
  /** Why it was left out, e.g. "Needs a degree". */
  reasons: string[];
  /** For each reason, the advert sentence (or title/pay) that triggered it. */
  evidence: string[];
  /** Shown on the card, e.g. "Driving licence required". */
  labels: string[];
}

export interface Job {
  id: string;
  title: string;
  employer: string | null;
  /** Reed location: a town or a postcode. */
  location: string;
  lat: number | null;
  lon: number | null;
  /** Straight-line distance from the origin of the dataset. */
  miles: number | null;
  posted: string | null;
  expires: string | null;
  pay: {
    /** e.g. "£21,257 - £23,233 per annum" or "£14.24 - £15.00 per hour". */
    text: string | null;
    /** Reed salaryType: "per annum" | "per hour" | "per day" | ... */
    type: string | null;
    min: number | null;
    max: number | null;
    /** Yearly figure from Reed, when it gives one. */
    minYearly: number | null;
  };
  partTime: boolean | null;
  /** Reed contractType: "Permanent" | "Temporary" | "Contract". */
  contract: string | null;
  /** Start of the advert text (plain), for the card. */
  summary: string | null;
  url: string;
  /** True when the verdict comes from the whole advert (Reed details), not only the title/location. */
  fullAdvert: boolean;
  fit: JobFit;
}

export interface JobsDataset {
  generatedAt: string;
  source: string;
  /** Changes whenever the suitability rule changes; cached verdicts from other versions are not reused. */
  ruleVersion: number;
  origin: { label: string; lat: number; lon: number };
  radiusMiles: number;
  /** Every job within the radius, suitable or not. */
  jobs: Job[];
}
