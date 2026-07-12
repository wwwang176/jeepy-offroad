import type { BiomeProfile } from "../types";

/**
 * Cold alpine pass — thick snow on high ground, grey schist base, long descent.
 *
 * Drop is sized so the drive path rides near continuous grade budget (~19°) for
 * most of the run (vehicle maxSlope 28°). True 40° continuous path is not
 * drivable under shared VehicleCapabilities; off-path valley walls still read steep.
 */
export const alpineBiome: BiomeProfile = {
  id: "alpine",
  /** Canonical EN; UI prefers i18n biomeDisplayName(). */
  displayName: "Alpine",
  description: "Residual snow, bare rock, long descents",
  skyColor: "#8fa8c0",
  fogColor: "#d0dbe6",
  fogDensity: 0.018,
  groundPalette: {
    // Thick snow (peaks + patches via alpineSnow mode)
    high: "#f4f8fc",
    // Grey schist mid slopes
    mid: "#6a727c",
    // Dark schist valley floor / shadows
    low: "#3a414a",
    // Packed dirty snow on the track
    path: "#c8d0d8",
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
   * Large W→E dump. Chord ~224 m → macro average ~atan(160/224)≈35°;
   * path grade-clamp keeps the ribbon drivable while net altitude loss stays huge.
   */
  macroRelief: { startToFinishDropM: 160 },
  terrainColorMode: "alpineSnow",
};
