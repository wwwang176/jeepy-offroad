import type { BiomeId, Pose2D, Vec3 } from "@/shared/types";
import type { VehicleCapabilities } from "@/shared/vehicleCapabilities";
import type { BiomeProfile } from "@/biome/types";

export const PATH_POINT_SPACING_M = 4;
export const PATH_SAFETY_FACTOR = 0.75;
export const STREAM_MAX_DEPTH_ON_PATH_M = 0.35;
export const CHECKPOINT_SPACING_M = 40;
export const START_FINISH_EDGE_MARGIN_M = 16;
export const MAX_REPAIR_ATTEMPTS = 8;
export const DEFAULT_MAP_SIZE = 256;
/** Height samples per axis. Keep 2^n+1 so cell count is power-of-two (was 129 → 128×2m). */
export const DEFAULT_RESOLUTION = 257;

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
  streams: {
    polyline: Vec3[];
    width: number;
    /** Carved ford depth on path (m); used by validate when present. */
    depthOnPath?: number;
  }[];
  killY: number;
  meta: {
    usedFallback: boolean;
    repairAttempts: number;
  };
}

export interface ValidationResult {
  ok: boolean;
  reasons: string[];
}
