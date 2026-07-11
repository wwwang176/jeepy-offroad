import { describe, expect, it } from "vitest";
import {
  bodyContactEmitRate,
  bodyImpactBurstCount,
  distPointSegmentXZ,
  dustEmitRate,
  exhaustEmitRate,
  landingBurstCount,
  lateralSpeedMps,
  longitudinalSpeedMps,
  parseHexRgb,
  splashEmitRate,
  bodyImmersionWeight,
  bodyWaterSprayEmitRate,
  immersionDepthM,
  pondWetness,
  pointInPolygonXZ,
  streamWetness,
  waterWetness,
  waterSplashColor,
} from "@/shared/offroadFxMath";

describe("longitudinal / lateral speed", () => {
  it("yaw 0: +Z is forward, +X is right", () => {
    expect(longitudinalSpeedMps(0, 5, 0)).toBeCloseTo(5, 5);
    expect(lateralSpeedMps(3, 0, 0)).toBeCloseTo(3, 5);
  });

  it("yaw +90°: +X is forward", () => {
    const yaw = Math.PI / 2;
    expect(longitudinalSpeedMps(4, 0, yaw)).toBeCloseTo(4, 5);
    expect(lateralSpeedMps(0, -3, yaw)).toBeCloseTo(3, 5);
  });
});

describe("dustEmitRate", () => {
  it("is zero when airborne", () => {
    expect(
      dustEmitRate({
        grounded: false,
        throttle: 1,
        brake: 0,
        speedMps: 10,
        lateralAbsMps: 5,
      }),
    ).toBe(0);
  });

  it("is low or zero when crawling slowly with no input", () => {
    const r = dustEmitRate({
      grounded: true,
      throttle: 0,
      brake: 0,
      speedMps: 0.2,
      lateralAbsMps: 0,
    });
    expect(r).toBeLessThan(0.5);
  });

  it("rises with throttle and speed", () => {
    const idle = dustEmitRate({
      grounded: true,
      throttle: 0,
      brake: 0,
      speedMps: 2,
      lateralAbsMps: 0,
    });
    const thr = dustEmitRate({
      grounded: true,
      throttle: 1,
      brake: 0,
      speedMps: 8,
      lateralAbsMps: 0,
    });
    expect(thr).toBeGreaterThan(idle);
    expect(thr).toBeGreaterThan(5);
  });

  it("boosts in low range", () => {
    const h = dustEmitRate({
      grounded: true,
      throttle: 1,
      brake: 0,
      speedMps: 5,
      lateralAbsMps: 0,
      rangeBoost: 1,
    });
    const l = dustEmitRate({
      grounded: true,
      throttle: 1,
      brake: 0,
      speedMps: 5,
      lateralAbsMps: 0,
      rangeBoost: 1.35,
    });
    expect(l).toBeGreaterThan(h);
  });

  it("adds side-slip contribution", () => {
    const base = dustEmitRate({
      grounded: true,
      throttle: 0,
      brake: 0,
      speedMps: 6,
      lateralAbsMps: 0,
    });
    const slip = dustEmitRate({
      grounded: true,
      throttle: 0,
      brake: 0,
      speedMps: 6,
      lateralAbsMps: 5,
    });
    expect(slip).toBeGreaterThan(base);
  });
});

describe("landingBurstCount", () => {
  it("only fires on air→ground with downward impact", () => {
    expect(landingBurstCount(false, true, -4)).toBeGreaterThan(0);
    expect(landingBurstCount(true, true, -4)).toBe(0);
    expect(landingBurstCount(false, false, -4)).toBe(0);
    expect(landingBurstCount(false, true, -0.5)).toBe(0);
  });

  it("scales with impact speed", () => {
    const soft = landingBurstCount(false, true, -1.5);
    const hard = landingBurstCount(false, true, -10);
    expect(hard).toBeGreaterThan(soft);
  });
});

