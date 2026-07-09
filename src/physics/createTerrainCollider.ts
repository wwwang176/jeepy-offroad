import RAPIER from "@dimforge/rapier3d-compat";
import type { LevelData } from "@/levelgen/types";
import { heightfieldWorldCenter } from "@/shared/coords";

/**
 * Rapier heightfield expects column-major heights where columns map to +X and
 * rows map to +Z. Our LevelData heightmap is row-major: `row * resolution + col`.
 */
export function heightmapToRapierColumnMajor(
  heightmap: Float32Array,
  resolution: number,
): Float32Array {
  const out = new Float32Array(resolution * resolution);
  for (let row = 0; row < resolution; row++) {
    for (let col = 0; col < resolution; col++) {
      out[col * resolution + row] = heightmap[row * resolution + col];
    }
  }
  return out;
}

export function createTerrainCollider(
  world: RAPIER.World,
  level: LevelData,
): RAPIER.Collider {
  // nrows/ncols are cell counts; heights has (nrows+1)*(ncols+1) samples.
  const nrows = level.resolution - 1;
  const ncols = level.resolution - 1;
  const heights = heightmapToRapierColumnMajor(
    level.heightmap,
    level.resolution,
  );
  const scale = { x: level.worldSize, y: 1, z: level.worldSize };
  const desc = RAPIER.ColliderDesc.heightfield(
    nrows,
    ncols,
    heights,
    scale,
    RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES,
  );
  const c = heightfieldWorldCenter();
  desc.setTranslation(c.x, c.y, c.z);
  desc.setFriction(0.9);
  desc.setRestitution(0);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  return world.createCollider(desc, body);
}
