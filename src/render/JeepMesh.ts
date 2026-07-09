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

/** Classic boxy Jeep palette (low-poly, flat). */
const PAL = {
  body: 0x4f6328, // olive
  bodyDark: 0x3a4a1c,
  black: 0x1a1a1a,
  tire: 0x1c1c1c,
  hub: 0x555555,
  grille: 0x111111,
  light: 0xffeebb,
  lightRing: 0x333333,
  glass: 0x88aacc,
  bumper: 0x2a2a2a,
  tail: 0xcc3333,
  interior: 0x2c2c2c,
} as const;

function mat(color: number, opts?: { flat?: boolean; opacity?: number }) {
  return new THREE.MeshLambertMaterial({
    color,
    flatShading: opts?.flat !== false,
    transparent: opts?.opacity != null && opts.opacity < 1,
    opacity: opts?.opacity ?? 1,
    depthWrite: opts?.opacity == null || opts.opacity >= 1,
  });
}

function box(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  color: number,
  x: number,
  y: number,
  z: number,
  name?: string,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  if (name) m.name = name;
  parent.add(m);
  return m;
}

function cyl(
  parent: THREE.Object3D,
  rTop: number,
  rBot: number,
  h: number,
  segs: number,
  color: number,
  x: number,
  y: number,
  z: number,
  rotX = 0,
  rotY = 0,
  rotZ = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(rTop, rBot, h, segs),
    mat(color),
  );
  m.position.set(x, y, z);
  m.rotation.set(rotX, rotY, rotZ);
  parent.add(m);
  return m;
}

/**
 * Low-poly classic boxy Jeep (Wrangler-ish silhouette).
 * Physics collider stays the chassis AABB; this is visuals only.
 * Wheels keep suspension pivots at VEHICLE_CONFIG.wheelPositions.
 */
