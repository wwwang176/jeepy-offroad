import type { BiomeProfile } from "../types";

/**
 * Cold alpine pass — grey schist ground + soft rounded snow mounds (no collision),
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
  /** Rock only — snow is separate soft mounds (snowCover). */
  groundPalette: {
    high: "#5a626c",
    mid: "#3e4650",
    low: "#252b32",
    path: "#4a525c",
  },
  waterColor: "#2a4a5c",
  /** Below pond band (≤0.15 → 0 ponds). */
  streamDensity: 0.12,
  /** Strong off-path relief for steep valley sides. */
  offPathRoughness: 0.9,
  propDensity: 0.55,
  /** Rocks denser for alpine scree feel (baseline was 8). */
  propCountScale: 15,
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
  macroRelief: { startToFinishDropM: 160 },
  /**
   * Soft rounded snow piles on rock (pond-like sites, no collider).
   * Thick high-ground mounds + smaller mid-slope residual patches.
   */
  snowCover: {
    color: "#fbfcfe",
    peakThicknessM: 0.85,
    patchThicknessM: 0.38,
    thickRadiusMinM: 9,
    thickRadiusMaxM: 18,
    patchRadiusMinM: 3.5,
    patchRadiusMaxM: 8,
    thickCount: 28,
    patchCount: 40,
    thickLineT: 0.48,
    patchMinT: 0.22,
    /** Prefer off-road; ~12% of on-path candidates still accepted. */
    clearPath: true,
    pathSnowChance: 0.12,
    opacity: 0.98,
  },
};
