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
  pathWidth?: number;
  mapSize?: number;
}
