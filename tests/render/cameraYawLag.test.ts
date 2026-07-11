import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CameraRig } from "@/render/CameraRig";
import { deltaAngle } from "@/shared/math";

function makeRig(): CameraRig {
  const cam = new THREE.PerspectiveCamera(55, 1, 0.1, 1000);
  return new CameraRig(cam);
}

const origin = { x: 0, y: 1, z: 0 };

describe("CameraRig third-person yaw lag", () => {
  it("snaps followYaw to pose on first update", () => {
    const rig = makeRig();
    rig.update(1 / 60, { position: origin, yaw: 0.4 }, { speedMps: 0 });
    expect(rig.getFollowYaw()).toBeCloseTo(0.4, 5);
  });

  it("lags behind a step change at low speed", () => {
    const rig = makeRig();
    rig.update(1 / 60, { position: origin, yaw: 0 }, { speedMps: 0 });
    // Instant 45° left turn
    rig.update(1 / 60, { position: origin, yaw: Math.PI / 4 }, { speedMps: 0 });
    const lag = Math.abs(deltaAngle(rig.getFollowYaw(), Math.PI / 4));
    expect(lag).toBeGreaterThan(0.15);
    expect(lag).toBeLessThan(Math.PI / 4);
  });

  it("catches up faster at high speed than at low speed", () => {
    const low = makeRig();
    const high = makeRig();
    low.update(0, { position: origin, yaw: 0 }, { snap: true });
    high.update(0, { position: origin, yaw: 0 }, { snap: true });

    const target = Math.PI / 3;
    const dt = 1 / 60;
    for (let i = 0; i < 12; i++) {
      low.update(dt, { position: origin, yaw: target }, { speedMps: 0 });
      high.update(dt, { position: origin, yaw: target }, { speedMps: 20 });
    }

    const lagLow = Math.abs(deltaAngle(low.getFollowYaw(), target));
    const lagHigh = Math.abs(deltaAngle(high.getFollowYaw(), target));
    expect(lagHigh).toBeLessThan(lagLow);
  });

  it("clamps residual lag under max (~1.2 rad)", () => {
    const rig = makeRig();
    rig.update(0, { position: origin, yaw: 0 }, { snap: true });
    // Huge single-frame yaw jump (spinout)
    rig.update(
      1 / 60,
      { position: origin, yaw: Math.PI },
      { speedMps: 0 },
    );
    const lag = Math.abs(deltaAngle(rig.getFollowYaw(), Math.PI));
    expect(lag).toBeLessThanOrEqual(1.2 + 1e-6);
  });

  it("snaps followYaw when opts.snap is set", () => {
    const rig = makeRig();
    rig.update(0, { position: origin, yaw: 0 }, { snap: true });
    rig.update(1 / 60, { position: origin, yaw: 1.0 }, { speedMps: 0 });
    expect(Math.abs(deltaAngle(rig.getFollowYaw(), 1.0))).toBeGreaterThan(0.05);

    rig.update(0, { position: origin, yaw: -0.8 }, { snap: true });
    expect(rig.getFollowYaw()).toBeCloseTo(-0.8, 5);
  });

  it("tracks across ±π wrap without spinning the long way", () => {
    const rig = makeRig();
    const start = Math.PI - 0.05;
    const end = -Math.PI + 0.05;
    rig.update(0, { position: origin, yaw: start }, { snap: true });
    // Small steps across the wrap; follow should stay near the short arc.
    for (let i = 0; i < 20; i++) {
      const t = (i + 1) / 20;
      // interpolate along short arc (~0.1 rad)
      const yaw = start + 0.1 * t;
      rig.update(
        1 / 60,
        { position: origin, yaw },
        { speedMps: 5 },
      );
    }
    // After crossing wrap, followYaw should be near end, not near 0 via long way
    rig.update(1 / 60, { position: origin, yaw: end }, { speedMps: 5 });
    const lag = Math.abs(deltaAngle(rig.getFollowYaw(), end));
    expect(lag).toBeLessThan(0.5);
  });
});