describe("stream geometry", () => {
  it("distPointSegmentXZ hits midpoint of segment", () => {
    expect(distPointSegmentXZ(0, 1, -2, 0, 2, 0)).toBeCloseTo(1, 5);
    expect(distPointSegmentXZ(5, 0, 0, 0, 2, 0)).toBeCloseTo(3, 5);
  });

  it("streamWetness is 1 inside width and fades outside", () => {
    const streams = [
      {
        polyline: [
          { x: 0, z: -10 },
          { x: 0, z: 10 },
        ],
        width: 4,
      },
    ];
    expect(streamWetness(0, 0, streams)).toBe(1);
    expect(streamWetness(1.5, 0, streams)).toBe(1);
    expect(streamWetness(2.3, 0, streams)).toBeGreaterThan(0);
    expect(streamWetness(2.3, 0, streams)).toBeLessThan(1);
    expect(streamWetness(10, 0, streams)).toBe(0);
  });

  it("pondWetness uses polygon and surfaceY", () => {
    const ponds = [
      {
        center: { x: 0, z: 0 },
        radius: 5,
        surfaceY: 10,
        polygon: [
          { x: -3, z: -3 },
          { x: 3, z: -3 },
          { x: 3, z: 3 },
          { x: -3, z: 3 },
        ],
      },
    ];
    expect(pointInPolygonXZ(0, 0, ponds[0].polygon)).toBe(true);
    expect(pondWetness(0, 0, ponds, 9.5)).toBe(1);
    expect(pondWetness(0, 0, ponds, 11)).toBe(0); // above surface
    expect(pondWetness(20, 0, ponds, 9)).toBe(0);
  });

  it("waterWetness prefers max of streams and ponds", () => {
    const streams = [
      {
        polyline: [
          { x: 0, z: -5 },
          { x: 0, z: 5 },
        ],
        width: 2,
      },
    ];
    const ponds = [
      {
        center: { x: 10, z: 0 },
        radius: 4,
        surfaceY: 5,
        polygon: [
          { x: 8, z: -2 },
          { x: 12, z: -2 },
          { x: 12, z: 2 },
          { x: 8, z: 2 },
        ],
      },
    ];
    expect(waterWetness(0, 0, streams, ponds)).toBe(1);
    expect(waterWetness(10, 0, streams, ponds, 4.8)).toBe(1);
    expect(waterWetness(50, 50, streams, ponds)).toBe(0);
  });

  it("immersionDepthM is zero above surface", () => {
    expect(immersionDepthM(10, 10.5)).toBe(0);
    expect(immersionDepthM(10, 9.5, 0.02)).toBeCloseTo(0.48, 5);
  });

  it("bodyImmersionWeight boosts low-side samples when rolled", () => {
    const base = {
      wetnessXZ: 1,
      depthM: 0.2,
      localZ: 0,
      pitchLean: 0,
    };
    // Right lower: chassisRight.y < 0 → right localX > 0 gets higher weight
    const rightLow = bodyImmersionWeight({
      ...base,
      localX: 0.8,
      rollLean: -0.35,
    });
    const leftHigh = bodyImmersionWeight({
      ...base,
      localX: -0.8,
      rollLean: -0.35,
    });
    expect(rightLow).toBeGreaterThan(leftHigh);
    expect(bodyImmersionWeight({ ...base, localX: 0, rollLean: 0, depthM: 0 })).toBe(
      0,
    );
  });

  it("bodyWaterSprayEmitRate is off when nearly stationary", () => {
    expect(
      bodyWaterSprayEmitRate({
        meanDepthM: 0.3,
        meanWetness: 1,
        speedMps: 0.1,
        wetSampleCount: 5,
        totalWeight: 3,
      }),
    ).toBe(0);
    expect(
      bodyWaterSprayEmitRate({
        meanDepthM: 0.3,
        meanWetness: 1,
        speedMps: 0.4,
        wetSampleCount: 5,
        totalWeight: 3,
      }),
    ).toBe(0);
  });

  it("bodyWaterSprayEmitRate scales with depth and speed when moving", () => {
    expect(
      bodyWaterSprayEmitRate({
        meanDepthM: 0,
        meanWetness: 1,
        speedMps: 5,
        wetSampleCount: 3,
        totalWeight: 2,
      }),
    ).toBe(0);
    const creep = bodyWaterSprayEmitRate({
      meanDepthM: 0.12,
      meanWetness: 1,
      speedMps: 1.0,
      wetSampleCount: 3,
      totalWeight: 1.5,
    });
    const deepMove = bodyWaterSprayEmitRate({
      meanDepthM: 0.35,
      meanWetness: 1,
      speedMps: 8,
      wetSampleCount: 6,
      totalWeight: 4,
    });
    expect(creep).toBeGreaterThan(0);
    expect(deepMove).toBeGreaterThan(creep);
  });
});

describe("splashEmitRate", () => {
  it("requires ground + wetness", () => {
    expect(
      splashEmitRate({
        grounded: false,
        wetness: 1,
        speedMps: 5,
        throttle: 1,
      }),
    ).toBe(0);
    expect(
      splashEmitRate({
        grounded: true,
        wetness: 0,
        speedMps: 5,
        throttle: 1,
      }),
    ).toBe(0);
    expect(
      splashEmitRate({
        grounded: true,
        wetness: 1,
        speedMps: 5,
        throttle: 0.5,
      }),
    ).toBeGreaterThan(1);
  });
});

describe("colors", () => {
  it("parses hex", () => {
    expect(parseHexRgb("#ff0000")).toEqual({ r: 1, g: 0, b: 0 });
    expect(parseHexRgb("#0f0")).toEqual({ r: 0, g: 1, b: 0 });
  });

  it("waterSplashColor brightens foam", () => {
    const w = waterSplashColor("#204060");
    const base = parseHexRgb("#204060");
    expect(w.r).toBeGreaterThan(base.r);
    expect(w.b).toBeGreaterThan(base.b * 0.5);
  });
});

describe("exhaustEmitRate", () => {
  it("is zero without throttle", () => {
    expect(exhaustEmitRate({ throttle: 0, speedMps: 10 })).toBe(0);
    expect(exhaustEmitRate({ throttle: 0.05, speedMps: 0 })).toBe(0);
  });

  it("rises with throttle", () => {
    expect(
      exhaustEmitRate({ throttle: 1, speedMps: 5 }),
    ).toBeGreaterThan(exhaustEmitRate({ throttle: 0.2, speedMps: 5 }));
  });
});

describe("bodyContactEmitRate", () => {
  it("is zero with no contacts", () => {
    expect(
      bodyContactEmitRate({ contactCount: 0, speedMps: 10, vy: -5 }),
    ).toBe(0);
  });

  it("scales with scrape speed and contact count", () => {
    const slow = bodyContactEmitRate({
      contactCount: 1,
      speedMps: 1,
      vy: 0,
    });
    const fast = bodyContactEmitRate({
      contactCount: 1,
      speedMps: 4,
      vy: 0,
    });
    const many = bodyContactEmitRate({
      contactCount: 3,
      speedMps: 4,
      vy: 0,
    });
    expect(fast).toBeGreaterThan(slow);
    expect(many).toBeGreaterThan(fast);
  });
});

describe("bodyImpactBurstCount", () => {
  it("only fires on first contact transition", () => {
    expect(bodyImpactBurstCount(0, 3, -4)).toBeGreaterThan(0);
    expect(bodyImpactBurstCount(2, 3, -4)).toBe(0);
    expect(bodyImpactBurstCount(0, 0, -4)).toBe(0);
  });
});
