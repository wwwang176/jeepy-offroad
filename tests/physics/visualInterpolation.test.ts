import { describe, expect, it } from "vitest";
import {
  lerpRenderPose,
  lerpWheelVisuals,
  slerpQuat,
  type RenderPose,
} from "@/physics/vehicle/visualInterpolation";

function identityPose(y: number): RenderPose {
  return {
    position: { x: 0, y, z: 0 },
    yaw: 0,
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  };
}

describe("visualInterpolation", () => {
  it("lerps position and derives yaw from slerped quat", () => {
    const prev = identityPose(0);
    prev.position.z = 0;
    const curr = identityPose(10);
    curr.position.z = 10;
    // 90° yaw about Y
    const half = Math.sin(Math.PI / 4);
    curr.rotation = { x: 0, y: half, z: 0, w: half };
    curr.yaw = Math.PI / 2;

    const mid = lerpRenderPose(prev, curr, 0.5);
    expect(mid.position.y).toBeCloseTo(5, 5);
    expect(mid.position.z).toBeCloseTo(5, 5);
    expect(mid.yaw).toBeCloseTo(Math.PI / 4, 4);
  });

  it("alpha 0 returns prev, alpha 1 returns curr", () => {
    const prev = identityPose(1);
    const curr = identityPose(3);
    expect(lerpRenderPose(prev, curr, 0).position.y).toBeCloseTo(1, 6);
    expect(lerpRenderPose(prev, curr, 1).position.y).toBeCloseTo(3, 6);
  });

  it("slerp takes shortest arc when quats are opposite-hemisphere", () => {
    const a = { x: 0, y: 0, z: 0, w: 1 };
    const b = { x: 0, y: 0, z: 0, w: -1 }; // same orientation
    const m = slerpQuat(a, b, 0.5);
    // Should stay near identity, not spin the long way
    expect(Math.abs(m.w)).toBeGreaterThan(0.99);
  });

  it("lerps wheel suspension and spin", () => {
    const prev = [{ suspensionLength: 0.3, rotation: 0, steering: 0 }];
    const curr = [{ suspensionLength: 0.5, rotation: 2, steering: 0.2 }];
    const mid = lerpWheelVisuals(prev, curr, 0.5);
    expect(mid[0]!.suspensionLength).toBeCloseTo(0.4, 6);
    expect(mid[0]!.rotation).toBeCloseTo(1, 6);
    expect(mid[0]!.steering).toBeCloseTo(0.1, 6);
  });
});
