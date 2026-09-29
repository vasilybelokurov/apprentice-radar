// Reads yearly pay figures from DfE wage wording. Never invents a figure: anything that is not
// exactly "£N a year" or "£N to £M a year" (e.g. "Competitive") gives nulls.

const AMOUNT = String.raw`£(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)`;
const YEARLY = new RegExp(`^${AMOUNT}(?: to ${AMOUNT})? a year$`);

const toNumber = (s: string) => Number(s.replaceAll(",", ""));

export function parseAnnualPay(text: string | null | undefined): { minAnnual: number | null; maxAnnual: number | null } {
  const match = YEARLY.exec((text ?? "").trim());
  if (!match?.[1]) return { minAnnual: null, maxAnnual: null };
  const min = toNumber(match[1]);
  const max = match[2] ? toNumber(match[2]) : min;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return { minAnnual: null, maxAnnual: null };
  return { minAnnual: min, maxAnnual: max };
}
