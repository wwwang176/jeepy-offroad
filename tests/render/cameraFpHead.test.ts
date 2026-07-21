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

describe("CameraRig first-person head oscillator (B)", () => {
  it("snaps eye to hard-mount on first FP update", () => {
    const { rig, camera } = makeRig();
    rig.setMode("first");
    const pose = poseAt(2);
    rig.update(1 / 60, pose, { snap: true, linvel: { x: 0, y: 0, z: 0 } });
    expect(rig.getFpEyeWorld().y).toBeCloseTo(2 + 1.15, 4);
    expect(camera.position.y).toBeCloseTo(2 + 1.15, 4);
    expect(rig.getHeadOffsetLocal().z).toBeCloseTo(0, 5);
  });

  it("leans aft under forward accel then returns at constant speed", () => {
    const { rig } = makeRig();
    rig.setMode("first");
    rig.update(0, poseAt(1), {
      snap: true,
      linvel: { x: 0, y: 0, z: 0 },
    });

    // Ramp speed (sustained +a along +Z)
    for (let i = 1; i <= 30; i++) {
      rig.update(1 / 60, poseAt(1), {
        linvel: { x: 0, y: 0, z: i * 0.8 },
      });
    }
    expect(rig.getHeadOffsetLocal().z).toBeLessThan(-0.008);

    // Cruise: a→0 → return toward seat origin
    for (let i = 0; i < 120; i++) {
      rig.update(1 / 60, poseAt(1, 0, i * 0.3), {
        linvel: { x: 0, y: 0, z: 24 },
      });
    }
    expect(Math.abs(rig.getHeadOffsetLocal().z)).toBeLessThan(0.01);
    expect(Math.abs(rig.getHeadOffsetLocal().x)).toBeLessThan(0.01);
  });

  it("holds aft lean while acceleration is sustained (0→10→20→…)", () => {
    const { rig } = makeRig();
    rig.setMode("first");
    rig.update(0, poseAt(1), {
      snap: true,
      linvel: { x: 0, y: 0, z: 0 },
    });
    // Continuous ramp for a long window — must NOT settle back to 0
    for (let i = 1; i <= 90; i++) {
      rig.update(1 / 60, poseAt(1), {
        linvel: { x: 0, y: 0, z: i * 0.5 },
      });
    }
    expect(rig.getHeadOffsetLocal().z).toBeLessThan(-0.008);
  });

  it("does not invent lean under pure constant velocity from seed", () => {
    const { rig } = makeRig();
    rig.setMode("first");
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

  it("may overshoot origin when returning from aft lean (underdamped)", () => {
    const { rig } = makeRig();
    rig.setMode("first");
    rig.update(0, poseAt(1), {
      snap: true,
      linvel: { x: 0, y: 0, z: 0 },
    });
    for (let i = 1; i <= 40; i++) {
      rig.update(1 / 60, poseAt(1), {
        linvel: { x: 0, y: 0, z: i * 0.7 },
      });
    }
    expect(rig.getHeadOffsetLocal().z).toBeLessThan(-0.005);

    let sawForward = false;
    for (let i = 0; i < 90; i++) {
      rig.update(1 / 60, poseAt(1), {
        linvel: { x: 0, y: 0, z: 28 },
      });
      if (rig.getHeadOffsetLocal().z > 0.001) sawForward = true;
    }
    expect(sawForward).toBe(true);
  });

  it("rejects high-frequency low-amplitude velocity noise (stuck jitter)", () => {
    const { rig } = makeRig();
    rig.setMode("first");
    rig.update(0, poseAt(1), {
      snap: true,
      linvel: { x: 0, y: 0, z: 0 },
    });
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

  it("stays calm when velocity turns at nearly constant speed", () => {
    const { rig } = makeRig();
    rig.setMode("first");
    const speed = 14;
    rig.update(0, poseAt(1), {
      snap: true,
      linvel: { x: 0, y: 0, z: speed },
    });
    for (let i = 0; i < 20; i++) {
      rig.update(1 / 60, poseAt(1), {
        linvel: { x: 0, y: 0, z: speed },
      });
    }
    let maxLat = 0;
    let maxLon = 0;
    for (let i = 1; i <= 30; i++) {
      const ang = (i / 30) * (Math.PI / 2);
      rig.update(1 / 60, poseAt(1), {
        linvel: {
          x: speed * Math.sin(ang),
          y: 0,
          z: speed * Math.cos(ang),
        },
      });
      const o = rig.getHeadOffsetLocal();
      maxLat = Math.max(maxLat, Math.abs(o.x));
      maxLon = Math.max(maxLon, Math.abs(o.z));
    }
    expect(maxLat).toBeLessThan(0.018);
    expect(maxLon).toBeLessThan(0.02);
  });

  it("hard-mounts seat eye when head offset is zero", () => {
    const { rig } = makeRig();
    rig.setMode("first");
    rig.update(0, poseAt(1), { snap: true, linvel: { x: 0, y: 0, z: 0 } });
    rig.update(1 / 60, poseAt(2), { linvel: { x: 0, y: 0, z: 0 } });
    expect(rig.getFpEyeWorld().y).toBeCloseTo(2 + 1.15, 4);
    expect(rig.getHeadOffsetLocal().y).toBeCloseTo(0, 4);
  });

  it("keeps head Y soft-offset at 0 under strong vertical accel", () => {
    const { rig } = makeRig();
    rig.setMode("first");
    rig.update(0, poseAt(1), {
      snap: true,
      linvel: { x: 0, y: 0, z: 8 },
    });
    for (let i = 1; i <= 40; i++) {
      // Large Δvy each frame → would have driven the old Y oscillator hard.
      rig.update(1 / 60, poseAt(1), {
        linvel: { x: 0, y: i % 2 === 0 ? 8 : -8, z: 8 },
      });
    }
    expect(rig.getHeadOffsetLocal().y).toBe(0);
    expect(rig.getHeadOffsetLocal().y).toBeCloseTo(0, 5);
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

describe("CameraRig first-person head roll (lateral)", () => {
  it("rolls under sustained lateral accel and returns when a→0", () => {
    const { rig } = makeRig();
    rig.setMode("first");
    rig.update(0, poseAt(1), {
      snap: true,
      linvel: { x: 0, y: 0, z: 12 },
    });
    // Pure lateral accel (world +X) while cruising forward
    for (let i = 1; i <= 40; i++) {
      rig.update(1 / 60, poseAt(1), {
        linvel: { x: i * 0.4, y: 0, z: 12 },
      });
    }
    // Positive a_x → negative head roll (inertia)
    expect(rig.getHeadRoll()).toBeLessThan(-0.008);

    for (let i = 0; i < 100; i++) {
      rig.update(1 / 60, poseAt(1), {
        linvel: { x: 16, y: 0, z: 12 },
      });
    }
    expect(Math.abs(rig.getHeadRoll())).toBeLessThan(0.015);
  });

  it("overshoots roll toward the opposite side when lateral a ends", () => {
    const { rig } = makeRig();
    rig.setMode("first");
    rig.update(0, poseAt(1), {
      snap: true,
      linvel: { x: 0, y: 0, z: 10 },
    });
    for (let i = 1; i <= 35; i++) {
      rig.update(1 / 60, poseAt(1), {
        linvel: { x: i * 0.45, y: 0, z: 10 },
      });
    }
    expect(rig.getHeadRoll()).toBeLessThan(-0.005);

    let sawOpposite = false;
    for (let i = 0; i < 80; i++) {
      rig.update(1 / 60, poseAt(1), {
        linvel: { x: 16, y: 0, z: 10 },
      });
      if (rig.getHeadRoll() > 0.002) sawOpposite = true;
    }
    expect(sawOpposite).toBe(true);
  });

  it("does not thrash roll from pure vertical hop accel", () => {
    const { rig } = makeRig();
    rig.setMode("first");
    rig.update(0, poseAt(1), {
      snap: true,
      linvel: { x: 0, y: 0, z: 8 },
    });
    let maxAbsRoll = 0;
    for (let i = 0; i < 40; i++) {
      const vy = i % 2 === 0 ? 3 : -3;
      rig.update(1 / 60, poseAt(1), {
        linvel: { x: 0, y: vy, z: 8 },
      });
      maxAbsRoll = Math.max(maxAbsRoll, Math.abs(rig.getHeadRoll()));
    }
    expect(maxAbsRoll).toBeLessThan(0.02);
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
    const imp = rig.getImpactOffsetLocal();
    expect(imp.x).toBe(0);
    expect(imp.y).toBe(0);
    expect(imp.z).toBe(0);
  });

  it("kicks longitudinal impact offset on wheel air→ground, not vertical", () => {
    const { rig, camera } = makeRig();
    rig.setMode("first");
    rig.update(0, poseAt(2), {
      snap: true,
      linvel: { x: 0, y: 0, z: 0 },
      wheelContacts: [false, false, false, false],
      bodyContactCount: 0,
    });
    rig.update(1 / 60, poseAt(1), {
      linvel: { x: 0, y: -6, z: 0 },
      wheelContacts: [true, true, true, true],
      bodyContactCount: 0,
    });
    const imp = rig.getImpactOffsetLocal();
    expect(imp.z).toBeLessThan(-0.001);
    expect(imp.y).toBe(0);
    expect(rig.getHeadOffsetLocal().y).toBe(0);
    // Flat chassis: impact Z does not change world Y vs pure seat path
    expect(camera.position.y).toBeCloseTo(rig.getFpEyeWorld().y, 5);
  });

  it("decays longitudinal impact residual over time", () => {
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
    const z0 = Math.abs(rig.getImpactOffsetLocal().z);
    expect(z0).toBeGreaterThan(0.001);
    for (let i = 0; i < 60; i++) {
      rig.update(1 / 60, poseAt(1), {
        linvel: { x: 0, y: 0, z: 0 },
        wheelContacts: [true, true, true, true],
        bodyContactCount: 0,
      });
    }
    expect(Math.abs(rig.getImpactOffsetLocal().z)).toBeLessThan(z0 * 0.05);
    expect(rig.getImpactOffsetLocal().y).toBe(0);
  });

  it("fires body-slam roll without vertical impact offset", () => {
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
    expect(rig.getImpactOffsetLocal().y).toBe(0);
    expect(Math.abs(rig.getImpactOffsetLocal().z)).toBeGreaterThan(0.001);
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
    const zAfter = Math.abs(rig.getImpactOffsetLocal().z);
    expect(zAfter).toBeGreaterThan(0.001);
    rig.update(1 / 60, poseAt(1), {
      linvel: { x: 0, y: 0, z: 0 },
      bodyContactCount: 2,
      wheelContacts: [true, true, true, true],
    });
    // Cooldown: residual only decays, must not re-spike above first kick
    expect(Math.abs(rig.getImpactOffsetLocal().z)).toBeLessThanOrEqual(
      zAfter + 1e-9,
    );
    expect(rig.getImpactOffsetLocal().y).toBe(0);
  });

  it("keeps camera local-Y on seat under vertical hop + landing", () => {
    const { rig, camera } = makeRig();
    rig.setMode("first");
    rig.update(0, poseAt(1), {
      snap: true,
      linvel: { x: 0, y: 0, z: 0 },
      wheelContacts: [false, false, false, false],
      bodyContactCount: 0,
    });
    for (let i = 0; i < 20; i++) {
      const y = 1 + (i % 3) * 0.1;
      rig.update(1 / 60, poseAt(y), {
        linvel: { x: 0, y: i % 2 === 0 ? 4 : -6, z: 5 },
        wheelContacts: [i % 4 === 0, true, true, true],
        bodyContactCount: i % 5 === 0 ? 2 : 0,
      });
      // Flat yaw pose: camera world Y must match hard seat (+ optional XZ→no Y)
      expect(camera.position.y).toBeCloseTo(y + 1.15, 4);
      expect(rig.getHeadOffsetLocal().y).toBe(0);
      expect(rig.getImpactOffsetLocal().y).toBe(0);
    }
  });
});
