import type { BiomeProfile } from "@/biome/types";
import type { Vec3 } from "@/shared/types";
import type { VehicleCapabilities } from "@/shared/vehicleCapabilities";
import { cellSize, gridToWorld, idx } from "@/shared/coords";
import { createHeightmap, sampleBilinear } from "./heightmap";
import { fallbackPath, generatePathPolyline } from "./path";
import {
  flattenFallbackUntilValid,
  pathClosestY,
  pathDistXZ,
  repairHeightmap,
  resyncPathHeights,
  stampPathRibbon,
} from "./repair";
import { mulberry32 } from "./rng";
import {
  CHECKPOINT_SPACING_M,
  DEFAULT_MAP_SIZE,
  DEFAULT_RESOLUTION,
  MAX_REPAIR_ATTEMPTS,
  STREAM_MAX_DEPTH_ON_PATH_M,
  type GenerateLevelInput,
  type LevelData,
} from "./types";
import { validateLevel } from "./validate";

function ribbonWidth(biome: BiomeProfile, vehicle: VehicleCapabilities): number {
  return biome.pathWidth ?? vehicle.trackWidth + 2 * vehicle.pathClearance;
}

/** Value noise-ish hash for deterministic off-path height. */
function hashNoise(x: number, z: number, seed: number): number {
  let n = Math.imul(Math.floor(x * 12.9898 + z * 78.233 + seed * 0.1), 0x27d4eb2d);
  n = Math.imul(n ^ (n >>> 15), 1 | n);
  n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
  return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
}

function smoothNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const n00 = hashNoise(x0, z0, seed);
  const n10 = hashNoise(x0 + 1, z0, seed);
  const n01 = hashNoise(x0, z0 + 1, seed);
  const n11 = hashNoise(x0 + 1, z0 + 1, seed);
  const a = n00 * (1 - sx) + n10 * sx;
  const b = n01 * (1 - sx) + n11 * sx;
  return a * (1 - sz) + b * sz;
}

function fbm(x: number, z: number, seed: number): number {
  let v = 0;
  let a = 1;
  let f = 1;
  let sumA = 0;
  for (let o = 0; o < 4; o++) {
    v += smoothNoise(x * f, z * f, seed + o * 17) * a;
    sumA += a;
    a *= 0.5;
    f *= 2;
  }
  return v / sumA;
}

/**
 * Carve path ribbon into heightmap and add off-path decoration + streams.
 * Pure; deterministic given rng sequence.
 */
export function carveAndDecorate(
  path: Vec3[],
  mapSize: number,
  resolution: number,
  biome: BiomeProfile,
  rng: () => number,
  vehicle: VehicleCapabilities,
  isFallback: boolean,
): Float32Array {
  const hm = createHeightmap(resolution, 10);
  const halfW = ribbonWidth(biome, vehicle) / 2;
  // Slightly generous ribbon so support samples pass
  const carveHalf = halfW + cellSize(mapSize, resolution) * 0.75;

  // Base terrain from low-frequency noise (seeded via rng draws for determinism tie-in)
  const nSeed = (rng() * 1e9) | 0;
  const roughness = isFallback
    ? biome.offPathRoughness * 0.25
    : biome.offPathRoughness;
  const amp = 4 + roughness * 10;

  for (let r = 0; r < resolution; r++) {
    for (let c = 0; c < resolution; c++) {
      const { x, z } = gridToWorld(c, r, mapSize, resolution);
      const n = fbm(x * 0.02, z * 0.02, nSeed);
      // Ridges for cliffs feel
      const ridge = Math.abs(fbm(x * 0.01 + 20, z * 0.01, nSeed + 3) * 2 - 1);
      hm[idx(resolution, c, r)] =
        8 + n * amp + ridge * amp * 0.35 * roughness;
    }
  }

  // Carve smooth path ribbon from constrained path heights
  stampPathRibbon(hm, resolution, mapSize, path, carveHalf, 3);

  // Streams
  const streams: { polyline: Vec3[]; width: number }[] = [];
  const density = isFallback
    ? biome.streamDensity * 0.15
    : biome.streamDensity;
  // Place 0–2 streams based on density
  const streamCount = density > 0.5 ? 2 : density > 0.15 ? 1 : 0;
  for (let s = 0; s < streamCount; s++) {
    const poly = generateStreamPolyline(mapSize, path, rng, s);
    if (poly.length < 2) continue;
    const width = 2 + rng() * 2;
    // Carve shallow depression; keep path-crossing depth under limit
    carveStream(hm, resolution, mapSize, poly, width, path, halfW);
    streams.push({ polyline: poly, width });
  }

  // Re-stamp path ribbon so streams don't dig the road too deep
  stampPathRibbon(hm, resolution, mapSize, path, carveHalf, 2.5);

  // Attach streams on the heightmap object via side channel? Return only hm;
  // streams recorded in buildLevelData by re-running or storing externally.
  // Store on a weak map keyed by heightmap reference:
  streamCache.set(hm, streams);

  // Consume a few rng values for future expansion stability
  rng();
  rng();

  return hm;
}

