import * as THREE from "three";
import { createFollowShadows } from "./followShadows";

export function createRenderer(canvas: HTMLCanvasElement): {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  updateShadows: (follow: { x: number; y: number; z: number }) => void;
} {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87a0b5);
  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    500,
  );
  camera.position.set(0, 5, -10);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
  scene.add(hemi);
  const shadows = createFollowShadows(scene, renderer, {
    radius: 40,
    mapSize: 1024,
  });
  shadows.update({ x: 0, y: 0, z: 0 });
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  });
  return {
    renderer,
    scene,
    camera,
    updateShadows: (follow) => shadows.update(follow),
  };
}
