import { describe, expect, it } from "vitest";
import {
  buildSnowCoverMask,
  snowCoverAmount,
  type SnowCoverConfig,
} from "@/shared/snowCover";
import { gridToWorld } from "@/shared/coords";

const cfg: SnowCoverConfig = {
  color: "#f2f7fc",
  liftM: 0.16,
  thickLineT: 0.48,
  patchMinT: 0.22,
  patchNoiseThreshold: 0.52,
  clearPath: true,
};

describe("snowCoverAmount", () => {
  it("is solid on high ground", () => {
    expect(snowCoverAmount(0, 0, 0.9, cfg)).toBeGreaterThanOrEqual(0.5);
  });

  it("is not solid on very low ground without noise luck", () => {
    // Low t: only rare patches; sample enough XZ
    let any = false;
    for (let i = 0; i < 40; i++) {
      if (snowCoverAmount(i * 3.1, i * 2.7, 0.05, cfg) >= 0.5) any = true;
    }
    // Most low samples should be bare rock; allow zero or few
    expect(any).toBe(false);
  });
});

describe("buildSnowCoverMask", () => {
  it("marks high cells and clears the path ribbon", () => {
    const resolution = 33;
    const worldSize = 64;
    const heightmap = new Float32Array(resolution * resolution);
    // Ramp high on +x
    for (let row = 0; row < resolution; row++) {
      for (let col = 0; col < resolution; col++) {
        const { x } = gridToWorld(col, row, worldSize, resolution);
        heightmap[row * resolution + col] = 10 + (x + 32) * 0.5;
      }
    }
    // Path along z at x=0
    const pathPolyline = Array.from({ length: 20 }, (_, i) => ({
      x: 0,
      z: -30 + i * 3,
    }));
    const mask = buildSnowCoverMask({
      heightmap,
      resolution,
      worldSize,
      pathPolyline,
      pathHalfWidth: 4,
      cfg,
      gridToWorld,
    });

    let snow = 0;
    let pathSnow = 0;
    let highSnow = 0;
    for (let row = 0; row < resolution; row++) {
      for (let col = 0; col < resolution; col++) {
        const i = row * resolution + col;
        const { x } = gridToWorld(col, row, worldSize, resolution);
        if (mask[i]) {
          snow++;
          if (Math.abs(x) < 2) pathSnow++;
          if (x > 20) highSnow++;
        }
      }
    }
    expect(snow).toBeGreaterThan(20);
    // Path should be mostly clear
    expect(pathSnow).toBeLessThan(snow * 0.15);
    // High side should have snow
    expect(highSnow).toBeGreaterThan(5);
  });
});
