import type { BiomeId } from "@/shared/types";
import type { BiomeProfile } from "./types";
import { sandBiome } from "./profiles/sand";
import { rainforestBiome } from "./profiles/rainforest";

const REGISTRY: Record<string, BiomeProfile> = {
  [sandBiome.id]: sandBiome,
  [rainforestBiome.id]: rainforestBiome,
};

/** Sentinel for menu "random biome" selection. */
export const RANDOM_BIOME_ID = "random" as const;

export type BiomeSelectId = BiomeId | typeof RANDOM_BIOME_ID;

export function listBiomes(): BiomeProfile[] {
  return Object.values(REGISTRY);
}

export function getBiome(id: BiomeId): BiomeProfile {
  const b = REGISTRY[id];
  if (!b) throw new Error(`Unknown biome: ${id}`);
  return b;
}

/**
 * Resolve menu selection to a concrete biome.
 * Random uses seed so the same seed always maps to the same biome.
 */
export function resolveBiomeId(
  selection: BiomeSelectId,
  seed: number,
): BiomeId {
  if (selection !== RANDOM_BIOME_ID) {
    if (!REGISTRY[selection]) {
      throw new Error(`Unknown biome: ${selection}`);
    }
    return selection;
  }
  const ids = Object.keys(REGISTRY);
  if (ids.length === 0) throw new Error("No biomes registered");
  const s = seed >>> 0;
  return ids[s % ids.length]!;
}
