import type { Vec3 } from "@/shared/types";
import type { VehicleCapabilities } from "@/shared/vehicleCapabilities";
import { clamp } from "@/shared/math";
import { sampleBilinear } from "./heightmap";
import {
  PATH_POINT_SPACING_M,
  PATH_SAFETY_FACTOR,
  START_FINISH_EDGE_MARGIN_M,
} from "./types";

export function maxSegmentSlopeRad(a: Vec3, b: Vec3): number {
  const horiz = Math.hypot(b.x - a.x, b.z - a.z) || 1e-6;
  return Math.atan(Math.abs(b.y - a.y) / horiz);
}

/**
 * Clamp consecutive heights to continuous-grade budget (maxSlope × safety).
 * Used after sampling terrain so the route follows landforms but stays drivable.
 */
export function assignPathHeights(
  points: Vec3[],
  vehicle: VehicleCapabilities,
): Vec3[] {
  if (points.length === 0) return [];
  const out: Vec3[] = points.map((p) => ({ ...p }));
  out[0].y = Number.isFinite(out[0].y) ? out[0].y : 10;
  // Leave headroom under the validator grade so wheel tracks on curves
  // (offset samples) still pass — otherwise every seed falls back to a strip.
  const maxGrade =
    Math.tan(vehicle.maxSlopeRad) * PATH_SAFETY_FACTOR * 0.88;
  for (let i = 1; i < out.length; i++) {
    const horiz =
      Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z) || 1e-6;
    const maxDh = maxGrade * horiz;
    out[i].y = clamp(out[i].y, out[i - 1].y - maxDh, out[i - 1].y + maxDh);
  }
  for (let i = out.length - 2; i >= 0; i--) {
    const horiz =
      Math.hypot(out[i].x - out[i + 1].x, out[i].z - out[i + 1].z) || 1e-6;
    const maxDh = maxGrade * horiz;
    out[i].y = clamp(out[i].y, out[i + 1].y - maxDh, out[i + 1].y + maxDh);
  }
  return out;
}

/**
 * Sample heightmap along an XZ polyline, then grade-limit so the path
 * *follows terrain* instead of inventing a flat design profile that later
 * stamps a highway through the map.
 */
export function fitPathToHeightmap(
  points: Vec3[],
  heightmap: Float32Array,
  resolution: number,
  worldSize: number,
  vehicle: VehicleCapabilities,
): Vec3[] {
  const sampled = points.map((p) => {
    const y = sampleBilinear(heightmap, resolution, worldSize, p.x, p.z);
    return {
      x: p.x,
      z: p.z,
      y: Number.isFinite(y) ? y : 10,
    };
  });
  return assignPathHeights(sampled, vehicle);
}

function pathLengthXZ(points: { x: number; z: number }[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].z - points[i - 1].z,
    );
  }
  return len;
}

/**
 * Big lateral meander controls — alternate sides so the route is an S-curve,
 * not a straight west→east corridor.
 */
function buildMeanderControls(
  rng: () => number,
  start: { x: number; z: number },
  end: { x: number; z: number },
  bound: number,
): { x: number; z: number }[] {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const plen = Math.hypot(dx, dz) || 1;
  const tx = dx / plen;
  const tz = dz / plen;
  const nx = -dz / plen;
  const nz = dx / plen;

  // 4–7 bends for a 256 m map
  const nMid = 4 + Math.floor(rng() * 4); // 4..7
  const controls: { x: number; z: number }[] = [{ x: start.x, z: start.z }];
  let side = rng() < 0.5 ? 1 : -1;

  for (let i = 1; i <= nMid; i++) {
    const t = i / (nMid + 1);
    const tj = clamp(t + (rng() - 0.5) * (0.35 / (nMid + 1)), 0.06, 0.94);
    const along = plen * tj;
    const baseX = start.x + tx * along;
    const baseZ = start.z + tz * along;

    // Strong lateral throw (45–75% of free half-map)
    const latAmp = bound * (0.48 + rng() * 0.27);
    side = -side; // always flip → clear S / switchback pattern
    const lat = side * latAmp * (0.85 + rng() * 0.15);

    let x = baseX + nx * lat + tx * (rng() - 0.5) * 10;
    let z = baseZ + nz * lat + tz * (rng() - 0.5) * 10;
    x = clamp(x, -bound, bound);
    z = clamp(z, -bound, bound);
    controls.push({ x, z });
  }
  controls.push({ x: end.x, z: end.z });
  return controls;
}

/** Dense ideal polyline through controls (piecewise linear). */
function densifyControls(
  controls: { x: number; z: number }[],
  spacing: number,
): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < controls.length - 1; i++) {
    const a = controls[i];
    const b = controls[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1e-6;
    const n = Math.max(1, Math.ceil(len / spacing));
    for (let s = 0; s < n; s++) {
      const t = s / n;
      out.push({
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
      });
    }
  }
  const last = controls[controls.length - 1];
  out.push({ x: last.x, z: last.z });
  return out;
}

/**
 * Pure-pursuit along ideal polyline with turn-radius limit.
 * Follows meander waypoints instead of homing straight to the finish.
 */
