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
  /** Rock only — snow is separate soft mounds (snowCover). Lighter greys for linear mesh. */
  groundPalette: {
    high: "#6e7682",
    mid: "#525a66",
    low: "#3a424c",
    path: "#606870",
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
   * Thick high-ground mounds + residual patches down to valley floor.
   */
  snowCover: {
    color: "#ffffff",
    peakThicknessM: 0.85,
    patchThicknessM: 0.38,
    thickRadiusMinM: 9,
    thickRadiusMaxM: 18,
    patchRadiusMinM: 3.5,
    patchRadiusMaxM: 8,
    /** Scaled up with wider height bands so coverage stays dense. */
    thickCount: 44,
    patchCount: 52,
    /** Thick mounds from mid-low elevations up (t ≥ 0.2). */
    thickLineT: 0.2,
    /** Residual snow allowed from valley floor up into the thick band. */
    patchMinT: 0,
    /** Prefer off-road; ~12% of on-path candidates still accepted. */
    clearPath: true,
    pathSnowChance: 0.12,
    opacity: 1,
  },
  weather: { kind: "snow", density: 1 },
  /** Cold key + sky so white snow doesn't go cream under warm default sun. */
  lighting: {
    hemiSky: "#e8f0fa",
    hemiGround: "#3a4450",
    hemiIntensity: 0.78,
    sunColor: "#eef4ff",
    sunIntensity: 1.05,
  },
  /**
   * Higher chase cam for downhill — default is atan2(3.5,8)≈0.41;
   * alpine uses ~atan2(5.2,8) so more of the fall-line is visible.
   */
  camera: {
    thirdPitch: Math.atan2(5.2, 8),
    thirdDist: Math.hypot(8, 5.2),
  },
};
