import * as THREE from "three";
import type { LevelData } from "@/levelgen/types";
import type { BiomeProfile } from "@/biome/types";
import { createTerrainMesh } from "./TerrainMesh";
import { createJeepMesh, syncJeepMesh } from "./JeepMesh";

export type GameSceneHandles = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  jeepMesh: THREE.Group;
  terrainMesh: THREE.Mesh;
  finishMesh: THREE.Mesh;
  dispose: () => void;
};

function hexToNumber(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}

/**
 * Build Three.js scene for a generated level: sky/fog, terrain, finish volume, jeep.
 */
export function createGameScene(
  canvas: HTMLCanvasElement,
  level: LevelData,
  biome: BiomeProfile,
): GameSceneHandles {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(hexToNumber(biome.skyColor));
  scene.fog = new THREE.FogExp2(
    hexToNumber(biome.fogColor),
    biome.fogDensity,
  );

  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    Math.max(800, level.worldSize * 2),
  );
  camera.position.set(
    level.start.position.x,
    level.start.position.y + 5,
    level.start.position.z - 10,
  );

  const hemi = new THREE.HemisphereLight(0xffffff, 0x445544, 0.95);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.85);
  dir.position.set(40, 80, 20);
  scene.add(dir);

  const terrainMesh = createTerrainMesh(level, biome);
  scene.add(terrainMesh);

  const finish = level.finish;
  const finishGeo = new THREE.BoxGeometry(
    finish.halfExtents.x * 2,
    finish.halfExtents.y * 2,
    finish.halfExtents.z * 2,
  );
  const finishMat = new THREE.MeshLambertMaterial({
    color: 0x44ff88,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const finishMesh = new THREE.Mesh(finishGeo, finishMat);
  finishMesh.position.set(
    finish.position.x,
    finish.position.y,
    finish.position.z,
  );
  finishMesh.rotation.y = finish.yaw;
  scene.add(finishMesh);

  // Simple path markers (start pad)
  const startPad = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 2.5, 0.15, 16),
    new THREE.MeshLambertMaterial({ color: 0x66aaff }),
  );
  startPad.position.set(
    level.start.position.x,
    level.start.position.y + 0.05,
    level.start.position.z,
  );
  scene.add(startPad);

  const jeepMesh = createJeepMesh();
  scene.add(jeepMesh);

  const onResize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  };
  window.addEventListener("resize", onResize);

  return {
    scene,
    camera,
    renderer,
    jeepMesh,
    terrainMesh,
    finishMesh,
    dispose: () => {
      window.removeEventListener("resize", onResize);
      terrainMesh.geometry.dispose();
      (terrainMesh.material as THREE.Material).dispose();
      finishGeo.dispose();
      finishMat.dispose();
      startPad.geometry.dispose();
      (startPad.material as THREE.Material).dispose();
      renderer.dispose();
    },
  };
}

export function updateChaseCamera(
  camera: THREE.PerspectiveCamera,
  pose: {
    position: { x: number; y: number; z: number };
    yaw: number;
  },
): void {
  const yaw = pose.yaw;
  camera.position.set(
    pose.position.x - Math.sin(yaw) * 10,
    pose.position.y + 4,
    pose.position.z - Math.cos(yaw) * 10,
  );
  camera.lookAt(
    pose.position.x,
    pose.position.y + 1.2,
    pose.position.z,
  );
}

export { syncJeepMesh };