function pursuePolyline(
  ideal: { x: number; z: number }[],
  rng: () => number,
  mapSize: number,
  vehicle: VehicleCapabilities,
): Vec3[] {
  if (ideal.length < 2) {
    return ideal.map((p) => ({ x: p.x, y: 0, z: p.z }));
  }

  const m = START_FINISH_EDGE_MARGIN_M;
  const half = mapSize / 2;
  const softBound = half - m * 0.45;
  const maxTurn =
    PATH_POINT_SPACING_M / Math.max(vehicle.minTurnRadius, 0.1);
  const lookAhead = Math.max(PATH_POINT_SPACING_M * 3.5, vehicle.minTurnRadius * 1.2);

  let x = ideal[0].x;
  let z = ideal[0].z;
  let yaw = Math.atan2(ideal[1].x - x, ideal[1].z - z);
  let idealIdx = 1;
  const end = ideal[ideal.length - 1];
  const points: Vec3[] = [{ x, y: 0, z }];

  for (let guard = 0; guard < 5000; guard++) {
    const toEnd = Math.hypot(end.x - x, end.z - z);
    if (toEnd < PATH_POINT_SPACING_M * 1.1) break;

    // Advance pursuit target along ideal until look-ahead distance
    while (idealIdx < ideal.length - 1) {
      const d = Math.hypot(ideal[idealIdx].x - x, ideal[idealIdx].z - z);
      if (d < lookAhead * 0.65) idealIdx++;
      else break;
    }
    // Also skip if we've passed this ideal point (dot with path dir)
    while (idealIdx < ideal.length - 1) {
      const ix = ideal[idealIdx].x - x;
      const iz = ideal[idealIdx].z - z;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      if (ix * fx + iz * fz < -0.5 && Math.hypot(ix, iz) < lookAhead) {
        idealIdx++;
      } else break;
    }

    const target = ideal[idealIdx];
    const desired = Math.atan2(target.x - x, target.z - z);
    let delta = desired - yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    // Tiny noise only — shape comes from waypoints
    delta = clamp(delta + (rng() - 0.5) * maxTurn * 0.12, -maxTurn, maxTurn);
    yaw += delta;

    x += Math.sin(yaw) * PATH_POINT_SPACING_M;
    z += Math.cos(yaw) * PATH_POINT_SPACING_M;
    x = clamp(x, -softBound, softBound);
    z = clamp(z, -softBound, softBound);
    points.push({ x, y: 0, z });

    if (points.length > 1000) break;
  }

  // Final approach to finish
  for (
    let k = 0;
    k < 100 && Math.hypot(end.x - x, end.z - z) > PATH_POINT_SPACING_M * 1.05;
    k++
  ) {
    const desired = Math.atan2(end.x - x, end.z - z);
    let delta = desired - yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    delta = clamp(delta, -maxTurn, maxTurn);
    yaw += delta;
    x += Math.sin(yaw) * PATH_POINT_SPACING_M;
    z += Math.cos(yaw) * PATH_POINT_SPACING_M;
    x = clamp(x, -softBound, softBound);
    z = clamp(z, -softBound, softBound);
    points.push({ x, y: 0, z });
  }
  points.push({ x: end.x, y: 0, z: end.z });
  return points;
}

/**
 * XZ meander only. Heights are assigned later from the heightmap
 * (`fitPathToHeightmap`) so the ribbon does not invent a flat highway grade.
 */
export function generatePathPolyline(
  rng: () => number,
  mapSize: number,
  vehicle: VehicleCapabilities,
): { points: Vec3[]; startYaw: number; endYaw: number } {
  const m = START_FINISH_EDGE_MARGIN_M;
  const half = mapSize / 2;
  const bound = half - m;

  const start = {
    x: -half + m,
    y: 0,
    z: (rng() * 2 - 1) * bound * 0.9,
  };
  const end = {
    x: half - m,
    y: 0,
    // Force finish Z away from start so chord is not a pure E-W strip
    z: clamp(
      -start.z * (0.35 + rng() * 0.4) + (rng() - 0.5) * bound * 0.5,
      -bound * 0.9,
      bound * 0.9,
    ),
  };

  const controls = buildMeanderControls(rng, start, end, bound);
  const ideal = densifyControls(controls, PATH_POINT_SPACING_M * 0.75);
  const points = pursuePolyline(ideal, rng, mapSize, vehicle);

  const startYaw = Math.atan2(
    points[1].x - points[0].x,
    points[1].z - points[0].z,
  );
  const n = points.length;
  const endYaw = Math.atan2(
    points[n - 1].x - points[n - 2].x,
    points[n - 1].z - points[n - 2].z,
  );
  return { points, startYaw, endYaw };
}

/** Chord length vs path length — >1 means winding. */
export function pathSinuosity(points: Vec3[]): number {
  if (points.length < 2) return 1;
  const chord = Math.hypot(
    points[points.length - 1].x - points[0].x,
    points[points.length - 1].z - points[0].z,
  );
  const len = pathLengthXZ(points);
  if (chord < 1e-3) return len > 0 ? Infinity : 1;
  return len / chord;
}

export function pathHeightRange(points: Vec3[]): number {
  if (points.length === 0) return 0;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (const p of points) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return maxY - minY;
}

/** Lateral span in Z — large values mean real bends, not a straight strip. */
export function pathLateralSpan(points: Vec3[]): number {
  if (points.length === 0) return 0;
  let minZ = points[0].z;
  let maxZ = points[0].z;
  for (const p of points) {
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return maxZ - minZ;
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
  // Mild S-curve even in fallback so checkpoints are never a dead-straight strip
  const latAmp = Math.min(28, half * 0.22);
  for (let x = startX; x <= endX; x += PATH_POINT_SPACING_M) {
    const t = (x - startX) / (endX - startX || 1);
    const y = 10 + Math.sin(t * Math.PI) * 2.5;
    const z = Math.sin(t * Math.PI * 2) * latAmp;
    points.push({ x, y, z });
  }
  if (points.length === 0 || points[points.length - 1].x < endX - 1e-3) {
    points.push({ x: endX, y: 10, z: 0 });
  }
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
