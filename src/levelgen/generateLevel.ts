import type { BiomeProfile } from "@/biome/types";
import type { Vec3 } from "@/shared/types";
import type { VehicleCapabilities } from "@/shared/vehicleCapabilities";
import { gridToWorld, idx } from "@/shared/coords";
import { createHeightmap, flattenDiskWithFalloff, sampleBilinear } from "./heightmap";
import {
  fallbackPath,
  fitPathToHeightmap,
  generatePathPolyline,
} from "./path";
import { conditionTerrainFromBase } from "./repair";
import { mulberry32 } from "./rng";
import {
  CHECKPOINT_SPACING_M,
  DEFAULT_MAP_SIZE,
  DEFAULT_RESOLUTION,
  type GenerateLevelInput,
  type LevelData,
  type PondBody,
  type StreamReach,
} from "./types";
import { applyMacroRelief } from "./macroRelief";
import { placePonds } from "./ponds";

/** Start pad flat radius (m) — covers rect ring + vehicle footprint. */
const START_FLAT_RADIUS_M = 6;
/** Finish pad flat radius (m). */
const FINISH_FLAT_RADIUS_M = 5.5;
/** Smooth blend from pad to surrounding terrain (m). */
const PAD_FALLOFF_M = 2.5;

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

export type CarveResult = {
  heightmap: Float32Array;
  /** Immutable pre-path FBM (path Y + terrain deltas always vs this). */
  baseHeightmap: Float32Array;
  /** Path with heights fitted to base terrain (grade-limited). */
  path: Vec3[];
};

/**
 * Build base FBM → fit path to base only → one absolute path-band condition
 * (lifetime fill/cut vs base) → place ponds. No multi-pass ratchet nudge.
 */
export function carveAndDecorate(
  pathXZ: Vec3[],
  mapSize: number,
  resolution: number,
  biome: BiomeProfile,
  rng: () => number,
  vehicle: VehicleCapabilities,
  isFallback: boolean,
): CarveResult {
  const hm = createHeightmap(resolution, 10);
  const halfW = ribbonWidth(biome, vehicle) / 2;

  // Base terrain — moderate relief (not canyon-scale)
  const nSeed = (rng() * 1e9) | 0;
  const roughness = isFallback
    ? biome.offPathRoughness * 0.25
    : biome.offPathRoughness;
  // sand@0.85 → amp ≈ 38–40 m bulk (another +100%), plus milder ridges
  const amp = 12.8 + roughness * 30;
  const ridgeAmp = amp * 0.4 * roughness;

  for (let r = 0; r < resolution; r++) {
    for (let c = 0; c < resolution; c++) {
      const { x, z } = gridToWorld(c, r, mapSize, resolution);
      const bulk = fbm(x * 0.014, z * 0.014, nSeed);
      const mid = fbm(x * 0.03, z * 0.03, nSeed + 11);
      const ridge = Math.abs(fbm(x * 0.02 + 20, z * 0.02, nSeed + 3) * 2 - 1);
      hm[idx(resolution, c, r)] =
        10 + bulk * amp + mid * amp * 0.3 + ridge * ridgeAmp;
    }
  }

  // Alpine (etc.): planar high→low along path chord before base snapshot
  if (biome.macroRelief && !isFallback && pathXZ.length >= 2) {
    applyMacroRelief(
      hm,
      resolution,
      mapSize,
      pathXZ[0]!,
      pathXZ[pathXZ.length - 1]!,
      biome.macroRelief,
    );
  }

  // Immutable base — all path fitting / conditioning is vs this snapshot
  const baseHeightmap = new Float32Array(hm);

  // Design path Y from base only (conditioning target)
  const pathDesign = fitPathToHeightmap(
    pathXZ,
    baseHeightmap,
    resolution,
    mapSize,
    vehicle,
  );
  // Single absolute condition: hm = base + clamp(pathY - base, ±caps) × falloff
  conditionTerrainFromBase(
    hm,
    baseHeightmap,
    resolution,
    mapSize,
    pathDesign,
  );

  // Pond-only hydrology (no rivers): rim surfaceY → carve → wet shore polygon
  const density = isFallback
    ? biome.streamDensity * 0.15
    : biome.streamDensity;
  // Pond density by biome band: rainforest heavy, sand lighter
  // high (e.g. rainforest 0.55): 200 | mid (e.g. sand 0.35): 25
  const pondCount = density > 0.5 ? 200 : density > 0.15 ? 25 : 0;
  const hydro = placePonds(
    hm,
    resolution,
    mapSize,
    pathDesign,
    halfW,
    pondCount,
    rng,
  );

  // Play path: grade on *conditioned* surface so validate centerline matches ground
  const path = fitPathToHeightmap(
    pathDesign,
    hm,
    resolution,
    mapSize,
    vehicle,
  );

  hydrologyCache.set(hm, hydro);
  rng();
  rng();

  return { heightmap: hm, baseHeightmap, path };
}

