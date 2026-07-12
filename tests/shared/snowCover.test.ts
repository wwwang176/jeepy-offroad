import { describe, expect, it } from "vitest";
import {
  placeSnowMounds,
  snowDomeFalloff,
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
      expect(m.radius).toBeGreaterThan(2);
      expect(m.peakThickness).toBeGreaterThan(0.1);
      // Not on path centerline
      expect(Math.abs(m.x)).toBeGreaterThan(2);
    }
    // At least some mounds on the high (+x) side
    const highSide = mounds.filter((m) => m.x > 10);
    expect(highSide.length).toBeGreaterThan(0);
  });
});
