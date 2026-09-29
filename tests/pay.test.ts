import { describe, expect, it } from "vitest";
import { parseAnnualPay } from "../src/lib/pay.ts";

describe("parseAnnualPay", () => {
  it.each([
    ["£16,640 a year", 16640, 16640],
    ["£19,983.60 a year", 19983.6, 19983.6],
    ["£12,480 to £19,827.60 a year", 12480, 19827.6],
    ["£900 a year", 900, 900],
    ["  £22,000 a year  ", 22000, 22000],
  ])("reads %j", (text, min, max) => {
    expect(parseAnnualPay(text)).toEqual({ minAnnual: min, maxAnnual: max });
  });

  it.each([
    "Competitive",
    "",
    null,
    undefined,
    "£10 an hour",
    "£16,640 a year plus bonus",
    "£20,000 to £15,000 a year", // reversed range
    "£1,23 a year", // malformed thousands separator
    "Up to £20,000 a year",
  ])("gives no figure for %j", (text) => {
    expect(parseAnnualPay(text)).toEqual({ minAnnual: null, maxAnnual: null });
  });
});
