import type { Vec3 } from "@/shared/types";
import type { VehicleCapabilities } from "@/shared/vehicleCapabilities";
import { sampleBilinear } from "./heightmap";
import {
  PATH_SAFETY_FACTOR,
  STREAM_MAX_DEPTH_ON_PATH_M,
  type LevelData,
  type ValidationResult,
} from "./types";

const EPS = 1e-6;
const PATH_NEAR_M = 6;
const RIBBON_HEIGHT_TOL_FACTOR = 1.25;

function finite(n: number): boolean {
  return Number.isFinite(n);
}

function horizDist(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function segmentHeading(a: Vec3, b: Vec3): number {
  return Math.atan2(b.x - a.x, b.z - a.z);
}

function normalizeAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function pathNormal(yaw: number): { x: number; z: number } {
  // yaw 0 => +Z; left normal (perpendicular) is +X when facing +Z
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}

function distPointToSegmentXZ(
  p: Vec3,
  a: Vec3,
  b: Vec3,
): { dist: number; t: number; closest: { x: number; z: number; y: number } } {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  let t = 0;
  if (len2 > EPS) {
    t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2;
    t = Math.max(0, Math.min(1, t));
  }
  const cx = a.x + abx * t;
  const cz = a.z + abz * t;
  const cy = a.y + (b.y - a.y) * t;
  return {
    dist: Math.hypot(p.x - cx, p.z - cz),
    t,
    closest: { x: cx, y: cy, z: cz },
  };
}

function distToPolylineXZ(
  p: Vec3,
  poly: Vec3[],
): { dist: number; closestY: number } {
  let best = Infinity;
  let closestY = p.y;
  for (let i = 1; i < poly.length; i++) {
    const r = distPointToSegmentXZ(p, poly[i - 1], poly[i]);
    if (r.dist < best) {
      best = r.dist;
      closestY = r.closest.y;
    }
  }
  return { dist: best, closestY };
}

function checkSlopeStepPair(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  maxGrade: number,
  maxStep: number,
  label: string,
  reasons: string[],
): void {
  const horiz = Math.hypot(bx - ax, bz - az) || 1e-6;
  const dh = Math.abs(by - ay);
  if (dh > maxStep + 1e-5) {
    reasons.push(`${label}: step ${dh.toFixed(3)} > ${maxStep.toFixed(3)}`);
  }
  if (dh / horiz > maxGrade + 1e-5) {
    reasons.push(
      `${label}: slope ${(dh / horiz).toFixed(4)} > ${maxGrade.toFixed(4)}`,
    );
  }
}

function pointInFinishAabb(pos: Vec3, finish: LevelData["finish"]): boolean {
  const he = finish.halfExtents;
  const c = finish.position;
  return (
    Math.abs(pos.x - c.x) <= he.x &&
    Math.abs(pos.y - c.y) <= he.y &&
    Math.abs(pos.z - c.z) <= he.z
  );
}

/**
 * GeometricSolvability validator — all 9 checklist items.
 * Pure function; no Three/Rapier.
 */
export function validateLevel(
  level: LevelData,
  vehicle: VehicleCapabilities,
): ValidationResult {
  const reasons: string[] = [];
  const path = level.pathPolyline;
  const maxGrade = Math.tan(vehicle.maxSlopeRad) * PATH_SAFETY_FACTOR;
  const maxStep = vehicle.maxStepHeight * PATH_SAFETY_FACTOR;
  const halfRibbon = (vehicle.trackWidth + 2 * vehicle.pathClearance) / 2;
  const wheelHalf = vehicle.trackWidth / 2;

  // 1. Continuous centerline
  if (!path || path.length < 2) {
    reasons.push("pathPolyline length < 2");
    return { ok: false, reasons };
  }

  // 7 (partial). Path samples finite
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (!finite(p.x) || !finite(p.y) || !finite(p.z)) {
      reasons.push(`path point ${i} not finite`);
    }
  }

  // 7. Heightmap samples finite
  const hm = level.heightmap;
  if (!hm || hm.length !== level.resolution * level.resolution) {
    reasons.push("heightmap size mismatch");
  } else {
    for (let i = 0; i < hm.length; i++) {
      if (!finite(hm[i])) {
        reasons.push(`heightmap sample ${i} not finite`);
        break;
      }
    }
  }

  // 2. Centerline consecutive slope + step
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    checkSlopeStepPair(
      a.x,
      a.y,
      a.z,
      b.x,
      b.y,
      b.z,
      maxGrade,
      maxStep,
      `centerline ${i - 1}->${i}`,
      reasons,
    );
  }

  // 3. Left/right wheel tracks via bilinear height samples
  if (hm && hm.length === level.resolution * level.resolution) {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const yaw = segmentHeading(a, b);
      const n = pathNormal(yaw);
      for (const side of [-1, 1] as const) {
        const ox = n.x * wheelHalf * side;
        const oz = n.z * wheelHalf * side;
        const ay = sampleBilinear(
          hm,
          level.resolution,
          level.worldSize,
          a.x + ox,
          a.z + oz,
        );
        const by = sampleBilinear(
          hm,
          level.resolution,
          level.worldSize,
          b.x + ox,
          b.z + oz,
        );
        if (!finite(ay) || !finite(by)) {
          reasons.push(`wheel track ${side} sample not finite at seg ${i}`);
          continue;
        }
        checkSlopeStepPair(
          a.x + ox,
          ay,
          a.z + oz,
          b.x + ox,
          by,
          b.z + oz,
          maxGrade,
          maxStep,
          `wheel${side > 0 ? "R" : "L"} ${i - 1}->${i}`,
          reasons,
        );
      }
    }
  }

  // 4. Path ribbon width: cells within halfRibbon of path have path-consistent heights
  if (hm && hm.length === level.resolution * level.resolution) {
    const res = level.resolution;
    const worldSize = level.worldSize;
    const cell = worldSize / (res - 1);
    const origin = -worldSize / 2;
    const tol = maxStep * RIBBON_HEIGHT_TOL_FACTOR + cell * 0.5;
    let ribbonFail = 0;
    // Sample along path at denser spacing for ribbon support
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      let yaw = 0;
      if (i < path.length - 1) yaw = segmentHeading(p, path[i + 1]);
      else yaw = segmentHeading(path[i - 1], p);
      const n = pathNormal(yaw);
      // Probe left edge, center, right edge of required ribbon
      for (const lat of [-halfRibbon, 0, halfRibbon]) {
        const x = p.x + n.x * lat;
        const z = p.z + n.z * lat;
        const y = sampleBilinear(hm, res, worldSize, x, z);
        if (!finite(y)) {
          ribbonFail++;
          continue;
        }
        // Path-consistent: within step tolerance of centerline height
        if (Math.abs(y - p.y) > tol) {
          ribbonFail++;
        }
      }
    }
    // Also verify grid cells near path mid-segment
    for (let i = 1; i < path.length; i += Math.max(1, Math.floor(path.length / 24))) {
      const mid = {
        x: (path[i - 1].x + path[i].x) * 0.5,
        y: (path[i - 1].y + path[i].y) * 0.5,
        z: (path[i - 1].z + path[i].z) * 0.5,
      };
      const yaw = segmentHeading(path[i - 1], path[i]);
      const n = pathNormal(yaw);
      for (const lat of [-halfRibbon * 0.9, halfRibbon * 0.9]) {
        const x = mid.x + n.x * lat;
        const z = mid.z + n.z * lat;
        // Ensure sample is on map
        if (
          x < origin ||
          z < origin ||
          x > origin + worldSize ||
          z > origin + worldSize
        ) {
          ribbonFail++;
          continue;
        }
        const y = sampleBilinear(hm, res, worldSize, x, z);
        if (!finite(y) || Math.abs(y - mid.y) > tol) {
          ribbonFail++;
        }
      }
    }
    if (ribbonFail > 0) {
      reasons.push(
        `path ribbon width support failed (${ribbonFail} samples; need >= ${halfRibbon.toFixed(2)}m half-width)`,
      );
    }
  }

  // 5. Curvature: radius >= minTurnRadius via ds / dHeading
  for (let i = 1; i < path.length - 1; i++) {
    const h0 = segmentHeading(path[i - 1], path[i]);
    const h1 = segmentHeading(path[i], path[i + 1]);
    const dHeading = Math.abs(normalizeAngle(h1 - h0));
    const ds =
      (horizDist(path[i - 1], path[i]) + horizDist(path[i], path[i + 1])) *
      0.5;
    if (dHeading > 1e-4) {
      const radius = ds / dHeading;
      if (radius + 1e-3 < vehicle.minTurnRadius) {
        reasons.push(
          `curvature at ${i}: radius ${radius.toFixed(2)} < minTurnRadius ${vehicle.minTurnRadius}`,
        );
      }
    }
  }

  // 6. Stream depth on path samples
  if (level.streams && level.streams.length > 0 && hm) {
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      for (const stream of level.streams) {
        if (!stream.polyline || stream.polyline.length < 2) continue;
        const { dist } = distToPolylineXZ(p, stream.polyline);
        if (dist <= stream.width * 0.5 + EPS) {
          const bed = sampleBilinear(
            hm,
            level.resolution,
            level.worldSize,
            p.x,
            p.z,
          );
          let yaw = 0;
          if (i < path.length - 1) yaw = segmentHeading(p, path[i + 1]);
          else yaw = segmentHeading(path[i - 1], p);
          const n = pathNormal(yaw);
          const bankR = stream.width * 0.5 + 1;
          const yL = sampleBilinear(
            hm,
            level.resolution,
            level.worldSize,
            p.x + n.x * bankR,
            p.z + n.z * bankR,
          );
          const yR = sampleBilinear(
            hm,
            level.resolution,
            level.worldSize,
            p.x - n.x * bankR,
            p.z - n.z * bankR,
          );
          // Depth ≈ max(bank, pathY) − bed under sample
          const surface = Math.max(yL, yR, p.y);
          const depth = Math.max(0, surface - bed, p.y - bed);
          if (depth > STREAM_MAX_DEPTH_ON_PATH_M + 1e-3) {
            reasons.push(
              `stream depth ${depth.toFixed(3)} > ${STREAM_MAX_DEPTH_ON_PATH_M} at path ${i}`,
            );
          }
        }
      }
    }
  }

  // 8. Spawn / checkpoints
  if (!finite(level.start.yaw)) {
    reasons.push("start yaw not finite");
  }
  if (
    !finite(level.start.position.x) ||
    !finite(level.start.position.y) ||
    !finite(level.start.position.z)
  ) {
    reasons.push("start position not finite");
  } else if (hm) {
    const gy = sampleBilinear(
      hm,
      level.resolution,
      level.worldSize,
      level.start.position.x,
      level.start.position.z,
    );
    if (!finite(gy)) reasons.push("ground under start not finite");
  }

  if (pointInFinishAabb(level.start.position, level.finish)) {
    reasons.push("start is inside finish AABB");
  }

  for (const cp of level.checkpoints) {
    if (!finite(cp.yaw)) reasons.push(`checkpoint ${cp.id} yaw not finite`);
    if (
      !finite(cp.position.x) ||
      !finite(cp.position.y) ||
      !finite(cp.position.z)
    ) {
      reasons.push(`checkpoint ${cp.id} position not finite`);
      continue;
    }
    if (hm) {
      const gy = sampleBilinear(
        hm,
        level.resolution,
        level.worldSize,
        cp.position.x,
        cp.position.z,
      );
      if (!finite(gy)) reasons.push(`ground under checkpoint ${cp.id} not finite`);
    }
    const { dist } = distToPolylineXZ(cp.position, path);
    if (dist > PATH_NEAR_M) {
      reasons.push(
        `checkpoint ${cp.id} too far from path (${dist.toFixed(2)}m)`,
      );
    }
  }

  // 9. Finish halfExtents positive and finite
  const he = level.finish.halfExtents;
  if (!finite(he.x) || !finite(he.y) || !finite(he.z)) {
    reasons.push("finish halfExtents not finite");
  } else if (he.x <= 0 || he.y <= 0 || he.z <= 0) {
    reasons.push("finish halfExtents must be positive");
  }
  if (
    !finite(level.finish.position.x) ||
    !finite(level.finish.position.y) ||
    !finite(level.finish.position.z)
  ) {
    reasons.push("finish position not finite");
  }
  if (!finite(level.finish.yaw)) {
    reasons.push("finish yaw not finite");
  }

  // Cap reasons for readability
  if (reasons.length > 40) {
    const extra = reasons.length - 40;
    reasons.length = 40;
    reasons.push(`...and ${extra} more`);
  }

  return { ok: reasons.length === 0, reasons };
}
