import { describe, expect, it, vi } from "vitest";
import { fillMissingCoordinates } from "../src/sync/geocode.ts";
import { VacancySchema } from "../src/sync/dfe-schema.ts";
import { normalizeVacancy } from "../src/sync/normalize.ts";
import { dfeItem, jsonResponse } from "./fixtures.ts";

const vacancyAt = (addresses: unknown[]) => normalizeVacancy(VacancySchema.parse(dfeItem({ addresses })));
const missing = (postcode: string) => ({ postcode, latitude: null, longitude: null });

/** Fake Postcodes.io: `live` answers the bulk endpoint, `terminated` the withdrawn-postcode endpoint. */
function fakePostcodesIo(live: Record<string, [number, number]>, terminated: Record<string, [number, number]> = {}) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/postcodes") && init?.method === "POST") {
      const { postcodes } = JSON.parse(String(init.body)) as { postcodes: string[] };
      return jsonResponse({
        result: postcodes.map((q) => ({ query: q, result: live[q] ? { latitude: live[q][0], longitude: live[q][1] } : null })),
      });
    }
    const m = /\/terminated_postcodes\/(.+)$/.exec(u);
    if (m) {
      const hit = terminated[decodeURIComponent(m[1]!)];
      return hit ? jsonResponse({ result: { latitude: hit[0], longitude: hit[1] } }) : jsonResponse({ error: "not found" }, 404);
    }
    throw new Error(`unexpected request ${u}`);
  });
}

describe("fillMissingCoordinates", () => {
  it("looks up only missing postcodes, once each, and fills them", async () => {
    const vs = [
      vacancyAt([missing("ST1 5HR")]),
      vacancyAt([missing("ST1 5HR"), { postcode: "CB1 2AB", latitude: 52.2, longitude: 0.13 }]),
    ];
    const f = fakePostcodesIo({ "ST1 5HR": [53.02, -2.18] });
    const summary = await fillMissingCoordinates(vs, { fetch: f as unknown as typeof fetch });
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body))).toEqual({ postcodes: ["ST1 5HR"] });
    expect(summary).toEqual({ missing: 2, filled: 2, failedBatches: 0 });
    expect(vs[0]!.locations[0]).toMatchObject({ lat: 53.02, lon: -2.18 });
    expect(vs[1]!.locations[1]).toMatchObject({ lat: 52.2, lon: 0.13 }); // untouched
  });

  it("falls back to terminated postcodes, and leaves unknown ones null", async () => {
    const vs = [vacancyAt([missing("SR5 2TP")]), vacancyAt([missing("ZZ9 9ZZ")])];
    const f = fakePostcodesIo({}, { "SR5 2TP": [54.92, -1.42] });
    const summary = await fillMissingCoordinates(vs, { fetch: f as unknown as typeof fetch });
    expect(summary).toEqual({ missing: 2, filled: 1, failedBatches: 0 });
    expect(vs[0]!.locations[0]).toMatchObject({ lat: 54.92, lon: -1.42 });
    expect(vs[1]!.locations[0]).toMatchObject({ lat: null, lon: null });
  });

  it("batches at 100 postcodes per request and caps terminated lookups at 200", async () => {
    const vs = Array.from({ length: 250 }, (_, i) => vacancyAt([missing(`AB${i} 1CD`)]));
    const f = fakePostcodesIo({});
    await fillMissingCoordinates(vs, { fetch: f as unknown as typeof fetch });
    const posts = f.mock.calls.filter(([, init]) => init?.method === "POST").length;
    expect(posts).toBe(3);
    expect(f.mock.calls.length - posts).toBe(200);
  });

  it("survives failed lookups, leaving coordinates null", async () => {
    const vs = [vacancyAt([missing("ST1 5HR")])];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const summary = await fillMissingCoordinates(vs, { fetch: (async () => jsonResponse({}, 500)) as unknown as typeof fetch });
    expect(summary).toEqual({ missing: 1, filled: 0, failedBatches: 2 }); // bulk + terminated both failed
    expect(vs[0]!.locations[0]!.lat).toBeNull();
    warn.mockRestore();
  });

  it("makes no request when nothing is missing", async () => {
    const f = vi.fn();
    await fillMissingCoordinates([vacancyAt([{ postcode: "CB1 2AB", latitude: 52.2, longitude: 0.13 }])], { fetch: f as unknown as typeof fetch });
    expect(f).not.toHaveBeenCalled();
  });
});
