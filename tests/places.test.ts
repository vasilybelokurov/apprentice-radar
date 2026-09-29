import { describe, expect, it, vi } from "vitest";
import { rankPlaces, resolvePlace } from "../src/lib/places.ts";
import { jsonResponse } from "./fixtures.ts";

// Mirrors the live Postcodes.io /places?q=Cambridge response order on 2026-09-29: the city is 4th.
const cambridgeResults = [
  { name_1: "Cambridge", local_type: "Other Settlement", county_unitary: "Norfolk", district_borough: "Broadland", region: "Eastern", country: "England", latitude: 52.7694, longitude: 1.2453 },
  { name_1: "Cambridge", local_type: "Village", county_unitary: "Gloucestershire", district_borough: "Stroud", region: "South West", country: "England", latitude: 51.7307, longitude: -2.3644 },
  { name_1: "Cambridge", local_type: "Suburban Area", county_unitary: null, district_borough: "Leeds", region: "Yorkshire and the Humber", country: "England", latitude: 53.9009, longitude: -1.6819 },
  { name_1: "Cambridge", local_type: "City", county_unitary: "Cambridgeshire", district_borough: "Cambridge", region: "Eastern", country: "England", latitude: 52.2049, longitude: 0.1197 },
  { name_1: "Little Cambridge", local_type: "Hamlet", county_unitary: "Essex", district_borough: "Uttlesford", region: "Eastern", country: "England", latitude: 51.9195, longitude: 0.3461 },
];

const fakeFetch = (routes: Record<string, unknown>) =>
  vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    for (const [pattern, body] of Object.entries(routes)) if (u.toLowerCase().includes(pattern.toLowerCase())) return jsonResponse(body);
    return jsonResponse({ status: 404 }, 404);
  }) as unknown as typeof fetch;

describe("rankPlaces", () => {
  it("puts the city first among exact-name matches", () => {
    const ranked = rankPlaces(cambridgeResults, "Cambridge");
    expect(ranked[0]).toMatchObject({ label: "Cambridge, Cambridgeshire", lat: 52.2049 });
    expect(ranked.map((r) => r.label)).not.toContain("Little Cambridge, Essex");
  });

  it("narrows by county after a comma", () => {
    expect(rankPlaces(cambridgeResults, "Cambridge, Gloucestershire")[0]).toMatchObject({ label: "Cambridge, Gloucestershire" });
  });
});

describe("resolvePlace", () => {
  it("resolves the default query to Cambridge city without asking", async () => {
    const f = fakeFetch({ "/places?q=Cambridge": { result: cambridgeResults } });
    expect(await resolvePlace("Cambridge, Cambridgeshire", f)).toEqual([
      expect.objectContaining({ label: "Cambridge, Cambridgeshire", lat: 52.2049, lon: 0.1197 }),
    ]);
    expect(await resolvePlace("cambridge", f)).toHaveLength(1); // single city: no choice needed
  });

  it("offers choices when several towns share a name", async () => {
    const newport = [
      { name_1: "Newport", local_type: "City", county_unitary: "Newport", district_borough: null, region: null, country: "Wales", latitude: 51.58, longitude: -3.0 },
      { name_1: "Newport", local_type: "Town", county_unitary: "Isle of Wight", district_borough: null, region: "South East", country: "England", latitude: 50.7, longitude: -1.29 },
      { name_1: "Newport", local_type: "Town", county_unitary: "Telford and Wrekin", district_borough: null, region: "West Midlands", country: "England", latitude: 52.77, longitude: -2.38 },
    ];
    const choices = await resolvePlace("Newport", fakeFetch({ "/places?q=Newport": { result: newport } }));
    expect(choices.length).toBe(3);
  });

  it("resolves a full postcode", async () => {
    const f = fakeFetch({ "/postcodes/CB2": { result: { postcode: "CB2 1TN", admin_district: "Cambridge", region: "East of England", latitude: 52.2, longitude: 0.12 } } });
    expect(await resolvePlace("CB2 1TN", f)).toEqual([expect.objectContaining({ label: "CB2 1TN", lat: 52.2 })]);
  });

  it("returns nothing for an unknown postcode or empty query", async () => {
    const f = fakeFetch({});
    expect(await resolvePlace("ZZ9 9ZZ", f)).toEqual([]);
    expect(await resolvePlace("   ", f)).toEqual([]);
  });
});
