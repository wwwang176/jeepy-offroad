import type { BiomeId } from "@/shared/types";
import type { BiomeProfile } from "./types";
import { alpineBiome } from "./profiles/alpine";
import { sandBiome } from "./profiles/sand";
import { rainforestBiome } from "./profiles/rainforest";

const REGISTRY: Record<string, BiomeProfile> = {
  [sandBiome.id]: sandBiome,
  [rainforestBiome.id]: rainforestBiome,
  [alpineBiome.id]: alpineBiome,
};

/**
 * Fixed modulus for packing biome into the seed number.
 * **Never lower this** after seeds are shared; only claim new indices.
 * New biomes append to {@link BIOME_SEED_ORDER} at the next free index.
 */
export const BIOME_SLOTS = 16;

/**
 * Stable seed-order indices (0..n-1). **Never reorder** — only append.
 * seed % BIOME_SLOTS → index (unassigned slots are reserved).
 */
const BIOME_SEED_ORDER: readonly BiomeId[] = [
  "sand", // 0
  "rainforest", // 1
  "alpine", // 2
  // 3..15 reserved for future biomes
];

/** Sentinel for menu "random biome" selection. */
export const RANDOM_BIOME_ID = "random" as const;

export type BiomeSelectId = BiomeId | typeof RANDOM_BIOME_ID;

export function listBiomes(): BiomeProfile[] {
  return Object.values(REGISTRY);
}

/** Biome ids in seed-index order (registered only). */
export function listBiomeSeedOrder(): readonly BiomeId[] {
  return BIOME_SEED_ORDER;
}

export function getBiome(id: BiomeId): BiomeProfile {
  const b = REGISTRY[id];
  if (!b) throw new Error(`Unknown biome: ${id}`);
  return b;
}

export function biomeSeedIndex(id: BiomeId): number {
  const i = BIOME_SEED_ORDER.indexOf(id);
  if (i < 0) throw new Error(`Biome has no seed slot: ${id}`);
  if (!REGISTRY[id]) throw new Error(`Unknown biome: ${id}`);
  return i;
}

/**
 * Decode biome from a packed seed (`seed % BIOME_SLOTS`).
 * Unassigned reserved slots fall back to sand until a biome claims them.
 */
export function biomeFromSeed(seed: number): BiomeId {
  const idx = (seed >>> 0) % BIOME_SLOTS;
  if (idx < BIOME_SEED_ORDER.length) {
    const id = BIOME_SEED_ORDER[idx]!;
    if (REGISTRY[id]) return id;
  }
  return BIOME_SEED_ORDER[0]!;
}

/**
 * Rewrite seed residue so `biomeFromSeed(result) === biomeId`,
 * keeping `floor(seed / BIOME_SLOTS)` (layout high bits) stable.
 */
export function embedBiomeInSeed(seed: number, biomeId: BiomeId): number {
  const i = biomeSeedIndex(biomeId);
  const s = seed >>> 0;
  return (Math.floor(s / BIOME_SLOTS) * BIOME_SLOTS + i) >>> 0;
}

/**
 * Resolve menu selection + seed → concrete biome and **packed** seed
 * (HUD / SEED replay always carry biome in the number).
 *
 * - Explicit biome: force residue to that biome's slot.
 * - Random + empty seed: fair pick among registered, then embed.
 * - Random + typed seed: decode biome from the number (shareable).
 */
export function resolveStart(
  selection: BiomeSelectId,
  seed: number,
  opts?: { seedWasEmpty?: boolean },
): { biomeId: BiomeId; seed: number } {
  const s0 = seed >>> 0;

  if (selection !== RANDOM_BIOME_ID) {
    if (!REGISTRY[selection]) {
      throw new Error(`Unknown biome: ${selection}`);
    }
    return {
      biomeId: selection,
      seed: embedBiomeInSeed(s0, selection),
    };
  }

  // Random terrain
  if (opts?.seedWasEmpty) {
    const n = BIOME_SEED_ORDER.length;
    if (n === 0) throw new Error("No biomes registered");
    const biomeId = BIOME_SEED_ORDER[s0 % n]!;
    return { biomeId, seed: embedBiomeInSeed(s0, biomeId) };
  }

  // Typed SEED / share code — biome is in the number
  const biomeId = biomeFromSeed(s0);
  // Re-embed so residue is a claimed slot (normalize reserved → sand, etc.)
  return { biomeId, seed: embedBiomeInSeed(s0, biomeId) };
}

/**
 * Resolve menu selection to a concrete biome.
 * Random uses packed seed (`% BIOME_SLOTS`); prefer {@link resolveStart} when packing.
 */
export function resolveBiomeId(
  selection: BiomeSelectId,
  seed: number,
): BiomeId {
  return resolveStart(selection, seed).biomeId;
}
