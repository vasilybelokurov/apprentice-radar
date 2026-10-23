// Type of work, read from the job title. Reed's API has no category field. The first matching group
// wins, so the order matters: "School Catering Assistant" is catering, "Retail Stock Room Assistant" is
// retail, "Customer Delivery Driver" is delivery.

export const JOB_CATEGORIES = [
  ["Hospitality & catering", /\b(chef|kitchen|catering|cook|waiter|waitress|waiting staff|barista|bartender|bar staff|hospitality|food service)/i],
  ["Cleaning", /\b(clean(er|ers|ing)|housekeep|domestic assistant|janitor|caretaker)/i],
  ["Schools & education", /\b(teaching|teacher|learning support|school|tutor|tutoring|sen\b|hlta|nursery|admissions|classroom|education|swim|invigilat|exams?)\b/i],
  ["Care & health", /\b(care|carer|support worker|health|phlebotom|optician|dental|pharmacy|nurse|hospital|clinic|tenancy sustainment)/i],
  ["Customer service", /\b(customer (service|support|advis|executive|experience)|call cent|contact cent|helpdesk)/i],
  ["Retail & sales", /\b(retail|sales|shop|store|merchandis|cashier|checkout|showroom|lettings|negotiator|loss prevention)/i],
  ["Warehouse, driving & delivery", /\b(warehouse|operative|picker|packer|despatch|dispatch|stock|replenish|driver|delivery|courier|rider|postal|post office|parcel|logistics|forklift|flt)/i],
  ["Office, admin & finance", /\b(admin|administrat|reception|office|clerk|secretar|data entry|resourcer|recruitment|legal|conveyanc|accounts?|finance|payroll|ledger|coordinator)/i],
  ["Construction, trades & technical", /\b(labourer|construction|electric|technician|installer|mechanic|automotive|fitter|plumb|carpent|joiner|painter|decorator|maintenance|retrofit|cscs|engineer|assembl|production|manufactur)/i],
] as const satisfies readonly (readonly [string, RegExp])[];

export const OTHER_CATEGORY = "Other";

export type JobCategory = (typeof JOB_CATEGORIES)[number][0] | typeof OTHER_CATEGORY;

export function jobCategory(title: string): JobCategory {
  for (const [name, re] of JOB_CATEGORIES) if (re.test(title)) return name;
  return OTHER_CATEGORY;
}
