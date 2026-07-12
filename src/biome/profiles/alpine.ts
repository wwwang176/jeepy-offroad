import type { BiomeProfile } from "../types";

/**
 * Cold alpine pass — grey schist ground + draped snow blankets (no collision),
 * long high→low descent.
 */
export const alpineBiome: BiomeProfile = {
  id: "alpine",
  /** Canonical EN; UI prefers i18n biomeDisplayName(). */
  displayName: "Alpine",
  description: "Residual snow, bare rock, long descents",
  skyColor: "#8fa8c0",
  fogColor: "#d0dbe6",
  fogDensity: 0.018,
  /** Rock only — snow is a separate draped mesh (snowCover). */
  groundPalette: {
    high: "#8a929c",
    mid: "#5c646e",
    low: "#3a414a",
    path: "#6a727c",
  },
  waterColor: "#2a4a5c",
  /** Below pond band (≤0.15 → 0 ponds). */
  streamDensity: 0.12,
  /** Strong off-path relief for steep valley sides. */
  offPathRoughness: 0.9,
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
  /**
   * Large W→E dump. Path grade-clamp keeps the ribbon drivable while
   * net altitude loss stays huge.
   */
  macroRelief: { startToFinishDropM: 160 },
  /**
   * Thick snow on high rock + residual mid-slope patches.
   * Mesh drapes heightmap + lift; no Rapier collider (same idea as ponds).
   */
  snowCover: {
    color: "#f2f7fc",
    liftM: 0.16,
    thickLineT: 0.48,
    patchMinT: 0.22,
    patchNoiseThreshold: 0.52,
    thickBlend: 0.12,
    clearPath: true,
    opacity: 0.96,
  },
};
