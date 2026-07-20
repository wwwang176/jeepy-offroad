import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CameraRig } from "@/render/CameraRig";

function makeRig(): CameraRig {
  const cam = new THREE.PerspectiveCamera(72, 1, 0.1, 1000);
  return new CameraRig(cam);
}

function poseAt(
  y: number,
  yaw = 0,
): {
  position: { x: number; y: number; z: number };
  yaw: number;
  rotation: { x: number; y: number; z: number; w: number };
} {
  const q = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    yaw,
  );
  return {
    position: { x: 0, y, z: 0 },
    yaw,
    rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
  };
}

describe("CameraRig first-person head soft-follow (B)", () => {
  it("snaps eye to hard-mount on first FP update", () => {
    const rig = makeRig();
    rig.setMode("first");
    const pose = poseAt(2);
    rig.update(1 / 60, pose, { snap: true });
    // eyeLocal y=1.15 → world y ≈ 3.15
    expect(rig.getFpEyeWorld().y).toBeCloseTo(2 + 1.15, 4);
    expect(rig.camera.position.y).toBeCloseTo(2 + 1.15, 4);
  });

  it("lags behind a sudden chassis lift then catches up", () => {
    const rig = makeRig();
    rig.setMode("first");
    rig.update(0, poseAt(1), { snap: true });
    const y0 = rig.getFpEyeWorld().y;

    // Step chassis up 0.5 m in one frame
    rig.update(1 / 60, poseAt(1.5), {});
    const y1 = rig.getFpEyeWorld().y;
    const hardTarget = 1.5 + 1.15;
    // Soft-follow: between previous and hard target
    expect(y1).toBeGreaterThan(y0);
    expect(y1).toBeLessThan(hardTarget - 0.01);

    for (let i = 0; i < 90; i++) {
      rig.update(1 / 60, poseAt(1.5), {});
    }
    expect(rig.getFpEyeWorld().y).toBeCloseTo(hardTarget, 2);
  });

  it("clamps soft-follow lag under HEAD_MAX_DOWN (~0.08 m)", () => {
    const rig = makeRig();
    rig.setMode("first");
    rig.update(0, poseAt(1), { snap: true });
    // Huge single-frame jump upward — lag cannot exceed local max down of head
    // relative to new desired (eye lags below target).
    rig.update(1 / 60, poseAt(3), {});
    const lag = 3 + 1.15 - rig.getFpEyeWorld().y;
    expect(lag).toBeGreaterThan(0);
    expect(lag).toBeLessThanOrEqual(0.08 + 1e-6);
  });

  it("third-person path ignores head soft-follow state", () => {
    const rig = makeRig();
    rig.setMode("third");
    rig.update(0, poseAt(1), { snap: true });
    const y0 = rig.camera.position.y;
    rig.update(1 / 60, poseAt(2), { speedMps: 0 });
    // TP eases Y but does not use FP eye helpers — still moves
    expect(rig.camera.position.y).not.toBe(y0);
    // FP eye world was never required; mode stays third
    expect(rig.mode).toBe("third");
  });
});

describe("CameraRig first-person impact shake (C)", () => {
  it("does not fire impact on snap seed even with contacts + vy", () => {
    const rig = makeRig();
    rig.setMode("first");
    rig.update(0, poseAt(1), {
      snap: true,
      linvel: { x: 0, y: -5, z: 0 },
      wheelContacts: [true, true, true, true],
      bodyContactCount: 2,
    });
    expect(rig.getImpactPitch()).toBe(0);
  });

  it("kicks pitch on wheel air→ground with downward vy", () => {
    const rig = makeRig();
    rig.setMode("first");
    // Seed grounded=false history
    rig.update(0, poseAt(2), {
      snap: true,
      linvel: { x: 0, y: 0, z: 0 },
      wheelContacts: [false, false, false, false],
      bodyContactCount: 0,
    });
    // Land hard
    rig.update(1 / 60, poseAt(1), {
      linvel: { x: 0, y: -6, z: 0 },
      wheelContacts: [true, true, true, true],
      bodyContactCount: 0,
    });
    expect(rig.getImpactPitch()).toBeLessThan(-0.005);
    // Impact local -Y lowers cam below soft-follow eye (chassis identity).
    expect(rig.camera.position.y).toBeLessThan(rig.getFpEyeWorld().y);
  });

  it("decays impact residual over time", () => {
    const rig = makeRig();
    rig.setMode("first");
    rig.update(0, poseAt(2), {
      snap: true,
      wheelContacts: [false, false, false, false],
      bodyContactCount: 0,
    });
    rig.update(1 / 60, poseAt(1), {
      linvel: { x: 0, y: -6, z: 0 },
      wheelContacts: [true, true, true, true],
      bodyContactCount: 0,
    });
    const pitch0 = rig.getImpactPitch();
    expect(pitch0).toBeLessThan(0);
    for (let i = 0; i < 60; i++) {
      rig.update(1 / 60, poseAt(1), {
        linvel: { x: 0, y: 0, z: 0 },
        wheelContacts: [true, true, true, true],
        bodyContactCount: 0,
      });
    }
    expect(Math.abs(rig.getImpactPitch())).toBeLessThan(
      Math.abs(pitch0) * 0.05,
    );
  });

  it("fires body slam when contacts go 0→N", () => {
    const rig = makeRig();
    rig.setMode("first");
    rig.update(0, poseAt(1.5), {
      snap: true,
      wheelContacts: [true, true, true, true],
      bodyContactCount: 0,
    });
    rig.update(1 / 60, poseAt(1), {
      linvel: { x: 0, y: -5, z: 0 },
      wheelContacts: [true, true, true, true],
      bodyContactCount: 3,
    });
    expect(rig.getImpactPitch()).toBeLessThan(-0.005);
  });

  it("does not re-fire while body stays in continuous contact", () => {
    const rig = makeRig();
    rig.setMode("first");
    rig.update(0, poseAt(1.5), {
      snap: true,
      bodyContactCount: 0,
      wheelContacts: [false, false, false, false],
    });
    rig.update(1 / 60, poseAt(1), {
      linvel: { x: 0, y: -5, z: 0 },
      bodyContactCount: 2,
      wheelContacts: [true, true, true, true],
    });
    const afterFirst = rig.getImpactPitch();
    // Hold contacts + zero vy — no new landing edge, decay only
    rig.update(1 / 60, poseAt(1), {
      linvel: { x: 0, y: 0, z: 0 },
      bodyContactCount: 2,
      wheelContacts: [true, true, true, true],
    });
    expect(Math.abs(rig.getImpactPitch())).toBeLessThanOrEqual(
      Math.abs(afterFirst) + 1e-9,
    );
  });
});
