import type { Vec3 } from "@/shared/types";

/** Chassis pose used for mesh + camera render. */
export type RenderPose = {
  position: Vec3;
  yaw: number;
  rotation: { x: number; y: number; z: number; w: number };
};

/** Per-wheel visual state (matches VehicleController.getWheelVisuals). */
export type RenderWheelVisual = {
  suspensionLength: number;
  rotation: number;
  steering: number;
};

export function cloneRenderPose(p: RenderPose): RenderPose {
  return {
    position: { x: p.position.x, y: p.position.y, z: p.position.z },
    yaw: p.yaw,
    rotation: {
      x: p.rotation.x,
      y: p.rotation.y,
      z: p.rotation.z,
      w: p.rotation.w,
    },
  };
}

export function cloneWheelVisuals(
  wheels: readonly RenderWheelVisual[],
): RenderWheelVisual[] {
  return wheels.map((w) => ({
    suspensionLength: w.suspensionLength,
    rotation: w.rotation,
    steering: w.steering,
  }));
}

function yawFromQuat(q: { x: number; y: number; z: number; w: number }): number {
  const siny = 2 * (q.w * q.y + q.z * q.x);
  const cosy = 1 - 2 * (q.y * q.y + q.x * q.x);
  return Math.atan2(siny, cosy);
}

/**
 * Spherical linear interpolation of unit quaternions (shortest arc).
 * Falls back to nlerp when quats are nearly parallel.
 */
export function slerpQuat(
  a: { x: number; y: number; z: number; w: number },
  b: { x: number; y: number; z: number; w: number },
  t: number,
): { x: number; y: number; z: number; w: number } {
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;
  let cosOmega = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (cosOmega < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    cosOmega = -cosOmega;
  }

  let scale0: number;
  let scale1: number;
  if (cosOmega > 0.9995) {
    scale0 = 1 - t;
    scale1 = t;
  } else {
    const omega = Math.acos(Math.min(1, cosOmega));
    const sinOmega = Math.sin(omega);
    scale0 = Math.sin((1 - t) * omega) / sinOmega;
    scale1 = Math.sin(t * omega) / sinOmega;
  }

  let x = scale0 * a.x + scale1 * bx;
  let y = scale0 * a.y + scale1 * by;
  let z = scale0 * a.z + scale1 * bz;
  let w = scale0 * a.w + scale1 * bw;
  const inv = 1 / Math.hypot(x, y, z, w);
  return { x: x * inv, y: y * inv, z: z * inv, w: w * inv };
}

/**
 * Interpolate between two physics snapshots for rendering.
 * `alpha` is accumulator remainder / FIXED_DT ∈ [0, 1).
 */
export function lerpRenderPose(
  prev: RenderPose,
  curr: RenderPose,
  alpha: number,
): RenderPose {
  const t = Math.min(1, Math.max(0, alpha));
  const rotation = slerpQuat(prev.rotation, curr.rotation, t);
  return {
    position: {
      x: prev.position.x + (curr.position.x - prev.position.x) * t,
      y: prev.position.y + (curr.position.y - prev.position.y) * t,
      z: prev.position.z + (curr.position.z - prev.position.z) * t,
    },
    rotation,
    yaw: yawFromQuat(rotation),
  };
}

export function lerpWheelVisuals(
  prev: readonly RenderWheelVisual[],
  curr: readonly RenderWheelVisual[],
  alpha: number,
): RenderWheelVisual[] {
  const t = Math.min(1, Math.max(0, alpha));
  const n = Math.min(prev.length, curr.length);
  const out: RenderWheelVisual[] = [];
  for (let i = 0; i < n; i++) {
    const a = prev[i]!;
    const b = curr[i]!;
    out.push({
      suspensionLength:
        a.suspensionLength + (b.suspensionLength - a.suspensionLength) * t,
      rotation: a.rotation + (b.rotation - a.rotation) * t,
      steering: a.steering + (b.steering - a.steering) * t,
    });
  }
  return out;
}
