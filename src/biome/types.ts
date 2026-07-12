import type { BiomeId } from "@/shared/types";
import type { SnowCoverConfig } from "@/shared/snowCover";

export interface PropSpawnRule {
  meshKey: string;
  weight: number;
  /**
   * When true, GameScene records a pose for fixed Rapier colliders.
   * Still drawn as a decorative mesh (not excluded from spawn).
   * rock_pile / pillar_rock use this across biomes.
   */
  collides: boolean;
}

/**
 * Multipliers on VEHICLE_CONFIG wheel grip (1 = baseline).
 * Sand uses low values for ice-skate feel; rainforest omits / stays 1.
 */
export interface BiomeTraction {
  /** Scales rapierFrictionSlip. */
  frictionSlipScale?: number;
  /** Scales rapierSideFrictionStiffness. */
  sideFrictionScale?: number;
  /** Optional scale on rapierBrakeScale (service brake). */
  brakeScale?: number;
}

/**
 * Macro height bias along the path chord (start high → finish low).
 * Applied to base terrain before path fit; omit for flat-biased biomes.
 */
export interface BiomeMacroRelief {
  /**
   * End-to-end height difference along start→finish chord (m).
   * Positive = start side higher than finish side (descent bias).
   */
  startToFinishDropM: number;
}

export interface BiomeProfile {
  id: BiomeId;
  displayName: string;
  description: string;
  skyColor: string;
  fogColor: string;
  fogDensity: number;
  groundPalette: { high: string; mid: string; low: string; path: string };
  waterColor: string;
  streamDensity: number;
  offPathRoughness: number;
  propDensity: number;
  propTable: PropSpawnRule[];
  /** Surface grip vs baseline vehicle config. */
  traction?: BiomeTraction;
  /**
   * Multiplier on decorative prop count (default 1).
   * Rainforest uses >1 for dense palm groves.
   */
  propCountScale?: number;
  /**
   * After the weighted pass, keep placing until each meshKey reaches `count`
   * (path/start/finish exclusions still apply). Used e.g. for sand cacti.
   */
  ensureProps?: readonly { meshKey: string; count: number }[];
  /**
   * Extra low ground-cover pass (short grass clumps via InstancedMesh).
   * Count ≈ (20 + density×40) × this scale. Omit / 0 = none.
   */
  groundCoverCountScale?: number;
  pathWidth?: number;
  mapSize?: number;
  /** Optional high→low macro ramp (alpine descent signature). */
  macroRelief?: BiomeMacroRelief;
  /**
   * Vertex/dust ground coloring mode (optional; default height blend).
   * Prefer rock-only palette + {@link snowCover} mesh for alpine snow.
   */
  terrainColorMode?: "default" | "alpineSnow";
  /**
   * Decorative snow blanket draped on the heightfield (like ponds: no collider).
   * Terrain mesh stays rock; snow is a separate lifted surface.
   */
  snowCover?: SnowCoverConfig;
  /**
   * Optional precipitation. Omit = none.
   * `density` scales particle counts (~1 = default for that kind).
   */
  weather?: { kind: "rain" | "snow"; density?: number };
  /**
   * Optional scene lights (hemi + key sun). Omit = GameScene defaults
   * (warm follow-sun for sand via arid path; neutral/green hemi otherwise).
   */
  lighting?: {
    hemiSky: string;
    hemiGround: string;
    hemiIntensity?: number;
    sunColor: string;
    sunIntensity?: number;
  };
  /**
   * Optional third-person spring-arm defaults (alpine downhill overview).
   * Radians for pitch (elevation from horizontal); meters for dist.
   */
  camera?: {
    thirdPitch?: number;
    thirdDist?: number;
  };
}
