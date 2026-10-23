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
