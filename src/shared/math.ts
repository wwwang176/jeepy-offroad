import type { Vec3 } from "./types";

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Wrap radians to (-π, π]. */
export function wrapAngle(rad: number): number {
  return Math.atan2(Math.sin(rad), Math.cos(rad));
}

/** Shortest signed angle from `from` to `to` in (-π, π]. */
export function deltaAngle(from: number, to: number): number {
  return wrapAngle(to - from);
}

/** yaw 0 => +Z; yaw +PI/2 => +X */
export function yawToDir(yaw: number): Vec3 {
  return { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}
