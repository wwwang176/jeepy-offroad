import type { BiomeId } from "@/shared/types";

export interface PropSpawnRule {
  meshKey: string;
  weight: number;
  collides: boolean;
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
  /**
   * Multiplier on decorative prop count (default 1).
   * Rainforest uses >1 for dense palm groves.
   */
  propCountScale?: number;
  /**
   * Extra low ground-cover pass (short grass clumps via InstancedMesh).
   * Count ≈ (20 + density×40) × this scale. Omit / 0 = none.
   */
  groundCoverCountScale?: number;
  pathWidth?: number;
  mapSize?: number;
}
