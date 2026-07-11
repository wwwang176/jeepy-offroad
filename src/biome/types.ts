import type { BiomeId } from "@/shared/types";

export interface PropSpawnRule {
  meshKey: string;
  weight: number;
  /**
   * When true, GameScene records a pose for fixed Rapier colliders.
   * Still drawn as a decorative mesh (not excluded from spawn).
   * rock_pile / pillar_rock use this across biomes.
   */
  collides: boolean;
}

/**
 * Multipliers on VEHICLE_CONFIG wheel grip (1 = baseline).
 * Sand uses low values for ice-skate feel; rainforest omits / stays 1.
 */
export interface BiomeTraction {
  /** Scales rapierFrictionSlip. */
  frictionSlipScale?: number;
  /** Scales rapierSideFrictionStiffness. */
  sideFrictionScale?: number;
  /** Optional scale on rapierBrakeScale (service brake). */
  brakeScale?: number;
}

export interface BiomeProfile {
  id: BiomeId;
  displayName: string;
  description: string;
  skyColor: string;
  fogColor: string;
  fogDensity: number;
  groundPalette: { high: string; mid: string; low: string; path: string };
  waterColor: string;
  streamDensity: number;
  offPathRoughness: number;
  propDensity: number;
  propTable: PropSpawnRule[];
  /** Surface grip vs baseline vehicle config. */
  traction?: BiomeTraction;
  /**
   * Multiplier on decorative prop count (default 1).
   * Rainforest uses >1 for dense palm groves.
   */
  propCountScale?: number;
  /**
   * After the weighted pass, keep placing until each meshKey reaches `count`
   * (path/start/finish exclusions still apply). Used e.g. for sand cacti.
   */
  ensureProps?: readonly { meshKey: string; count: number }[];
  /**
   * Extra low ground-cover pass (short grass clumps via InstancedMesh).
   * Count ≈ (20 + density×40) × this scale. Omit / 0 = none.
   */
  groundCoverCountScale?: number;
  pathWidth?: number;
  mapSize?: number;
}
