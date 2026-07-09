import * as THREE from "three";
import { VEHICLE_CONFIG } from "@/shared/vehicleConfig";

export function createJeepMesh(): THREE.Group {
  const g = new THREE.Group();
  const he = VEHICLE_CONFIG.chassisHalfExtents;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(he.x * 2, he.y * 2, he.z * 2),
    new THREE.MeshLambertMaterial({ color: 0xc45c26 }),
  );
  g.add(body);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(he.x * 1.6, he.y * 1.2, he.z * 0.9),
    new THREE.MeshLambertMaterial({ color: 0x333333 }),
  );
  cabin.position.set(0, he.y * 1.2, -he.z * 0.1);
  g.add(cabin);
  for (const w of VEHICLE_CONFIG.wheelPositions) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 0.25, 10),
      new THREE.MeshLambertMaterial({ color: 0x222222 }),
    );
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(w.x, w.y - 0.35, w.z);
    g.add(wheel);
  }
  return g;
}

export function syncJeepMesh(
  mesh: THREE.Group,
  pose: {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
  },
): void {
  mesh.position.set(pose.position.x, pose.position.y, pose.position.z);
  mesh.quaternion.set(
    pose.rotation.x,
    pose.rotation.y,
    pose.rotation.z,
    pose.rotation.w,
  );
}
