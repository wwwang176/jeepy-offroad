import { describe, expect, it } from "vitest";
import {
  assignPathHeights,
  fallbackPath,
  generatePathPolyline,
  pathLateralSpan,
  pathSinuosity,
} from "@/levelgen/path";
import { generateLevel } from "@/levelgen/generateLevel";
import { cliffsBiome } from "@/biome/profiles/cliffs";
import { VEHICLE_CAPABILITIES } from "@/shared/vehicleCapabilities";
import { PATH_SAFETY_FACTOR } from "@/levelgen/types";
import { yawToDir } from "@/shared/math";
import { mulberry32 } from "@/levelgen/rng";

describe("assignPathHeights", () => {
  it("keeps slopes within continuous-grade safety budget", () => {
    const flat = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 4 },
      { x: 0, y: 0, z: 8 },
      { x: 0, y: 50, z: 12 },
    ];
    const out = assignPathHeights(flat, VEHICLE_CAPABILITIES);
    const limit =
      Math.tan(VEHICLE_CAPABILITIES.maxSlopeRad) * PATH_SAFETY_FACTOR + 1e-6;
    for (let i = 1; i < out.length; i++) {
      const horiz =
        Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z) || 1e-6;
      const dh = Math.abs(out[i].y - out[i - 1].y);
      expect(dh / horiz).toBeLessThanOrEqual(limit);
    }
  });
});

describe("fallbackPath", () => {
  it("runs generally +X with a mild S-curve (never dead-straight Z=0 strip)", () => {
    const { startYaw, points } = fallbackPath(256, VEHICLE_CAPABILITIES);
    const d = yawToDir(startYaw);
    // Mostly eastbound
    expect(d.x).toBeGreaterThan(0.5);
    expect(points[points.length - 1].x).toBeGreaterThan(points[0].x);
    // Mild lateral meander so checkpoints are not colinear on Z=0
    expect(pathLateralSpan(points)).toBeGreaterThan(10);
  });
});

describe("generatePathPolyline meander", () => {
  it("produces winding paths with real lateral span", () => {
    let winding = 0;
    let wide = 0;
    for (const seed of [1, 7, 42, 99, 12345, 20260709]) {
      const rng = mulberry32(seed);
      const { points } = generatePathPolyline(rng, 256, VEHICLE_CAPABILITIES);
      const s = pathSinuosity(points);
      const lat = pathLateralSpan(points);
      if (s > 1.15) winding++;
      if (lat > 40) wide++;
      expect(s).toBeGreaterThan(1.08);
      expect(lat).toBeGreaterThan(20);
    }
    expect(winding).toBeGreaterThanOrEqual(4);
    expect(wide).toBeGreaterThanOrEqual(4);
  });
});

describe("generateLevel terrain-follow ribbon", () => {
  it("keeps meander checkpoints (not a straight fallback strip)", () => {
    let meanderOk = 0;
    for (const seed of [1, 42, 99, 7, 12345]) {
      const level = generateLevel({
        seed,
        biome: cliffsBiome,
        vehicle: VEHICLE_CAPABILITIES,
      });
      let minH = Infinity;
      let maxH = -Infinity;
      for (let i = 0; i < level.heightmap.length; i++) {
        const h = level.heightmap[i];
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
      }
      const hmRange = maxH - minH;
      expect(hmRange).toBeLessThan(110);
      expect(hmRange).toBeGreaterThan(8);

      // Checkpoints follow path — must have lateral spread (not all z≈0)
      const cpLat = pathLateralSpan(
        level.checkpoints.map((c) => c.position),
      );
      const pathLat = pathLateralSpan(level.pathPolyline);
      const sin = pathSinuosity(level.pathPolyline);
      // Full meander preserved even when grade repair marks usedFallback
      expect(sin).toBeGreaterThan(1.5);
      expect(pathLat).toBeGreaterThan(80);
      expect(cpLat).toBeGreaterThan(40);
      if (sin > 2 && pathLat > 100 && cpLat > 60) meanderOk++;
    }
    expect(meanderOk).toBeGreaterThanOrEqual(4);
  });
});
