import { describe, expect, it } from "vitest";
import { applyMacroRelief, macroHeightAt } from "@/levelgen/macroRelief";
import { gridToWorld, idx } from "@/shared/coords";

describe("macroRelief", () => {
  const start = { x: -100, z: 0 };
  const end = { x: 100, z: 0 };
  const dropM = 32;

  it("is high at start and low at finish by ~dropM", () => {
    const hs = macroHeightAt(start.x, start.z, start, end, dropM);
    const he = macroHeightAt(end.x, end.z, start, end, dropM);
    expect(hs).toBeCloseTo(dropM / 2, 5);
    expect(he).toBeCloseTo(-dropM / 2, 5);
    expect(hs - he).toBeCloseTo(dropM, 5);
  });

  it("is zero at chord midpoint", () => {
    expect(macroHeightAt(0, 0, start, end, dropM)).toBeCloseTo(0, 5);
  });

  it("returns 0 for non-positive drop", () => {
    expect(macroHeightAt(0, 0, start, end, 0)).toBe(0);
    expect(macroHeightAt(0, 0, start, end, -5)).toBe(0);
  });

  it("applyMacroRelief mutates heightmap with start>finish polarity", () => {
    const resolution = 17;
    const mapSize = 64;
    const hm = new Float32Array(resolution * resolution);
    // flat 10
    hm.fill(10);
    applyMacroRelief(
      hm,
      resolution,
      mapSize,
      { x: -30, z: 0 },
      { x: 30, z: 0 },
      { startToFinishDropM: 20 },
    );
    // Sample cells nearest start/finish
    let startY = -Infinity;
    let finishY = Infinity;
    for (let r = 0; r < resolution; r++) {
      for (let c = 0; c < resolution; c++) {
        const { x } = gridToWorld(c, r, mapSize, resolution);
        const y = hm[idx(resolution, c, r)]!;
        expect(Number.isFinite(y)).toBe(true);
        if (x < -20) startY = Math.max(startY, y);
        if (x > 20) finishY = Math.min(finishY, y);
      }
    }
    expect(startY - finishY).toBeGreaterThan(15);
  });
});
