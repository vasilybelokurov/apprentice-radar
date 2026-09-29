// Synthetic DfE v2 list items, shaped like real responses (checked against the live API on 2026-09-29).

export function dfeItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    vacancyReference: "1000000001",
    title: "Engineering Operative Apprentice",
    description: "Learn to operate machinery.",
    numberOfPositions: 1,
    postedDate: "2026-09-01T10:00:00.000Z",
    closingDate: "2099-10-30T23:59:59Z",
    startDate: "2099-11-01T00:00:00Z",
    wage: {
      wageType: "ApprenticeshipMinimum",
      wageUnit: "Annually",
      wageAdditionalInformation: "£16,640 a year",
      workingWeekDescription: "Monday - Friday",
    },
    hoursPerWeek: 40,
    expectedDuration: "2 years",
    addresses: [
      {
        addressLine1: "1 Mill Road",
        addressLine2: "Cambridge",
        addressLine3: "Cambridgeshire",
        addressLine4: null,
        postcode: "CB1 2AB",
        latitude: 52.2,
        longitude: 0.13,
      },
    ],
    distance: 0,
    employerName: "Example Engineering Ltd",
    course: { larsCode: 352, title: "Engineering operative (level 2)", level: 2, route: "Engineering and manufacturing", type: "Standard" },
    apprenticeshipLevel: "Intermediate",
    providerName: "Example College",
    ukprn: 10000001,
    isDisabilityConfident: false,
    vacancyUrl: "https://www.findapprenticeship.service.gov.uk/apprenticeship/reference/1000000001",
    isNationalVacancy: false,
    isNationalVacancyDetails: null,
    ...overrides,
  };
}

export function page(items: unknown[], pageNumber: number, totalPages: number, totalFiltered: number) {
  return { total: totalFiltered + 10, totalFiltered, totalPages, pageNumber, vacancies: items };
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}
