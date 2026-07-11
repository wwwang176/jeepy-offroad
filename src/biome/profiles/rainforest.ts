import type { BiomeProfile } from "../types";

/** Dense tropical rainforest — green mud floor, many coconut palms. */
export const rainforestBiome: BiomeProfile = {
  id: "rainforest",
  displayName: "雨林",
  description: "潮濕綠泥、小雨與成片椰子樹",
  skyColor: "#6a8a78",
  fogColor: "#5a7060",
  fogDensity: 0.022,
  groundPalette: {
    // Wet forest floor (drives terrain + dust + tire tracks)
    high: "#3d5c38",
    mid: "#2f4a2c",
    low: "#1e3220",
    path: "#4a5c38",
  },
  waterColor: "#2a5a48",
  streamDensity: 0.55,
  offPathRoughness: 0.75,
  propDensity: 1,
  /** Extra prop budget so palms fill the map (merged batch draw). */
  propCountScale: 15,
  /** Short grass under the canopy (InstancedMesh, separate from palms). */
  groundCoverCountScale: 150,
  propTable: [
    { meshKey: "coconut_palm", weight: 10, collides: false },
    { meshKey: "jungle_bush", weight: 2, collides: false },
    // Same rock mesh/colliders as sand (sparse weight).
    { meshKey: "rock_pile", weight: 0.35, collides: true },
  ],
};
