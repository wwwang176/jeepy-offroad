import * as THREE from "three";

export type FollowShadowHandles = {
  light: THREE.DirectionalLight;
  /** Move the shadow cascade to track a world point (camera or vehicle). */
  update: (follow: { x: number; y: number; z: number }) => void;
  dispose: () => void;
};

export type FollowShadowOptions = {
  /** Orthographic half-extent of the shadow frustum (meters). Default 48. */
  radius?: number;
  /** Shadow map resolution. Default 1024. */
  mapSize?: number;
  /** Light direction (will be normalized). */
  direction?: THREE.Vector3;
  /** Directional light intensity. Default 1. */
  intensity?: number;
  /** Light color (hex). Default warm sun 0xfff0dd. */
  color?: number;
};

/**
 * Cheap open-world shadows: a directional light whose orthographic shadow
 * camera is recentered every frame around the camera / vehicle, so only a
 * local patch is shadowed instead of the full map.
 */
export function createFollowShadows(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  options: FollowShadowOptions = {},
): FollowShadowHandles {
  const radius = options.radius ?? 48;
  const mapSize = options.mapSize ?? 1024;
  const direction = (options.direction ?? new THREE.Vector3(0.45, 1, 0.25))
    .clone()
    .normalize();
  const intensity = options.intensity ?? 1.0;
  const color = options.color ?? 0xfff0dd;

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const light = new THREE.DirectionalLight(color, intensity);
  light.castShadow = true;
  light.shadow.mapSize.set(mapSize, mapSize);
  light.shadow.bias = -0.0008;
  light.shadow.normalBias = 0.05;
  // Soft edge on PCF (Three r152+ uses this for VSM/PCF softness where supported)
  light.shadow.radius = 1.5;

  const cam = light.shadow.camera;
  cam.near = 1;
  cam.far = radius * 5;
  cam.left = -radius;
  cam.right = radius;
  cam.top = radius;
  cam.bottom = -radius;
  cam.updateProjectionMatrix();

  // Distance from focus point to light — covers the local frustum
  const lightDistance = radius * 2.2;
  const offset = direction.clone().multiplyScalar(lightDistance);

  scene.add(light);
  scene.add(light.target);

  const focus = new THREE.Vector3();

  return {
    light,
    update(follow) {
      // Snap focus to XZ of the follower; keep a mild height blend so slopes stay covered
      focus.set(follow.x, follow.y, follow.z);
      light.target.position.copy(focus);
      light.position.copy(focus).add(offset);
      light.target.updateMatrixWorld();
    },
    dispose: () => {
      scene.remove(light);
      scene.remove(light.target);
      light.shadow.map?.dispose();
      light.dispose();
    },
  };
}

/** Enable cast/receive on a subtree (meshes only). */
export function setShadowFlags(
  root: THREE.Object3D,
  flags: { cast?: boolean; receive?: boolean },
): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (flags.cast !== undefined) mesh.castShadow = flags.cast;
    if (flags.receive !== undefined) mesh.receiveShadow = flags.receive;
  });
}
