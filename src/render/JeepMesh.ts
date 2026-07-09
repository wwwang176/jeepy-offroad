import * as THREE from "three";
import { VEHICLE_CONFIG } from "@/shared/vehicleConfig";

export type WheelVisualState = {
  /** Current suspension length along ray (hardpoint → ground contact). */
  suspensionLength: number;
  /** Spin about axle (radians). */
  rotation: number;
  /** Steer angle (radians). */
  steering: number;
};

export type JeepMeshHandles = {
  root: THREE.Group;
  wheels: THREE.Group[];
};

/**
 * Low-poly jeep: chassis + 4 wheels parented for suspension/steer/spin updates.
 */
export function createJeepMesh(): THREE.Group {
  const g = new THREE.Group();
  g.name = "jeep";
  const he = VEHICLE_CONFIG.chassisHalfExtents;

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(he.x * 2, he.y * 2, he.z * 2),
    new THREE.MeshLambertMaterial({ color: 0xc45c26 }),
  );
  body.name = "chassis";
  g.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(he.x * 1.6, he.y * 1.2, he.z * 0.9),
    new THREE.MeshLambertMaterial({ color: 0x333333 }),
  );
  cabin.name = "cabin";
  cabin.position.set(0, he.y * 1.2, -he.z * 0.1);
  g.add(cabin);

  const r = VEHICLE_CONFIG.wheelRadius;
  const rest = VEHICLE_CONFIG.suspRestLength;
  VEHICLE_CONFIG.wheelPositions.forEach((w, i) => {
    // Pivot at hardpoint (suspension attach); wheel mesh offset along -Y
    const pivot = new THREE.Group();
    pivot.name = `wheel-pivot-${i}`;
    pivot.userData.wheelIndex = i;
    pivot.userData.hardpoint = { x: w.x, y: w.y, z: w.z };
    pivot.position.set(w.x, w.y, w.z);

    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, 0.28, 12),
      new THREE.MeshLambertMaterial({ color: 0x222222 }),
    );
    wheel.name = `wheel-mesh-${i}`;
    // Cylinder default axis is Y; align to axle X
    wheel.rotation.z = Math.PI / 2;
    // At rest: contact = rest length down; center is radius above contact
    wheel.position.set(0, -(rest - r), 0);
    pivot.add(wheel);
    g.add(pivot);
  });

  return g;
}

function getWheelPivots(mesh: THREE.Group): THREE.Group[] {
  const pivots: THREE.Group[] = [];
  for (const child of mesh.children) {
    if (child.name.startsWith("wheel-pivot-")) {
      pivots.push(child as THREE.Group);
    }
  }
  pivots.sort(
    (a, b) =>
      (a.userData.wheelIndex as number) - (b.userData.wheelIndex as number),
  );
  return pivots;
}

/**
 * Sync chassis pose and optional per-wheel suspension / steer / spin.
 */
export function syncJeepMesh(
  mesh: THREE.Group,
  pose: {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
  },
  wheels?: readonly WheelVisualState[],
): void {
  mesh.position.set(pose.position.x, pose.position.y, pose.position.z);
  mesh.quaternion.set(
    pose.rotation.x,
    pose.rotation.y,
    pose.rotation.z,
    pose.rotation.w,
  );

  if (!wheels || wheels.length === 0) return;

  const r = VEHICLE_CONFIG.wheelRadius;
  const rest = VEHICLE_CONFIG.suspRestLength;
  const pivots = getWheelPivots(mesh);

  for (let i = 0; i < pivots.length; i++) {
    const pivot = pivots[i];
    const hard = pivot.userData.hardpoint as {
      x: number;
      y: number;
      z: number;
    };
    // Keep hardpoint fixed in chassis space
    pivot.position.set(hard.x, hard.y, hard.z);

    const state = wheels[i];
    const suspLen =
      state && Number.isFinite(state.suspensionLength)
        ? state.suspensionLength
        : rest;
    // Direction is chassis -Y: wheel center = hardpoint + dir * (length - radius)
    const wheelMesh = pivot.children[0] as THREE.Mesh | undefined;
    if (wheelMesh) {
      wheelMesh.position.set(0, -(suspLen - r), 0);
      // Spin about local axle (mesh local X after z-rot of cylinder ≈ world axle)
      // Apply spin as rotation.x on the cylinder (axis after z=90° is local X)
      const spin = state?.rotation ?? 0;
      const steer = state?.steering ?? 0;
      // Pivot yaws for steering; wheel mesh spins on its axle
      pivot.rotation.y = steer;
      wheelMesh.rotation.z = Math.PI / 2;
      wheelMesh.rotation.x = spin;
    }
  }
}
