import type { BiomeProfile } from "../types";

export const cliffsBiome: BiomeProfile = {
  id: "cliffs",
  displayName: "Cliffs",
  description: "Rocky ridges and sheer drops",
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
  propDensity: 0.25,
  propTable: [
    { meshKey: "rock_pile", weight: 1, collides: false },
    { meshKey: "scrub", weight: 1, collides: false },
    { meshKey: "pillar_rock", weight: 0.4, collides: false },
  ],
};