export function createJeepMesh(): THREE.Group {
  const g = new THREE.Group();
  g.name = "jeep";

  const bodyW = 1.55;
  const halfW = bodyW / 2;

  // --- Rock sliders / side steps ---
  box(g, 0.12, 0.1, 1.7, PAL.black, -halfW - 0.08, -0.22, 0.05);
  box(g, 0.12, 0.1, 1.7, PAL.black, halfW + 0.08, -0.22, 0.05);

  // --- Main tub (door line height) ---
  box(g, bodyW, 0.55, 2.15, PAL.body, 0, 0.05, -0.05, "tub");

  // --- Hood (short, boxy, slight slope via thinner front) ---
  box(g, bodyW * 0.98, 0.28, 0.72, PAL.body, 0, 0.38, 0.78, "hood");
  // Hood seam / cowl
  box(g, bodyW * 0.92, 0.06, 0.08, PAL.bodyDark, 0, 0.52, 0.42);

  // --- Classic 7-slot grille ---
  const grilleZ = 1.12;
  box(g, bodyW * 0.72, 0.42, 0.08, PAL.grille, 0, 0.28, grilleZ, "grille-plate");
  for (let i = 0; i < 7; i++) {
    const x = -0.38 + i * 0.127;
    box(g, 0.045, 0.34, 0.04, PAL.black, x, 0.28, grilleZ + 0.04);
  }

  // --- Round headlights ---
  for (const sx of [-1, 1]) {
    const hx = sx * 0.58;
    cyl(g, 0.13, 0.13, 0.08, 10, PAL.lightRing, hx, 0.32, grilleZ + 0.02, Math.PI / 2, 0, 0);
    cyl(g, 0.1, 0.1, 0.06, 10, PAL.light, hx, 0.32, grilleZ + 0.06, Math.PI / 2, 0, 0);
  }

  // --- Front bumper + winch block ---
  box(g, bodyW + 0.15, 0.14, 0.18, PAL.bumper, 0, -0.18, 1.18, "bumper-f");
  box(g, 0.28, 0.16, 0.2, PAL.black, 0, -0.08, 1.22);

  // --- Nearly vertical windshield frame ---
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(bodyW * 0.85, 0.55, 0.04),
    mat(PAL.glass, { opacity: 0.45 }),
  );
  glass.name = "windshield";
  glass.position.set(0, 0.85, 0.32);
  glass.rotation.x = -0.12; // slightly raked, still "upright Jeep"
  g.add(glass);

  // A-pillars
  box(g, 0.07, 0.62, 0.07, PAL.black, -halfW + 0.12, 0.82, 0.3);
  box(g, 0.07, 0.62, 0.07, PAL.black, halfW - 0.12, 0.82, 0.3);
  // Top header
  box(g, bodyW * 0.88, 0.06, 0.08, PAL.black, 0, 1.12, 0.28);

  // --- Cabin / soft top ---
  box(g, bodyW * 0.96, 0.42, 0.95, PAL.bodyDark, 0, 0.95, -0.15, "cabin");
  // Side windows (flat dark glass panes)
  for (const sx of [-1, 1]) {
    const win = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.28, 0.55),
      mat(PAL.glass, { opacity: 0.4 }),
    );
    win.position.set(sx * (halfW - 0.02), 0.92, -0.05);
    g.add(win);
  }
  // Door cut lines (visual only)
  box(g, 0.03, 0.45, 0.7, PAL.black, -halfW - 0.01, 0.2, 0.05);
  box(g, 0.03, 0.45, 0.7, PAL.black, halfW + 0.01, 0.2, 0.05);

  // Simple roll-bar hoop behind cabin
  box(g, bodyW * 0.9, 0.07, 0.07, PAL.black, 0, 1.15, -0.55);
  box(g, 0.07, 0.45, 0.07, PAL.black, -halfW + 0.15, 0.95, -0.55);
  box(g, 0.07, 0.45, 0.07, PAL.black, halfW - 0.15, 0.95, -0.55);

  // --- Rear tub (short cargo / spare mount area) ---
  box(g, bodyW * 0.96, 0.4, 0.55, PAL.body, 0, 0.12, -0.85, "rear-tub");
  // Tailgate
  box(g, bodyW * 0.9, 0.38, 0.06, PAL.bodyDark, 0, 0.18, -1.12);

  // Rear bumper
  box(g, bodyW + 0.1, 0.12, 0.16, PAL.bumper, 0, -0.18, -1.2, "bumper-r");
  // Tail lights
  box(g, 0.12, 0.1, 0.06, PAL.tail, -halfW + 0.15, 0.28, -1.15);
  box(g, 0.12, 0.1, 0.06, PAL.tail, halfW - 0.15, 0.28, -1.15);

  // --- Spare tire on tailgate ---
  const spare = new THREE.Group();
  spare.name = "spare";
  spare.position.set(0, 0.35, -1.22);
  cyl(spare, 0.32, 0.32, 0.16, 12, PAL.tire, 0, 0, 0, 0, 0, Math.PI / 2);
  cyl(spare, 0.14, 0.14, 0.18, 8, PAL.hub, 0, 0, 0, 0, 0, Math.PI / 2);
  // Mount bracket
  box(spare, 0.08, 0.35, 0.08, PAL.black, 0, -0.15, 0.05);
  g.add(spare);

  // --- Fender flares (boxy arches over each wheel) ---
  const flareY = 0.05;
  const flareH = 0.28;
  const flareZ = [
    VEHICLE_CONFIG.wheelPositions[0].z, // FL
    VEHICLE_CONFIG.wheelPositions[2].z, // RL
  ];
  for (const z of flareZ) {
    for (const sx of [-1, 1]) {
      box(
        g,
        0.22,
        flareH,
        0.55,
        PAL.bodyDark,
        sx * (halfW + 0.06),
        flareY,
        z,
      );
    }
  }

  // --- Snorkel (driver side) ---
  box(g, 0.08, 0.55, 0.08, PAL.black, -halfW + 0.12, 0.55, 0.55);
  box(g, 0.1, 0.08, 0.2, PAL.black, -halfW + 0.12, 0.85, 0.48);

  // --- Interior seat hints (visible in FP slightly) ---
  box(g, 0.4, 0.25, 0.4, PAL.interior, -0.28, 0.35, 0.0);
  box(g, 0.4, 0.25, 0.4, PAL.interior, 0.28, 0.35, 0.0);
  box(g, 0.9, 0.08, 0.25, PAL.black, 0, 0.55, 0.35); // dash

  // --- Wheels (suspension pivots — do not rename) ---
  const r = VEHICLE_CONFIG.wheelRadius;
  const rest = VEHICLE_CONFIG.suspRestLength;
  VEHICLE_CONFIG.wheelPositions.forEach((w, i) => {
    const pivot = new THREE.Group();
    pivot.name = `wheel-pivot-${i}`;
    pivot.userData.wheelIndex = i;
    pivot.userData.hardpoint = { x: w.x, y: w.y, z: w.z };
    pivot.position.set(w.x, w.y, w.z);

    const tire = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, 0.32, 12),
      mat(PAL.tire),
    );
    tire.name = `wheel-mesh-${i}`;
    tire.rotation.z = Math.PI / 2;
    tire.position.set(0, -(rest - r), 0);

    // Hub cap
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.4, r * 0.4, 0.34, 8),
      mat(PAL.hub),
    );
    hub.rotation.z = Math.PI / 2;
    hub.position.copy(tire.position);

    // Simple lug star (low poly)
    const lug = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.36, 0.36),
      mat(PAL.black),
    );
    lug.rotation.z = Math.PI / 2;
    lug.position.copy(tire.position);

    pivot.add(tire);
    pivot.add(hub);
    pivot.add(lug);
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
    pivot.position.set(hard.x, hard.y, hard.z);

    const state = wheels[i];
    const suspLen =
      state && Number.isFinite(state.suspensionLength)
        ? state.suspensionLength
        : rest;
    const spin = state?.rotation ?? 0;
    const steer = state?.steering ?? 0;
    pivot.rotation.y = steer;

    const yOff = -(suspLen - r);
    for (const child of pivot.children) {
      child.position.set(0, yOff, 0);
      // Spin: tire/hub share axle rotation (cylinder already rotated Z=90°)
      if (child.name.startsWith("wheel-mesh-") || child instanceof THREE.Mesh) {
        const m = child as THREE.Mesh;
        m.rotation.z = Math.PI / 2;
        m.rotation.x = spin;
      }
    }
  }
}
