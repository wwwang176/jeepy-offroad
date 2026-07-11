import { describe, expect, it } from "vitest";
import { clamp, deltaAngle, wrapAngle, yawToDir } from "@/shared/math";

describe("math", () => {
  it("clamps values", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
  });

  it("yaw 0 faces +Z", () => {
    const d = yawToDir(0);
    expect(d.x).toBeCloseTo(0);
    expect(d.z).toBeCloseTo(1);
  });

  it("yaw PI/2 faces +X", () => {
    const d = yawToDir(Math.PI / 2);
    expect(d.x).toBeCloseTo(1);
    expect(d.z).toBeCloseTo(0);
  });

  it("wrapAngle maps to (-π, π]", () => {
    expect(wrapAngle(0)).toBeCloseTo(0);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(-Math.PI);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(-Math.PI);
  });

  it("deltaAngle takes shortest signed arc across ±π", () => {
    expect(deltaAngle(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(deltaAngle(Math.PI / 2, 0)).toBeCloseTo(-Math.PI / 2);
    // From almost +π to almost -π is a small positive step
    expect(deltaAngle(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 5);
    // Opposite direction
    expect(deltaAngle(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2, 5);
  });
});
