import { describe, expect, it } from "vitest";
import { clamp, yawToDir } from "@/shared/math";

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
});
