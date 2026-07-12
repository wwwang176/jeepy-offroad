import { describe, expect, it } from "vitest";
import { parseHexRgb } from "@/shared/offroadFxMath";
import {
  buildTerrainColorContext,
  dustColorFromTerrainAlbedo,
  pathProximity,
  terrainAlbedoAt,
} from "@/shared/terrainColor";

const cliffsPalette = {
  high: "#8a8680",
  mid: "#a89880",
  low: "#5c5348",
  path: "#b8a990",
};

describe("pathProximity", () => {
  // Matches TerrainMesh: distance to polyline *vertices* (not segment midpoints).
  it("is 1 on a path vertex and 0 far away", () => {
    const path = [
      { x: 0, z: 0 },
      { x: 0, z: 10 },
    ];
    expect(pathProximity(0, 0, path, 4)).toBeCloseTo(1, 5);
    expect(pathProximity(10, 5, path, 4)).toBe(0);
    expect(pathProximity(2, 0, path, 4)).toBeCloseTo(0.5, 5);
  });
});

describe("terrainAlbedoAt", () => {
  const hm = new Float32Array([0, 0, 0, 10, 10, 10, 20, 20, 20]);
  // Dense-enough samples so (0,0) hits a vertex within path half-width
  const pathPolyline = Array.from({ length: 21 }, (_, i) => ({
    x: 0,
    z: -50 + i * 5,
  }));
  const ctx = buildTerrainColorContext({
    groundPalette: cliffsPalette,
    heightmap: hm,
    pathPolyline,
    pathWidth: 4,
  });

  it("uses low palette at low elevations", () => {
    const low = parseHexRgb(cliffsPalette.low);
    const c = terrainAlbedoAt(20, 20, ctx.minH, ctx);
    expect(c.r).toBeCloseTo(low.r, 2);
    expect(c.g).toBeCloseTo(low.g, 2);
    expect(c.b).toBeCloseTo(low.b, 2);
  });

  it("uses high palette at high elevations", () => {
    const high = parseHexRgb(cliffsPalette.high);
    const c = terrainAlbedoAt(20, 20, ctx.maxH, ctx);
    expect(c.r).toBeCloseTo(high.r, 2);
    expect(c.g).toBeCloseTo(high.g, 2);
    expect(c.b).toBeCloseTo(high.b, 2);
  });

  it("blends toward path color on the ribbon", () => {
    const midH = (ctx.minH + ctx.maxH) * 0.5;
    const off = terrainAlbedoAt(30, 0, midH, ctx);
    const on = terrainAlbedoAt(0, 0, midH, ctx);
    const path = parseHexRgb(cliffsPalette.path);
    // On-path should be closer to path color than off-path
    const dist = (a: { r: number; g: number; b: number }, b: typeof path) =>
      Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
    expect(dist(on, path)).toBeLessThan(dist(off, path));
  });
});

describe("dustColorFromTerrainAlbedo", () => {
  it("is darker than raw albedo (deeper dust read)", () => {
    const albedo = parseHexRgb("#a89880");
    const dust = dustColorFromTerrainAlbedo(albedo);
    expect(dust.r).toBeLessThan(albedo.r * 0.7);
    expect(dust.g).toBeLessThan(albedo.g * 0.7);
    expect(dust.b).toBeLessThan(albedo.b * 0.7);
  });

  it("stays in the same hue family as cliffs mid", () => {
    const albedo = parseHexRgb(cliffsPalette.mid);
    const dust = dustColorFromTerrainAlbedo(albedo);
    // Warm dirt: r >= g >= b-ish
    expect(dust.r).toBeGreaterThanOrEqual(dust.b);
    expect(dust.g).toBeGreaterThan(dust.b * 0.9);
  });
});
