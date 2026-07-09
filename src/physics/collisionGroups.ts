/**
 * Rapier interaction groups: high 16 bits = membership, low 16 bits = filter.
 * Vehicle rays must only hit terrain, never the chassis (self-hit → TOI 0 → rocket).
 */
export const COLLISION = {
  vehicle: 0x0001,
  terrain: 0x0002,
} as const;

export function interactionGroups(
  membership: number,
  filter: number,
): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

/** Chassis collides with terrain only. */
export const VEHICLE_COLLIDER_GROUPS = interactionGroups(
  COLLISION.vehicle,
  COLLISION.terrain,
);

/** Terrain collides with vehicle only. */
export const TERRAIN_COLLIDER_GROUPS = interactionGroups(
  COLLISION.terrain,
  COLLISION.vehicle,
);

/**
 * Ray query groups: membership unused for filter match in many builds;
 * filter bitmask = terrain so only terrain colliders are considered.
 */
export const SUSPENSION_RAY_GROUPS = interactionGroups(
  COLLISION.vehicle,
  COLLISION.terrain,
);
