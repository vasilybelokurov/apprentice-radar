import { describe, expect, it } from "vitest";
import { jobCategory } from "../src/lib/job-category.ts";

// Titles from the live jobs list, 2026-10-23.
describe("jobCategory", () => {
  it.each([
    ["Part-Time Kitchen Assistant", "Hospitality & catering"],
    ["School Catering Assistant - Cambridge", "Hospitality & catering"],
    ["Cleaner", "Cleaning"],
    ["SEN Teaching Assistant Required", "Schools & education"],
    ["Learning Support Assistant", "Schools & education"],
    ["Admissions Officer - Cambridge", "Schools & education"],
    ["Swim Helper", "Schools & education"],
    ["Waking Night Support Worker - Child & Youth", "Care & health"],
    ["Phlebotomist", "Care & health"],
    ["Tenancy Sustainment Worker", "Care & health"],
    ["Customer Service Executive", "Customer service"],
    ["AD-HOC Retails Stock Room Assistant", "Retail & sales"],
    ["SALES ASSOCIATE", "Retail & sales"],
    ["Lettings Negotiator", "Retail & sales"],
    ["Loss Prevention Officer", "Retail & sales"],
    ["Customer Delivery Driver", "Warehouse, driving & delivery"],
    ["Parcelforce Warehouse Operative - Cambridge - Night Shift", "Warehouse, driving & delivery"],
    ["Gopuff Delivery Drivers or Riders", "Warehouse, driving & delivery"],
    ["Receptionist / Front of House", "Office, admin & finance"],
    ["Temporary Accounts Assistant", "Office, admin & finance"],
    ["Recruitment Resourcer", "Office, admin & finance"],
    ["Legal Assistant Residential  Conveyancing", "Office, admin & finance"],
    ["Junior Electrician / Electrician's Mate (Full Training)", "Construction, trades & technical"],
    ["CSCS Labourer", "Construction, trades & technical"],
    ["Retrofit Project Assistant", "Construction, trades & technical"],
    ["Dual Fuel SMART Meter Installer - Bedfordshire & Cambridge", "Construction, trades & technical"],
  ])("%j -> %s", (title, category) => expect(jobCategory(title)).toBe(category));

  it("falls back to Other", () => expect(jobCategory("Brand Ambassador")).toBe("Other"));
});