const streamCache = new WeakMap<
  Float32Array,
  { polyline: Vec3[]; width: number }[]
>();

function generateStreamPolyline(
  mapSize: number,
  path: Vec3[],
  rng: () => number,
  salt: number,
): Vec3[] {
  const half = mapSize / 2;
  const margin = 20;
  // Stream roughly perpendicular to map mid, avoiding start/finish pads
  const z0 = (rng() * 2 - 1) * (half - margin);
  const yBase = 9 + rng() * 2;
  const points: Vec3[] = [];
  const step = 6;
  for (let x = -half + margin; x <= half - margin; x += step) {
    const zig = Math.sin((x + salt * 30) * 0.04) * 8 + (rng() - 0.5) * 3;
    const z = Math.max(-half + margin, Math.min(half - margin, z0 + zig));
    // Prefer not to create deep path cuts: lift stream Y near path
    const d = pathDistXZ(x, z, path);
    let y = yBase + (rng() - 0.5) * 1.5;
    if (d < 12) {
      y = pathClosestY(x, z, path) + STREAM_MAX_DEPTH_ON_PATH_M * 0.2;
    }
    points.push({ x, y, z });
  }
  return points;
}

function carveStream(
  hm: Float32Array,
  resolution: number,
  worldSize: number,
  poly: Vec3[],
  width: number,
  path: Vec3[],
  pathHalf: number,
): void {
  const half = width / 2;
  for (let r = 0; r < resolution; r++) {
    for (let c = 0; c < resolution; c++) {
      const { x, z } = gridToWorld(c, r, worldSize, resolution);
      const dStream = pathDistXZ(x, z, poly);
      if (dStream > half + 1.5) continue;
      const dPath = pathDistXZ(x, z, path);
      // On path ribbon: very shallow; off-path: deeper bed
      const maxDepth =
        dPath <= pathHalf + 1
          ? STREAM_MAX_DEPTH_ON_PATH_M * 0.5
          : 1.2 + (1 - Math.min(1, dPath / 20)) * 0.5;
      const fall = Math.max(0, 1 - dStream / (half + 1.5));
      const cut = maxDepth * fall * fall;
      const i = idx(resolution, c, r);
      hm[i] -= cut;
    }
  }
}

function pathLength(path: Vec3[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    len += Math.hypot(
      path[i].x - path[i - 1].x,
      path[i].z - path[i - 1].z,
    );
  }
  return len;
}

function pointAtArcLength(
  path: Vec3[],
  dist: number,
): { position: Vec3; yaw: number } {
  let remain = dist;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const seg = Math.hypot(b.x - a.x, b.z - a.z) || 1e-6;
    if (remain <= seg) {
      const t = remain / seg;
      return {
        position: {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          z: a.z + (b.z - a.z) * t,
        },
        yaw: Math.atan2(b.x - a.x, b.z - a.z),
      };
    }
    remain -= seg;
  }
  const n = path.length;
  const a = path[n - 2];
  const b = path[n - 1];
  return {
    position: { ...b },
    yaw: Math.atan2(b.x - a.x, b.z - a.z),
  };
}

export function buildLevelData(
  input: GenerateLevelInput,
  mapSize: number,
  resolution: number,
  path: { points: Vec3[]; startYaw: number; endYaw: number },
  heightmap: Float32Array,
  usedFallback: boolean,
  repairAttempts: number,
): LevelData {
  const points = path.points.map((p) => ({
    ...p,
    y: sampleBilinear(heightmap, resolution, mapSize, p.x, p.z),
  }));

  const startPos = {
    x: points[0].x,
    y: points[0].y,
    z: points[0].z,
  };
  const end = points[points.length - 1];
  const finishPos = { x: end.x, y: end.y, z: end.z };

  const totalLen = pathLength(points);
  const checkpoints: LevelData["checkpoints"] = [];
  let cpIndex = 0;
  for (
    let d = CHECKPOINT_SPACING_M;
    d < totalLen - CHECKPOINT_SPACING_M * 0.5;
    d += CHECKPOINT_SPACING_M
  ) {
    const { position, yaw } = pointAtArcLength(points, d);
    checkpoints.push({
      id: `cp_${cpIndex++}`,
      position,
      yaw,
      radius: 6,
    });
  }

  let minH = Infinity;
  for (let i = 0; i < heightmap.length; i++) {
    if (heightmap[i] < minH) minH = heightmap[i];
  }

  const streams = streamCache.get(heightmap) ?? [];

  return {
    seed: input.seed >>> 0,
    biomeId: input.biome.id,
    heightmap,
    resolution,
    worldSize: mapSize,
    pathPolyline: points,
    start: {
      position: startPos,
      yaw: path.startYaw,
    },
    finish: {
      position: finishPos,
      yaw: path.endYaw,
      halfExtents: { x: 4, y: 3, z: 4 },
    },
    checkpoints,
    streams: streams.map((s) => ({
      polyline: s.polyline.map((p) => ({ ...p })),
      width: s.width,
    })),
    killY: minH - 20,
    meta: {
      usedFallback,
      repairAttempts,
    },
  };
}