const hydrologyCache = new WeakMap<
  Float32Array,
  { streams: StreamReach[]; ponds: PondBody[] }
>();

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
  baseHeightmap?: Float32Array,
): LevelData {
  // Keep fitted path Y (base-sampled + grade-limited). Do NOT lift from the
  // heightmap here — that reintroduces undrivable slopes. Fords dig below path
  // grade; validator measures pathCenterY − bed.
  const points = path.points.map((p) => ({ ...p }));

  const startPos = {
    x: points[0].x,
    y: points[0].y,
    z: points[0].z,
  };
  const end = points[points.length - 1];
  const finishPos = { x: end.x, y: end.y, z: end.z };

  // Flatten spawn / finish pads so markers sit on level ground (physics + mesh).
  flattenDiskWithFalloff(
    heightmap,
    resolution,
    mapSize,
    startPos,
    START_FLAT_RADIUS_M,
    PAD_FALLOFF_M,
    startPos.y,
  );
  flattenDiskWithFalloff(
    heightmap,
    resolution,
    mapSize,
    finishPos,
    FINISH_FLAT_RADIUS_M,
    PAD_FALLOFF_M,
    finishPos.y,
  );
  startPos.y = sampleBilinear(
    heightmap,
    resolution,
    mapSize,
    startPos.x,
    startPos.z,
  );
  finishPos.y = sampleBilinear(
    heightmap,
    resolution,
    mapSize,
    finishPos.x,
    finishPos.z,
  );
  // Keep path polyline Y consistent on the pads (minimap / debug).
  for (const p of points) {
    const ds = Math.hypot(p.x - startPos.x, p.z - startPos.z);
    if (ds <= START_FLAT_RADIUS_M) p.y = startPos.y;
    const df = Math.hypot(p.x - finishPos.x, p.z - finishPos.z);
    if (df <= FINISH_FLAT_RADIUS_M) p.y = finishPos.y;
  }

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

  const hydro = hydrologyCache.get(heightmap) ?? { streams: [], ponds: [] };
  const base = baseHeightmap ?? new Float32Array(heightmap);

  return {
    seed: input.seed >>> 0,
    biomeId: input.biome.id,
    heightmap,
    baseHeightmap: base,
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
    streams: hydro.streams.map((s) => ({
      ...s,
      polyline: s.polyline.map((p) => ({ ...p })),
      samples: s.samples.map((sm) => ({ ...sm })),
      connections: s.connections.map((c) => ({ ...c })),
    })),
    ponds: hydro.ponds.map((p) => ({
      ...p,
      center: { ...p.center },
      polygon: p.polygon?.map((q) => ({ ...q })),
      connections: p.connections.map((c) => ({ ...c })),
    })),
    killY: minH - 20,
    meta: {
      usedFallback,
      repairAttempts,
    },
  };
}

/**
 * Build a playable level: meander path + base FBM + single ±cap path condition
 * + optional ponds. No GeometricSolvability gate, repair loop, or hard
 * corridor fallback — offroad routes stay soft berms even on high relief.
 */
export function generateLevel(input: GenerateLevelInput): LevelData {
  const seed = input.seed >>> 0;
  const mapSize = input.mapSize ?? input.biome.mapSize ?? DEFAULT_MAP_SIZE;
  const resolution = input.resolution ?? DEFAULT_RESOLUTION;
  const vehicle = input.vehicle;
  const rng = mulberry32(seed);

  const pathXZ = generatePathPolyline(rng, mapSize, vehicle);
  const carved = carveAndDecorate(
    pathXZ.points,
    mapSize,
    resolution,
    input.biome,
    rng,
    vehicle,
    false,
  );
  return buildLevelData(
    { ...input, seed },
    mapSize,
    resolution,
    {
      points: carved.path,
      startYaw: pathXZ.startYaw,
      endYaw: pathXZ.endYaw,
    },
    carved.heightmap,
    false,
    0,
    carved.baseHeightmap,
  );
}

/**
 * Test/helper: same pipeline with milder terrain (isFallback carve) and
 * meta.usedFallback=true. No validate/repair — only flags the mode.
 */
export function forceFallbackLevel(
  input: GenerateLevelInput,
  repairAttempts = 0,
): LevelData {
  const seed = input.seed >>> 0;
  const mapSize = input.mapSize ?? input.biome.mapSize ?? DEFAULT_MAP_SIZE;
  const resolution = input.resolution ?? DEFAULT_RESOLUTION;
  const rng = mulberry32(seed ^ 0xf011);
  const pathFb = fallbackPath(mapSize, input.vehicle);
  const carved = carveAndDecorate(
    pathFb.points,
    mapSize,
    resolution,
    input.biome,
    rng,
    input.vehicle,
    true,
  );
  return buildLevelData(
    { ...input, seed },
    mapSize,
    resolution,
    {
      points: carved.path,
      startYaw: pathFb.startYaw,
      endYaw: pathFb.endYaw,
    },
    carved.heightmap,
    true,
    repairAttempts,
    carved.baseHeightmap,
  );
}

