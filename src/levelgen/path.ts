import type { Vec3 } from "@/shared/types";
import type { VehicleCapabilities } from "@/shared/vehicleCapabilities";
import { clamp } from "@/shared/math";
import {
  PATH_POINT_SPACING_M,
  PATH_SAFETY_FACTOR,
  START_FINISH_EDGE_MARGIN_M,
} from "./types";

export function maxSegmentSlopeRad(a: Vec3, b: Vec3): number {
  const horiz = Math.hypot(b.x - a.x, b.z - a.z) || 1e-6;
  return Math.atan(Math.abs(b.y - a.y) / horiz);
}

export function assignPathHeights(
  points: Vec3[],
  vehicle: VehicleCapabilities,
): Vec3[] {
  if (points.length === 0) return [];
  const out: Vec3[] = points.map((p) => ({ ...p }));
  out[0].y = out[0].y || 8;
  const maxGrade = Math.tan(vehicle.maxSlopeRad) * PATH_SAFETY_FACTOR;
  const maxStep = vehicle.maxStepHeight * PATH_SAFETY_FACTOR;
  for (let i = 1; i < out.length; i++) {
    const horiz =
      Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z) || 1e-6;
    const maxDh = Math.min(maxStep, maxGrade * horiz);
    const target = out[i].y;
    const prev = out[i - 1].y;
    out[i].y = clamp(target, prev - maxDh, prev + maxDh);
  }
  // second pass backward for consistency
  for (let i = out.length - 2; i >= 0; i--) {
    const horiz =
      Math.hypot(out[i].x - out[i + 1].x, out[i].z - out[i + 1].z) || 1e-6;
    const maxDh = Math.min(maxStep, maxGrade * horiz);
    out[i].y = clamp(out[i].y, out[i + 1].y - maxDh, out[i + 1].y + maxDh);
  }
  return out;
}

export function generatePathPolyline(
  rng: () => number,
  mapSize: number,
  vehicle: VehicleCapabilities,
): { points: Vec3[]; startYaw: number; endYaw: number } {
  const m = START_FINISH_EDGE_MARGIN_M;
  const half = mapSize / 2;
  const start = {
    x: -half + m,
    y: 10,
    z: (rng() * 2 - 1) * (half - m),
  };
  const end = {
    x: half - m,
    y: 10,
    z: (rng() * 2 - 1) * (half - m),
  };

  const points: Vec3[] = [{ ...start }];
  let x = start.x;
  let z = start.z;
  let yaw = Math.atan2(end.x - start.x, end.z - start.z);
  const maxTurn = PATH_POINT_SPACING_M / Math.max(vehicle.minTurnRadius, 0.1);

  for (let guard = 0; guard < 2000; guard++) {
    const toEndX = end.x - x;
    const toEndZ = end.z - z;
    const dist = Math.hypot(toEndX, toEndZ);
    if (dist < PATH_POINT_SPACING_M * 1.2) break;

    const desired = Math.atan2(toEndX, toEndZ);
    let delta = desired - yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const noise = (rng() - 0.5) * maxTurn;
    delta = clamp(delta + noise, -maxTurn, maxTurn);
    yaw += delta;

    x += Math.sin(yaw) * PATH_POINT_SPACING_M;
    z += Math.cos(yaw) * PATH_POINT_SPACING_M;
    x = clamp(x, -half + m * 0.5, half - m * 0.5);
    z = clamp(z, -half + m * 0.5, half - m * 0.5);
    // gentle random elevation target; assignPathHeights will clamp
    const y = 8 + (rng() - 0.5) * 12;
    points.push({ x, y, z });
  }
  points.push({ ...end });

  const withHeights = assignPathHeights(points, vehicle);
  const startYaw = Math.atan2(
    withHeights[1].x - withHeights[0].x,
    withHeights[1].z - withHeights[0].z,
  );
  const n = withHeights.length;
  const endYaw = Math.atan2(
    withHeights[n - 1].x - withHeights[n - 2].x,
    withHeights[n - 1].z - withHeights[n - 2].z,
  );
  return { points: withHeights, startYaw, endYaw };
}

export function fallbackPath(
  mapSize: number,
  vehicle: VehicleCapabilities,
): { points: Vec3[]; startYaw: number; endYaw: number } {
  const m = START_FINISH_EDGE_MARGIN_M;
  const half = mapSize / 2;
  const points: Vec3[] = [];
  const startX = -half + m;
  const endX = half - m;
  for (let x = startX; x <= endX; x += PATH_POINT_SPACING_M) {
    const t = (x - startX) / (endX - startX || 1);
    const y = 10 + Math.sin(t * Math.PI) * 3;
    points.push({ x, y, z: 0 });
  }
  if (points.length === 0 || points[points.length - 1].x < endX - 1e-3) {
    points.push({ x: endX, y: 10, z: 0 });
  }
  const withHeights = assignPathHeights(points, vehicle);
  // Path runs +X => yaw = PI/2 (yaw 0 is +Z)
  const yaw = Math.PI / 2;
  return { points: withHeights, startYaw: yaw, endYaw: yaw };
}
