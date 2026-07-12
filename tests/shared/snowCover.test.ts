import { describe, expect, it } from "vitest";
import {
  placeSnowMounds,
  snowCoverageAt,
  snowDomeFalloff,
  snowDustColor,
  type SnowCoverConfig,
} from "@/shared/snowCover";
import { buildSnowMoundGeometry } from "@/render/SnowCoverMesh";
import { sampleBilinear } from "@/levelgen/heightmap";
import { gridToWorld } from "@/shared/coords";
import { mulberry32 } from "@/levelgen/rng";

const cfg: SnowCoverConfig = {
  color: "#f2f7fc",
  peakThicknessM: 0.85,
  patchThicknessM: 0.38,
  thickRadiusMinM: 8,
  thickRadiusMaxM: 14,
  patchRadiusMinM: 3,
  patchRadiusMaxM: 7,
  thickCount: 20,
  patchCount: 25,
  thickLineT: 0.45,
  patchMinT: 0.2,
  clearPath: true,
};

describe("snowCoverageAt / snowDustColor", () => {
  it("is high at mound center and low outside", () => {
    const mounds = [
      { x: 0, z: 0, radius: 8, peakThickness: 0.8, phase: 0 },
    ];
    expect(snowCoverageAt(0, 0, mounds)).toBeGreaterThan(0.9);
    expect(snowCoverageAt(20, 0, mounds)).toBe(0);
  });

  it("snow dust is bright near-white", () => {
    const c = snowDustColor("#fbfcfe");
    expect(c.r).toBeGreaterThan(0.9);
    expect(c.g).toBeGreaterThan(0.9);
    expect(c.b).toBeGreaterThan(0.9);
  });
});

describe("snowDomeFalloff", () => {
  it("is 1 at center and 0 at rim (rounded mound)", () => {
    expect(snowDomeFalloff(0)).toBeCloseTo(1, 5);
    expect(snowDomeFalloff(1)).toBeCloseTo(0, 5);
    // Mid radius still has body — soft curve, not a hard cylinder
    expect(snowDomeFalloff(0.5)).toBeGreaterThan(0.3);
    expect(snowDomeFalloff(0.5)).toBeLessThan(0.8);
    // Monotone decreasing on [0,1]
    expect(snowDomeFalloff(0.25)).toBeGreaterThan(snowDomeFalloff(0.5));
    expect(snowDomeFalloff(0.5)).toBeGreaterThan(snowDomeFalloff(0.75));
  });
});

describe("buildSnowMoundGeometry", () => {
  it("has vertex normals pointing mostly skyward (+Y)", () => {
    const geo = buildSnowMoundGeometry(
      { x: 0, z: 0, radius: 6, peakThickness: 0.8, phase: 0 },
      () => 10,
    );
    const nAttr = geo.getAttribute("normal");
    expect(nAttr).toBeTruthy();
    let sumY = 0;
    for (let i = 0; i < nAttr!.count; i++) {
      sumY += nAttr!.getY(i);
    }
    const meanY = sumY / nAttr!.count;
    // Wrong winding yields meanY ≈ −1; correct ≈ +1
    expect(meanY).toBeGreaterThan(0.5);
    geo.dispose();
  });
});

describe("placeSnowMounds", () => {
  it("places mounds on a ramped heightmap, prefers high for thick", () => {
    const resolution = 65;
    const worldSize = 128;
    const heightmap = new Float32Array(resolution * resolution);
    for (let row = 0; row < resolution; row++) {
      for (let col = 0; col < resolution; col++) {
        const { x } = gridToWorld(col, row, worldSize, resolution);
        heightmap[row * resolution + col] = 10 + (x + 64) * 0.4;
      }
    }
    const pathPolyline = Array.from({ length: 30 }, (_, i) => ({
      x: 0,
      z: -50 + i * 3.5,
    }));
    const sampleY = (x: number, z: number) =>
      sampleBilinear(heightmap, resolution, worldSize, x, z);
    const mounds = placeSnowMounds({
      heightmap,
      resolution,
      worldSize,
      pathPolyline,
      pathHalfWidth: 4,
      cfg,
      rng: mulberry32(42),
      sampleY,
    });

    expect(mounds.length).toBeGreaterThan(5);
    for (const m of mounds) {
      expect(m.radius).toBeGreaterThan(1);
      expect(m.peakThickness).toBeGreaterThan(0.05);
    }
    // Most centers off the path ribbon (x≈0); allow rare road snow
    const offPath = mounds.filter((m) => Math.abs(m.x) > 4);
    expect(offPath.length).toBeGreaterThan(mounds.length * 0.6);
    // At least some mounds on the high (+x) side
    const highSide = mounds.filter((m) => m.x > 10);
    expect(highSide.length).toBeGreaterThan(0);
  });

  it("can place occasional mounds on the path when chance is high", () => {
    const resolution = 33;
    const worldSize = 64;
    const heightmap = new Float32Array(resolution * resolution).fill(20);
    const pathPolyline = Array.from({ length: 20 }, (_, i) => ({
      x: 0,
      z: -25 + i * 2.5,
    }));
    const sampleY = () => 20;
    // Force many attempts on a flat map; high pathSnowChance → some on ribbon
    const mounds = placeSnowMounds({
      heightmap,
      resolution,
      worldSize,
      pathPolyline,
      pathHalfWidth: 6,
      cfg: {
        ...cfg,
        thickCount: 40,
        patchCount: 40,
        thickLineT: 0,
        patchMinT: 0,
        pathSnowChance: 1,
        clearPath: true,
      },
      rng: mulberry32(7),
      sampleY,
    });
    expect(mounds.length).toBeGreaterThan(0);
    // With chance=1, on-path candidates are not rejected for path reason
    const nearPath = mounds.filter((m) => Math.abs(m.x) < 5);
    expect(nearPath.length).toBeGreaterThan(0);
  });
});
