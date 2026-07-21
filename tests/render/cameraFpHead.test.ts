import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CameraRig } from "@/render/CameraRig";

/** Tests own the camera instance; CameraRig keeps it private. */
function makeRig(): { rig: CameraRig; camera: THREE.PerspectiveCamera } {
  const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 1000);
  return { rig: new CameraRig(camera), camera };
}

function poseAt(
  y: number,
  yaw = 0,
  z = 0,
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
    position: { x: 0, y, z },
    yaw,
    rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
  };
}

describe("CameraRig first-person head accel inertia (B)", () => {
  it("snaps eye to hard-mount on first FP update", () => {
    const { rig, camera } = makeRig();
    rig.setMode("first");
    const pose = poseAt(2);
    rig.update(1 / 60, pose, { snap: true, linvel: { x: 0, y: 0, z: 0 } });
    // eyeLocal y=1.15 → world y ≈ 3.15
    expect(rig.getFpEyeWorld().y).toBeCloseTo(2 + 1.15, 4);
    expect(camera.position.y).toBeCloseTo(2 + 1.15, 4);
    expect(rig.getHeadOffsetLocal().z).toBeCloseTo(0, 5);
  });

  it("shifts aft under forward acceleration then returns at constant speed", () => {
    const { rig } = makeRig();
    rig.setMode("first");
    rig.update(0, poseAt(1), {
      snap: true,
      linvel: { x: 0, y: 0, z: 0 },
    });

    // Sustained forward accel (world +Z) above deadzone after LPF
    for (let i = 1; i <= 24; i++) {
      rig.update(1 / 60, poseAt(1), {
        linvel: { x: 0, y: 0, z: i * 1.0 },
      });
    }
    expect(rig.getHeadOffsetLocal().z).toBeLessThan(-0.01);

    // Constant velocity: accel → 0, head returns toward seat
    for (let i = 0; i < 90; i++) {
      rig.update(1 / 60, poseAt(1, 0, i * 0.2), {
        linvel: { x: 0, y: 0, z: 24 },
      });
    }
    expect(Math.abs(rig.getHeadOffsetLocal().z)).toBeLessThan(0.008);
    expect(Math.abs(rig.getHeadOffsetLocal().x)).toBeLessThan(0.008);
  });

  it("does not stay aft under pure constant velocity from seed", () => {
    const { rig } = makeRig();
    rig.setMode("first");
    // Seed already at cruise speed — first frames must not invent lag
    rig.update(0, poseAt(1), {
      snap: true,
      linvel: { x: 0, y: 0, z: 15 },
    });
    for (let i = 0; i < 30; i++) {
      rig.update(1 / 60, poseAt(1, 0, i), {
        linvel: { x: 0, y: 0, z: 15 },
      });
    }
    expect(Math.abs(rig.getHeadOffsetLocal().z)).toBeLessThan(0.005);
  });

  it("rejects high-frequency low-amplitude velocity noise (stuck jitter)", () => {
    const { rig } = makeRig();
    rig.setMode("first");
    rig.update(0, poseAt(1), {
      snap: true,
      linvel: { x: 0, y: 0, z: 0 },
    });
    // Contact chatter ~±0.15 m/s — should stay under accel deadzone after LPF
    for (let i = 0; i < 120; i++) {
      const n = i % 2 === 0 ? 0.15 : -0.15;
      rig.update(1 / 60, poseAt(1), {
        linvel: { x: n * 0.4, y: n * 0.5, z: n },
      });
    }
    const o = rig.getHeadOffsetLocal();
    expect(Math.abs(o.x)).toBeLessThan(0.012);
    expect(Math.abs(o.y)).toBeLessThan(0.012);
    expect(Math.abs(o.z)).toBeLessThan(0.012);
  });

  it("hard-mounts eye to chassis when head offset is zero", () => {
    const { rig } = makeRig();
    rig.setMode("first");
    rig.update(0, poseAt(1), { snap: true, linvel: { x: 0, y: 0, z: 0 } });
    // Pose step with zero accel (linvel stays 0) → eye follows chassis 1:1
    rig.update(1 / 60, poseAt(2), { linvel: { x: 0, y: 0, z: 0 } });
    expect(rig.getFpEyeWorld().y).toBeCloseTo(2 + 1.15, 4);
    expect(rig.getHeadOffsetLocal().y).toBeCloseTo(0, 4);
  });

  it("third-person path ignores head inertia state", () => {
    const { rig, camera } = makeRig();
    rig.setMode("third");
    rig.update(0, poseAt(1), { snap: true });
    const y0 = camera.position.y;
    rig.update(1 / 60, poseAt(2), { speedMps: 0 });
    expect(camera.position.y).not.toBe(y0);
    expect(rig.mode).toBe("third");
  });
});

describe("CameraRig first-person impact shake (C)", () => {
  it("does not fire impact on snap seed even with contacts + vy", () => {
    const { rig } = makeRig();
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
    const { rig, camera } = makeRig();
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
    // Impact local -Y lowers cam below head-inertia eye (chassis identity).
    expect(camera.position.y).toBeLessThan(rig.getFpEyeWorld().y);
  });

  it("decays impact residual over time", () => {
    const { rig } = makeRig();
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
    const { rig } = makeRig();
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
    const { rig } = makeRig();
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
