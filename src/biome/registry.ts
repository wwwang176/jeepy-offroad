import type { BiomeId } from "@/shared/types";
import type { BiomeProfile } from "./types";
import { cliffsBiome } from "./profiles/cliffs";

const REGISTRY: Record<string, BiomeProfile> = {
  [cliffsBiome.id]: cliffsBiome,
};

export function listBiomes(): BiomeProfile[] {
  return Object.values(REGISTRY);
}

export function getBiome(id: BiomeId): BiomeProfile {
  const b = REGISTRY[id];
  if (!b) throw new Error(`Unknown biome: ${id}`);
  return b;
}
