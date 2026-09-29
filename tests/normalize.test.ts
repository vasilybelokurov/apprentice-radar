import { describe, expect, it } from "vitest";
import { VacancySchema } from "../src/sync/dfe-schema.ts";
import { normalizeVacancy, safeVacancyUrl } from "../src/sync/normalize.ts";
import { dfeItem } from "./fixtures.ts";

const normalize = (overrides: Record<string, unknown> = {}) => normalizeVacancy(VacancySchema.parse(dfeItem(overrides)));

describe("normalizeVacancy", () => {
  it("maps an ordinary single-location vacancy", () => {
    const v = normalize();
    expect(v).toMatchObject({
      ref: "1000000001",
      title: "Engineering Operative Apprentice",
      employer: "Example Engineering Ltd",
      course: { level: 2, route: "Engineering and manufacturing", type: "Standard" },
      levelName: "Intermediate",
      closes: "2099-10-30T23:59:59.000Z",
      pay: { type: "ApprenticeshipMinimum", text: "£16,640 a year", minAnnual: 16640, maxAnnual: 16640 },
      national: false,
    });
    expect(v.locations).toEqual([{ label: "Cambridge, Cambridgeshire CB1 2AB", postcode: "CB1 2AB", lat: 52.2, lon: 0.13 }]);
  });

  it("keeps every location of a multi-location vacancy on one record", () => {
    const addresses = [
      { addressLine1: "A", addressLine2: "Ely", postcode: "cb7 4aa", latitude: 52.4, longitude: 0.26 },
      { addressLine1: "B", addressLine2: "Leeds", addressLine3: "Leeds", postcode: "LS1 1AA", latitude: 53.8, longitude: -1.55 },
    ];
    const v = normalize({ addresses });
    expect(v.locations).toHaveLength(2);
    expect(v.locations[0]).toMatchObject({ label: "Ely CB7 4AA", postcode: "CB7 4AA" });
    expect(v.locations[1]!.label).toBe("Leeds LS1 1AA"); // repeated line collapsed
  });

  it("handles a national vacancy with no address", () => {
    const v = normalize({ isNationalVacancy: true, addresses: [] });
    expect(v.national).toBe(true);
    expect(v.locations).toEqual([]);
  });

  it("keeps a location without coordinates, with null lat/lon", () => {
    const v = normalize({ addresses: [{ addressLine1: "X", postcode: "ST1 5HR", latitude: null, longitude: null }] });
    expect(v.locations[0]).toMatchObject({ postcode: "ST1 5HR", lat: null, lon: null });
  });

  it("treats 0,0 and out-of-range coordinates as missing", () => {
    const v = normalize({ addresses: [{ postcode: "A1 1AA", latitude: 0, longitude: 0 }, { postcode: "B1 1BB", latitude: 95, longitude: 1 }] });
    expect(v.locations.map((l) => l.lat)).toEqual([null, null]);
  });

  it("never invents pay for competitive salary", () => {
    const v = normalize({ wage: { wageType: "CompetitiveSalary", wageUnit: "Annually", wageAdditionalInformation: "Competitive" } });
    expect(v.pay).toEqual({ type: "CompetitiveSalary", text: "Competitive", minAnnual: null, maxAnnual: null });
  });

  it("reads the national-minimum range", () => {
    const v = normalize({ wage: { wageType: "NationalMinimum", wageUnit: "Annually", wageAdditionalInformation: "£12,480 to £19,827.60 a year" } });
    expect(v.pay).toMatchObject({ minAnnual: 12480, maxAnnual: 19827.6 });
  });

  it("does not parse non-yearly wage units", () => {
    const v = normalize({ wage: { wageType: "Custom", wageUnit: "Weekly", wageAdditionalInformation: "£16,640 a year" } });
    expect(v.pay.minAnnual).toBeNull();
  });

  it("keeps the foundation course type", () => {
    expect(normalize({ course: { title: "X", level: 2, route: "Digital", type: "Foundation" } }).course.type).toBe("Foundation");
  });

  it("accepts a numeric vacancyReference", () => {
    expect(normalize({ vacancyReference: 42 }).ref).toBe("42");
  });
});

describe("schema", () => {
  it("rejects records missing required fields", () => {
    expect(VacancySchema.safeParse(dfeItem({ closingDate: undefined })).success).toBe(false);
    expect(VacancySchema.safeParse(dfeItem({ title: "" })).success).toBe(false);
    expect(VacancySchema.safeParse(dfeItem({ postedDate: "yesterday" })).success).toBe(false);
  });
});

describe("safeVacancyUrl", () => {
  it("keeps https links", () => {
    expect(safeVacancyUrl("https://example.org/a", "1")).toBe("https://example.org/a");
  });
  it.each(["javascript:alert(1)", "data:text/html,x", "not a url", null])("replaces %j with the official page", (url) => {
    expect(safeVacancyUrl(url, "123")).toBe("https://www.findapprenticeship.service.gov.uk/apprenticeship/reference/123");
  });
});
