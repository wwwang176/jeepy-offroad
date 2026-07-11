import type { BiomeId, Pose2D, Vec3 } from "@/shared/types";
import type { VehicleCapabilities } from "@/shared/vehicleCapabilities";
import type { BiomeProfile } from "@/biome/types";

export const PATH_POINT_SPACING_M = 4;
export const PATH_SAFETY_FACTOR = 0.75;
/**
 * Max ford depth on the drive path (m). Validator + ford carver share this.
 * Kept for backward-compatible name used by validate.
 */
export const STREAM_MAX_DEPTH_ON_PATH_M = 0.35;
export const CHECKPOINT_SPACING_M = 40;
export const START_FINISH_EDGE_MARGIN_M = 16;
export const DEFAULT_MAP_SIZE = 256;
/** Height samples per axis. Keep 2^n+1 so cell count is power-of-two (was 129 → 128×2m). */
export const DEFAULT_RESOLUTION = 257;
/**
 * Lifetime fill/cut vs immutable base terrain (m).
 * Absolute conditioning: hm = base + clamp(pathY - base, -cut, +fill).
 */
export const PATH_TERRAIN_MAX_DELTA_M = 3;
/** Max raise above base along path core (m). */
export const PATH_FILL_CAP_M = 3;
/** Max cut below base along path core (m). */
export const PATH_CUT_CAP_M = 3;
/** Full-strength conditioning radius (m). */
export const PATH_CORE_R_M = 7;
/** Outer falloff end (m); beyond this heightmap stays at base (pre-stream). */
export const PATH_OUTER_R_M = 13;

// ---------------------------------------------------------------------------
// Hydrology constants — levelgen owns these; render must not redefine them.
// ---------------------------------------------------------------------------

/** Target water column depth at channel center (m). */
export const STREAM_TARGET_DEPTH_M = 0.28;
/** Minimum acceptable water column after max-cut clamp (m). */
export const STREAM_MIN_DEPTH_M = 0.15;
/** Banks should sit at least this far above free surface (m), except fords. */
export const STREAM_BANK_CLEARANCE_M = 0.06;
/**
 * Max absolute cut below pre-stream surface at channel center (m).
 * Soft dig never exceeds this; prevents canyon pits.
 */
export const STREAM_MAX_CUT_M = 1.6;
/** Blend strength of soft dig toward desired bed (0..1 per pass). */
export const STREAM_SOFT_DIG_STRENGTH = 1;
/** Soft shoulder / bank blend width outside half-width (m). */
export const STREAM_BANK_BLEND_WIDTH_M = 1.8;
/** Sample spacing along stream centerline (m). */
export const STREAM_SAMPLE_STEP_M = 3;
/** Free-surface low-pass half-window (samples) for mostly-horizontal water. */
export const STREAM_SURFACE_SMOOTH_RADIUS = 4;
/** Max free-surface slope along flow (m/m); limits waterfall steps. */
export const STREAM_MAX_SURFACE_SLOPE = 0.08;

/** Default / mid pond basin depth below free surface (m). */
export const POND_TARGET_DEPTH_M = 0.55;
/** Shallow puddle / 水灘 min depth (m). */
export const POND_PUDDLE_DEPTH_MIN_M = 0.04;
/** Shallow puddle max depth (m). */
export const POND_PUDDLE_DEPTH_MAX_M = 0.14;
/** Deep pond max basin depth (m). */
export const POND_DEEP_DEPTH_MAX_M = 0.85;
/** Pond rim should sit at least this far above surface (m). */
export const POND_RIM_CLEARANCE_M = 0.08;
/** Max absolute cut for pond basin (m). */
export const POND_MAX_CUT_M = 2.2;
/** Default pond radius for mid/deep pools (m). */
export const POND_DEFAULT_RADIUS_M = 5.5;
/** Shallow puddle radius range (m). Includes sub-1 m micro-puddles. */
export const POND_PUDDLE_RADIUS_MIN_M = 0.45;
export const POND_PUDDLE_RADIUS_MAX_M = 2.8;
/** Mouth flare: stream width multiplies toward this factor at pond join. */
export const POND_MOUTH_WIDTH_FACTOR = 1.65;

/** Ford target water depth on path (m); capped by STREAM_MAX_DEPTH_ON_PATH_M. */
export const FORD_TARGET_DEPTH_M = 0.28;
/** Path half-width used when detecting path–stream intersections (extra). */
export const FORD_DETECT_EXTRA_M = 0.5;

export interface GenerateLevelInput {
  seed: number;
  biome: BiomeProfile;
  vehicle: VehicleCapabilities;
  mapSize?: number;
  resolution?: number;
}

export interface LevelData {
  seed: number;
  biomeId: BiomeId;
  heightmap: Float32Array;
  /**
   * Pre-path FBM snapshot (immutable for conditioning). Path Y and terrain
   * deltas are always computed against this — never against mutated hm.
   */
  baseHeightmap: Float32Array;
  resolution: number;
  worldSize: number;
  pathPolyline: Vec3[];
  start: Pose2D;
  finish: {
    position: Vec3;
    yaw: number;
    halfExtents: Vec3;
  };
  checkpoints: { id: string; position: Vec3; yaw: number; radius: number }[];
  /**
   * Stream/river reaches. Levelgen owns `samples[].surfaceY` — render must
   * consume it and must not re-derive water height from the heightmap.
   */
  streams: StreamReach[];
  /** Channel-end / depression ponds linked into the hydrology graph. */
  ponds: PondBody[];
  killY: number;
  meta: {
    usedFallback: boolean;
    repairAttempts: number;
  };
}

// ---------------------------------------------------------------------------
// Hydrology schema (levelgen-owned source of truth)
// ---------------------------------------------------------------------------

export type WaterKind = "stream" | "river" | "pond";

export interface WaterConnection {
  fromId: string;
  toId: string;
  kind: "inlet" | "outlet" | "continuation" | "ford";
}

/** One centerline station with bed/surface/width emitted by levelgen. */
export interface StreamSample {
  x: number;
  z: number;
  bedY: number;
  /** Free-surface elevation — single source of truth for water mesh Y. */
  surfaceY: number;
  width: number;
  depth: number;
  bankWidth: number;
}

export interface StreamReach {
  id: string;
  kind: "stream" | "river";
  /**
   * Centerline for wetness FX / path tests. Y is surfaceY at each vertex
   * (not terrain drape).
   */
  polyline: Vec3[];
  samples: StreamSample[];
  width: number;
  /** Carved ford depth on path (m); used by validate when present. */
  depthOnPath?: number;
  connections: WaterConnection[];
}

export interface PondBody {
  id: string;
  kind: "pond";
  center: { x: number; z: number };
  radius: number;
  /** Optional shore polygon in XZ (world). */
  polygon?: Array<{ x: number; z: number }>;
  surfaceY: number;
  bedY: number;
  rimY: number;
  connections: WaterConnection[];
}

export type WaterBody = StreamReach | PondBody;

export interface ValidationResult {
  ok: boolean;
  reasons: string[];
}
