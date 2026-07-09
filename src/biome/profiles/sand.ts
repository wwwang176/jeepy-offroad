import type { BiomeProfile } from "../types";

/** Arid sand / rocky terrain — former "cliffs" look, renamed 沙地. */
export const sandBiome: BiomeProfile = {
  id: "sand",
  displayName: "沙地",
  description: "乾燥岩脊、仙人掌與沙褐土徑",
  skyColor: "#87a0b5",
  fogColor: "#c4b8a8",
  fogDensity: 0.012,
  groundPalette: {
    high: "#8a8680",
    mid: "#a89880",
    low: "#5c5348",
    path: "#b8a990",
  },
  waterColor: "#4a7a8c",
  streamDensity: 0.35,
  offPathRoughness: 0.85,
  /** Whole map skate-slippery; rainforest leaves traction unset (= baseline). */
  traction: {
    frictionSlipScale: 0.48,
    sideFrictionScale: 0.4,
    brakeScale: 0.75,
  },
  propDensity: 0.45,
  /** Rocks/pillars budget (×2 again; cactus comes from ensureProps). */
  propCountScale: 8,
  propTable: [
    // Low weight so the scaled pass is mostly stone; cactus filled by ensure.
    { meshKey: "cactus", weight: 0.2, collides: false },
    { meshKey: "rock_pile", weight: 1, collides: false },
    { meshKey: "pillar_rock", weight: 0.4, collides: false },
  ],
  /** ~100 saguaros (×2 vs previous 50). */
  ensureProps: [{ meshKey: "cactus", count: 100 }],
};
