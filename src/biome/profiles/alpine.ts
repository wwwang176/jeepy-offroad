import type { BiomeProfile } from "../types";

/** Cold alpine pass — residual snow, bare rock, long high→low descent. */
export const alpineBiome: BiomeProfile = {
  id: "alpine",
  /** Canonical EN; UI prefers i18n biomeDisplayName(). */
  displayName: "Alpine",
  description: "Residual snow, bare rock, long descents",
  skyColor: "#9aafc4",
  fogColor: "#c5d0dc",
  fogDensity: 0.02,
  groundPalette: {
    high: "#e8eef4",
    mid: "#9aa6b0",
    low: "#4a5560",
    path: "#d0d8e0",
  },
  waterColor: "#2a4a5c",
  /** Below pond band (≤0.15 → 0 ponds). */
  streamDensity: 0.12,
  offPathRoughness: 0.82,
  propDensity: 0.55,
  propCountScale: 8,
  /** Ice-grit slip; brakeScale also scales 4L 檔煞 (accepted coupling). */
  traction: {
    frictionSlipScale: 0.52,
    sideFrictionScale: 0.45,
    brakeScale: 0.75,
  },
  propTable: [
    { meshKey: "rock_pile", weight: 1, collides: true },
    { meshKey: "pillar_rock", weight: 0.75, collides: true },
  ],
  /** Start side higher than finish along path chord (W→E dump). */
  macroRelief: { startToFinishDropM: 32 },
};
