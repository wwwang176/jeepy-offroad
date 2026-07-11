/**
 * Static colliders for decorative rock props (rock_pile / pillar_rock).
 * Approximate visual meshes so the jeep can bump / climb them.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { TERRAIN_COLLIDER_GROUPS } from "@/physics/collisionGroups";

/** Mesh keys that always get fixed colliders (all biomes). */
export const COLLIDABLE_ROCK_MESH_KEYS = new Set([
  "rock_pile",
  "pillar_rock",
]);

export function isCollidableRockMesh(meshKey: string): boolean {
  return COLLIDABLE_ROCK_MESH_KEYS.has(meshKey);
}

/**
 * World pose matching GameScene rock placement (Euler order YXZ, uniform scale).
 * Position is prop root on the terrain surface.
 */
export type RockPropPlacement = {
  meshKey: "rock_pile" | "pillar_rock";
  x: number;
  y: number;
  z: number;
  /** Radians; Object3D.rotation with order "YXZ". */
  rotX: number;
  rotY: number;
  rotZ: number;
  scale: number;
};

/** Local-space ball (rock pile stones). */
export type LocalBallSpec = {
  kind: "ball";
  radius: number;
  tx: number;
  ty: number;
  tz: number;
};

/** Local-space Y-axis cylinder (pillar). */
export type LocalCylinderSpec = {
  kind: "cylinder";
  halfHeight: number;
  radius: number;
  tx: number;
  ty: number;
  tz: number;
};

export type LocalColliderSpec = LocalBallSpec | LocalCylinderSpec;

/**
 * Visual rock_pile: 3 dodecahedra (r 0.7 / 0.5 / 0.4) with fixed offsets.
 * pillar_rock: tapered cylinder → constant r≈0.5, halfH 1.1, center y 1.1.
 */
export function localColliderSpecs(
  meshKey: RockPropPlacement["meshKey"],
  scale: number,
): LocalColliderSpec[] {
  const s = scale;
  if (meshKey === "rock_pile") {
    const sizes = [0.7, 0.5, 0.4] as const;
    const offsets = [
      [0, 0.25, 0],
      [0.35, 0.18, 0.15],
      [-0.3, 0.15, 0.2],
    ] as const;
    return sizes.map((r, i) => ({
      kind: "ball" as const,
      radius: r * s,
      tx: offsets[i][0] * s,
      ty: offsets[i][1] * s,
      tz: offsets[i][2] * s,
    }));
  }
  // pillar_rock mesh: CylinderGeometry(0.35, 0.55, 2.2) at y=1.1
  return [
    {
      kind: "cylinder",
      halfHeight: 1.1 * s,
      radius: 0.5 * s,
      tx: 0,
      ty: 1.1 * s,
      tz: 0,
    },
  ];
}

/**
 * Quaternion for Three.js Euler order "YXZ" (Y then X then Z).
 * q = qy * qx * qz
 */
export function quatFromEulerYXZ(
  rotX: number,
  rotY: number,
  rotZ: number,
): { x: number; y: number; z: number; w: number } {
  const hx = rotX * 0.5;
  const hy = rotY * 0.5;
  const hz = rotZ * 0.5;
  const cx = Math.cos(hx);
  const sx = Math.sin(hx);
  const cy = Math.cos(hy);
  const sy = Math.sin(hy);
  const cz = Math.cos(hz);
  const sz = Math.sin(hz);

  // qx, qy, qz
  const qx = { x: sx, y: 0, z: 0, w: cx };
  const qy = { x: 0, y: sy, z: 0, w: cy };
  const qz = { x: 0, y: 0, z: sz, w: cz };

  // qy * qx
  const yx = mulQuat(qy, qx);
  return mulQuat(yx, qz);
}

function mulQuat(
  a: { x: number; y: number; z: number; w: number },
  b: { x: number; y: number; z: number; w: number },
): { x: number; y: number; z: number; w: number } {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function applyColliderDesc(spec: LocalColliderSpec): RAPIER.ColliderDesc {
  const desc =
    spec.kind === "ball"
      ? RAPIER.ColliderDesc.ball(spec.radius)
      : RAPIER.ColliderDesc.cylinder(spec.halfHeight, spec.radius);
  desc.setTranslation(spec.tx, spec.ty, spec.tz);
  desc.setFriction(0.9);
  desc.setRestitution(0);
  desc.setCollisionGroups(TERRAIN_COLLIDER_GROUPS);
  desc.setSolverGroups(TERRAIN_COLLIDER_GROUPS);
  return desc;
}

/**
 * One fixed rigid body per rock prop; compound balls for piles, cylinder for pillars.
 * Uses terrain collision groups so chassis + suspension rays hit them.
 */
export function createPropColliders(
  world: RAPIER.World,
  placements: readonly RockPropPlacement[],
): number {
  let count = 0;
  for (const p of placements) {
    const rot = quatFromEulerYXZ(p.rotX, p.rotY, p.rotZ);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(p.x, p.y, p.z)
        .setRotation(rot),
    );
    for (const spec of localColliderSpecs(p.meshKey, p.scale)) {
      world.createCollider(applyColliderDesc(spec), body);
      count++;
    }
  }
  return count;
}
