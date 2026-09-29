// Runtime validation of DfE Display Advert API v2 list responses.
// Unknown fields are ignored; fields the API may omit are optional/nullable.
import { z } from "zod";

const text = z.string().nullish();
const num = z.number().nullish();

export const AddressSchema = z.object({
  addressLine1: text,
  addressLine2: text,
  addressLine3: text,
  addressLine4: text,
  postcode: text,
  latitude: num,
  longitude: num,
});

export const VacancySchema = z.object({
  vacancyReference: z.union([z.string(), z.number()]).transform(String),
  title: z.string().min(1),
  description: text,
  numberOfPositions: num,
  postedDate: z.iso.datetime({ offset: true }),
  closingDate: z.iso.datetime({ offset: true }),
  startDate: z.iso.datetime({ offset: true }).nullish(),
  wage: z
    .object({
      wageType: text,
      wageUnit: text,
      wageAmount: num,
      wageAdditionalInformation: text,
    })
    .nullish(),
  hoursPerWeek: num,
  expectedDuration: text,
  addresses: z.array(AddressSchema).nullish(),
  employerName: text,
  course: z
    .object({
      title: text,
      level: num,
      route: text,
      type: text,
    })
    .nullish(),
  apprenticeshipLevel: text,
  providerName: text,
  isDisabilityConfident: z.boolean().nullish(),
  vacancyUrl: text,
  isNationalVacancy: z.boolean().nullish(),
});

export type DfeVacancy = z.infer<typeof VacancySchema>;

/** Page envelope; items are validated one by one so a single bad record cannot sink a page. */
export const ListPageSchema = z.object({
  total: z.number().int().nonnegative(),
  totalFiltered: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  vacancies: z.array(z.unknown()),
});

export type ListPage = z.infer<typeof ListPageSchema>;