export function generateLevel(input: GenerateLevelInput): LevelData {
  const seed = input.seed >>> 0;
  const mapSize = input.mapSize ?? input.biome.mapSize ?? DEFAULT_MAP_SIZE;
  const resolution = input.resolution ?? DEFAULT_RESOLUTION;
  const vehicle = input.vehicle;
  const rng = mulberry32(seed);

  const path = generatePathPolyline(rng, mapSize, vehicle);
  let heightmap = carveAndDecorate(
    path.points,
    mapSize,
    resolution,
    input.biome,
    rng,
    vehicle,
    false,
  );
  let level = buildLevelData(
    { ...input, seed },
    mapSize,
    resolution,
    path,
    heightmap,
    false,
    0,
  );

  let attempts = 0;
  let v = validateLevel(level, vehicle);
  while (!v.ok && attempts < MAX_REPAIR_ATTEMPTS) {
    attempts++;
    heightmap = repairHeightmap(level, vehicle, attempts);
    // Preserve streams from previous level
    streamCache.set(heightmap, level.streams);
    level = resyncPathHeights({
      ...level,
      heightmap,
      meta: { usedFallback: false, repairAttempts: attempts },
    });
    // Re-stamp path ribbon more aggressively after repair
    const half =
      (vehicle.trackWidth + 2 * vehicle.pathClearance) / 2 +
      cellSize(mapSize, resolution) * attempts;
    stampPathRibbon(
      level.heightmap,
      resolution,
      mapSize,
      level.pathPolyline,
      half,
      3,
    );
    level = resyncPathHeights(level);
    v = validateLevel(level, vehicle);
  }

  if (!v.ok) {
    level = forceFallbackLevel({ ...input, seed }, attempts);
    v = validateLevel(level, vehicle);
    if (!v.ok) {
      level = flattenFallbackUntilValid(level, vehicle);
    }
  }
  return level;
}

/** Test/helper: build fallback corridor and validate before return. */
export function forceFallbackLevel(
  input: GenerateLevelInput,
  repairAttempts = 0,
): LevelData {
  const seed = input.seed >>> 0;
  const mapSize = input.mapSize ?? input.biome.mapSize ?? DEFAULT_MAP_SIZE;
  const resolution = input.resolution ?? DEFAULT_RESOLUTION;
  const rng = mulberry32(seed ^ 0xf011);
  const path = fallbackPath(mapSize, input.vehicle);
  const heightmap = carveAndDecorate(
    path.points,
    mapSize,
    resolution,
    input.biome,
    rng,
    input.vehicle,
    true,
  );
  let level = buildLevelData(
    { ...input, seed },
    mapSize,
    resolution,
    path,
    heightmap,
    true,
    repairAttempts,
  );
  let v = validateLevel(level, input.vehicle);
  if (!v.ok) {
    // Repair loop on fallback before flatten
    let attempts = 0;
    while (!v.ok && attempts < MAX_REPAIR_ATTEMPTS) {
      attempts++;
      const hm = repairHeightmap(level, input.vehicle, attempts);
      streamCache.set(hm, level.streams);
      level = resyncPathHeights({
        ...level,
        heightmap: hm,
        meta: {
          usedFallback: true,
          repairAttempts: repairAttempts + attempts,
        },
      });
      const half =
        (input.vehicle.trackWidth + 2 * input.vehicle.pathClearance) / 2 +
        cellSize(mapSize, resolution) * (attempts + 1);
      stampPathRibbon(
        level.heightmap,
        resolution,
        mapSize,
        level.pathPolyline,
        half,
        4,
      );
      level = resyncPathHeights(level);
      v = validateLevel(level, input.vehicle);
    }
  }
  if (!v.ok) {
    level = flattenFallbackUntilValid(level, input.vehicle);
  }
  // Ensure flag stays true
  if (!level.meta.usedFallback) {
    level = {
      ...level,
      meta: { ...level.meta, usedFallback: true },
    };
  }
  return level;
}

