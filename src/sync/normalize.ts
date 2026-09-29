// Converts validated DfE records into the compact published Vacancy model.
import { parseAnnualPay } from "../lib/pay.ts";
import type { Location, Vacancy } from "../lib/types.ts";
import type { DfeVacancy } from "./dfe-schema.ts";

const FAA_VACANCY_URL = "https://www.findapprenticeship.service.gov.uk/apprenticeship/reference/";

const clean = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
};

/** Only http(s) links are published; anything else falls back to the official page for the reference. */
export function safeVacancyUrl(url: string | null | undefined, ref: string): string {
  try {
    const u = new URL(url ?? "");
    if (u.protocol === "https:" || u.protocol === "http:") return u.toString();
  } catch {
    // fall through
  }
  return FAA_VACANCY_URL + encodeURIComponent(ref);
}

const validCoord = (lat: number | null | undefined, lon: number | null | undefined) =>
  typeof lat === "number" && typeof lon === "number" && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);

export function normalizeLocations(addresses: DfeVacancy["addresses"]): Location[] {
  return (addresses ?? []).map((a) => {
    const postcode = clean(a.postcode)?.toUpperCase() ?? null;
    const lines = [a.addressLine2, a.addressLine3, a.addressLine4].map(clean).filter((l): l is string => l !== null);
    const label = [...new Set(lines)].join(", ") + (postcode ? ` ${postcode}` : "");
    const ok = validCoord(a.latitude, a.longitude);
    return {
      label: label.trim() || clean(a.addressLine1) || postcode || "Address not given",
      postcode,
      lat: ok ? a.latitude! : null,
      lon: ok ? a.longitude! : null,
    };
  });
}

export function normalizeVacancy(v: DfeVacancy): Vacancy {
  const payText = clean(v.wage?.wageAdditionalInformation);
  // Only yearly wording is parsed; the source currently reports every wage as "Annually".
  const isYearly = (v.wage?.wageUnit ?? "Annually") === "Annually";
  const { minAnnual, maxAnnual } = isYearly ? parseAnnualPay(payText) : { minAnnual: null, maxAnnual: null };
  return {
    ref: v.vacancyReference,
    title: v.title.trim(),
    employer: clean(v.employerName),
    provider: clean(v.providerName),
    description: clean(v.description),
    course: {
      title: clean(v.course?.title),
      level: v.course?.level ?? null,
      route: clean(v.course?.route),
      type: clean(v.course?.type),
    },
    levelName: clean(v.apprenticeshipLevel),
    posted: new Date(v.postedDate).toISOString(),
    closes: new Date(v.closingDate).toISOString(),
    starts: v.startDate ? new Date(v.startDate).toISOString() : null,
    hoursPerWeek: v.hoursPerWeek ?? null,
    duration: clean(v.expectedDuration),
    positions: v.numberOfPositions ?? null,
    pay: { type: clean(v.wage?.wageType), text: payText, minAnnual, maxAnnual },
    locations: normalizeLocations(v.addresses),
    national: v.isNationalVacancy ?? false,
    disabilityConfident: v.isDisabilityConfident ?? false,
    url: safeVacancyUrl(v.vacancyUrl, v.vacancyReference),
  };
}
