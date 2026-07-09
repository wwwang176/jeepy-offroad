import * as THREE from "three";
import { VEHICLE_CONFIG } from "@/shared/vehicleConfig";

export type WheelVisualState = {
  suspensionLength: number;
  rotation: number;
  steering: number;
};

/** Rubicon-inspired palette (white body, black accents). */
const PAL = {
  body: 0xf2f2f0, // white
  bodyShade: 0xd8d8d4,
  black: 0x1a1a1a,
  blackSoft: 0x2a2a2a,
  tire: 0x141414,
  rim: 0x2c2c2c,
  grille: 0x111111,
  light: 0xfff5d6,
  lightRing: 0x222222,
  glass: 0x1a2228,
  glassTint: 0x2a3540,
  bumper: 0x0e0e0e,
  orange: 0xff6a00, // marker / accent
  interior: 0x222222,
  chrome: 0x666666,
} as const;

function mat(
  color: number,
  opts?: { flat?: boolean; opacity?: number },
): THREE.MeshLambertMaterial {
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
 * Low-poly Jeep in the style of a white Rubicon Unlimited:
 * boxy 4-door, black flares/grille/top, tubular bumper, big tires.
 * Physics collider unchanged — visuals only.
 */
export function createJeepMesh(): THREE.Group {
  const g = new THREE.Group();
  g.name = "jeep";

  // Slightly wider visual stance like flared Rubicon
  const bodyW = 1.62;
  const halfW = bodyW / 2;
  const wb2 = VEHICLE_CONFIG.wheelPositions[0].z; // front axle z

  // ===== Underside / rockers (black) =====
  box(g, bodyW + 0.05, 0.12, 2.35, PAL.black, 0, -0.28, 0.0, "rocker");
  // Rock rails / steps
  box(g, 0.1, 0.08, 1.85, PAL.black, -halfW - 0.1, -0.2, 0.0);
  box(g, 0.1, 0.08, 1.85, PAL.black, halfW + 0.1, -0.2, 0.0);

  // ===== Continuous body shell (tub + cabin walls connected) =====
  // Lower tub
  box(g, bodyW, 0.55, 2.4, PAL.body, 0, 0.1, -0.02, "tub");
  // Upper door / cabin walls — bridges tub beltline up into the hardtop
  // (fixes floating glass/cabin look)
  const cabinH = 0.72;
  const cabinY = 0.48; // bottom overlaps tub top
  const cabinZ = -0.12;
  const cabinD = 1.85;
  box(g, bodyW, cabinH, cabinD, PAL.body, 0, cabinY + cabinH * 0.5, cabinZ, "cabin-walls");

  // Door panel lines (4 doors feel) on full wall height
  for (const z of [0.55, 0.05, -0.45, -0.9]) {
    box(g, 0.025, 0.85, 0.04, PAL.bodyShade, -halfW - 0.012, 0.45, z);
    box(g, 0.025, 0.85, 0.04, PAL.bodyShade, halfW + 0.012, 0.45, z);
  }

  // ===== Hood (white, boxy) — meets cowl under windshield =====
  box(g, bodyW * 0.98, 0.26, 0.78, PAL.body, 0, 0.42, 0.85, "hood");
  box(g, 0.55, 0.04, 0.35, PAL.black, 0, 0.56, 0.85);
  // Cowl shelf: joins hood rear to windshield base
  box(g, bodyW * 0.98, 0.14, 0.22, PAL.body, 0, 0.42, 0.42, "cowl");
  box(g, bodyW * 0.95, 0.05, 0.08, PAL.bodyShade, 0, 0.5, 0.38);

  // ===== Black 7-slot grille =====
  const gZ = 1.2;
  box(g, bodyW * 0.7, 0.48, 0.1, PAL.grille, 0, 0.32, gZ, "grille");
  for (let i = 0; i < 7; i++) {
    const x = -0.36 + i * 0.12;
    box(g, 0.04, 0.4, 0.05, PAL.black, x, 0.32, gZ + 0.05);
  }
  box(g, 0.28, 0.08, 0.04, PAL.chrome, 0, 0.54, gZ + 0.06);

  // ===== Round headlights =====
  for (const sx of [-1, 1]) {
    const lx = sx * 0.62;
    cyl(g, 0.14, 0.14, 0.1, 12, PAL.lightRing, lx, 0.36, gZ + 0.02, Math.PI / 2);
    cyl(g, 0.11, 0.11, 0.08, 12, PAL.light, lx, 0.36, gZ + 0.07, Math.PI / 2);
  }
  box(g, 0.08, 0.05, 0.04, PAL.orange, -0.72, 0.5, gZ + 0.02);
  box(g, 0.08, 0.05, 0.04, PAL.orange, 0.72, 0.5, gZ + 0.02);

  // ===== Tubular front bumper + winch =====
  const bump = new THREE.Group();
  bump.name = "bumper-front";
  bump.position.set(0, -0.12, 1.28);
  cyl(bump, 0.05, 0.05, bodyW + 0.25, 8, PAL.bumper, 0, 0, 0, 0, 0, Math.PI / 2);
  for (const sx of [-1, 1]) {
    cyl(bump, 0.04, 0.04, 0.35, 6, PAL.bumper, sx * (halfW + 0.05), 0.12, 0.05, 0, 0, 0);
    cyl(bump, 0.04, 0.04, 0.28, 6, PAL.bumper, sx * (halfW + 0.05), 0.08, -0.12, Math.PI / 2, 0, 0);
  }
  cyl(bump, 0.035, 0.035, bodyW * 0.7, 6, PAL.bumper, 0, 0.18, 0.08, 0, 0, Math.PI / 2);
  box(bump, 0.35, 0.18, 0.22, PAL.black, 0, 0.05, -0.08);
  g.add(bump);

  // ===== Windshield frame planted on cowl, tied into roof =====
  // A-pillars sit on cowl, rise into header under hardtop
  const pillarBottom = 0.48;
  const pillarH = 0.72;
  const pillarY = pillarBottom + pillarH * 0.5;
  const pillarZ = 0.34;
  box(g, 0.1, pillarH, 0.1, PAL.black, -halfW + 0.08, pillarY, pillarZ, "a-pillar-L");
  box(g, 0.1, pillarH, 0.1, PAL.black, halfW - 0.08, pillarY, pillarZ, "a-pillar-R");
  // Header bar (under roof front edge)
  box(g, bodyW * 0.94, 0.09, 0.1, PAL.black, 0, 1.12, 0.32, "windshield-header");
  // Base bar on cowl
  box(g, bodyW * 0.9, 0.06, 0.08, PAL.black, 0, 0.52, 0.36, "windshield-base");

  // Front glass inset in frame (slightly smaller, no float)
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(bodyW * 0.78, 0.58, 0.05),
    mat(PAL.glass, { opacity: 0.72 }),
  );
  glass.name = "windshield";
  glass.position.set(0, 0.82, 0.34);
  glass.rotation.x = -0.06;
  g.add(glass);

  // ===== Hardtop sits ON cabin walls (connected) =====
  // Roof slab
  box(g, bodyW * 1.0, 0.12, cabinD + 0.08, PAL.black, 0, 1.2, cabinZ, "hardtop");
  // Front roof lip over windshield header
  box(g, bodyW * 0.98, 0.08, 0.14, PAL.black, 0, 1.18, 0.28);

  // Side window openings: black frames flush with cabin wall, glass inset
  for (const sx of [-1, 1]) {
    const sideX = sx * (halfW - 0.01);
    // Window frame strip (connects tub to roof)
    box(g, 0.08, 0.5, 1.4, PAL.black, sideX, 0.85, -0.2, sx < 0 ? "side-frame-L" : "side-frame-R");
    // Dark glass pane inset
    const sideGlass = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.36, 1.2),
      mat(PAL.glassTint, { opacity: 0.65 }),
    );
    sideGlass.position.set(sx * (halfW + 0.01), 0.88, -0.18);
    g.add(sideGlass);
  }
  // Rear quarter glass (flush)
  for (const sx of [-1, 1]) {
    const q = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.32, 0.42),
      mat(PAL.glassTint, { opacity: 0.65 }),
    );
    q.position.set(sx * (halfW + 0.01), 0.86, -0.88);
    g.add(q);
  }

  // Door mirrors on A-pillar base (connected to body)
  for (const sx of [-1, 1]) {
    box(g, 0.08, 0.14, 0.08, PAL.black, sx * (halfW - 0.02), 0.72, 0.3);
    box(g, 0.2, 0.12, 0.14, PAL.black, sx * (halfW + 0.14), 0.75, 0.28);
  }

  // ===== Black fender flares (signature Rubicon look) =====
  const flarePositions = [
    { z: wb2, scaleZ: 0.72 }, // front
    { z: -wb2, scaleZ: 0.72 }, // rear
  ];
  for (const fp of flarePositions) {
    for (const sx of [-1, 1]) {
      // Outer flare slab
      box(
        g,
        0.28,
        0.38,
        fp.scaleZ,
        PAL.black,
        sx * (halfW + 0.14),
        0.08,
        fp.z,
      );
      // Top lip
      box(
        g,
        0.32,
        0.08,
        fp.scaleZ + 0.08,
        PAL.blackSoft,
        sx * (halfW + 0.14),
        0.28,
        fp.z,
      );
    }
  }

  // ===== Rear body / tailgate (joined to cabin) =====
  // Full-height rear panel under hardtop
  box(g, bodyW * 0.98, 0.95, 0.22, PAL.body, 0, 0.55, -1.1, "rear-panel");
  box(g, bodyW * 0.92, 0.7, 0.08, PAL.bodyShade, 0, 0.45, -1.22, "tailgate");
  // C-pillars tying roof to rear
  box(g, 0.12, 0.55, 0.12, PAL.black, -halfW + 0.1, 0.9, -1.05);
  box(g, 0.12, 0.55, 0.12, PAL.black, halfW - 0.1, 0.9, -1.05);
  // High-mount stop strip on roof rear
  box(g, 0.5, 0.06, 0.04, PAL.orange, 0, 1.18, -1.05);
  // Tail lights
  box(g, 0.1, 0.28, 0.08, 0xaa2222, -halfW + 0.12, 0.4, -1.28);
  box(g, 0.1, 0.28, 0.08, 0xaa2222, halfW - 0.12, 0.4, -1.28);
  cyl(g, 0.045, 0.045, bodyW + 0.1, 8, PAL.bumper, 0, -0.15, -1.32, 0, 0, Math.PI / 2);

  // Spare tire (optional Rubicon often has it — keep for silhouette)
  const spare = new THREE.Group();
  spare.position.set(0, 0.4, -1.38);
  cyl(spare, 0.36, 0.36, 0.2, 12, PAL.tire, 0, 0, 0, 0, 0, Math.PI / 2);
  cyl(spare, 0.16, 0.16, 0.22, 8, PAL.rim, 0, 0, 0, 0, 0, Math.PI / 2);
  box(spare, 0.1, 0.4, 0.1, PAL.black, 0, -0.2, 0.06);
  g.add(spare);

  // ===== A-pillar light bar mounts (like photo) =====
  for (const sx of [-1, 1]) {
    box(g, 0.08, 0.12, 0.08, PAL.black, sx * (halfW - 0.15), 1.2, 0.4);
    cyl(g, 0.05, 0.05, 0.1, 8, PAL.light, sx * (halfW - 0.15), 1.28, 0.4);
  }

  // ===== Interior (FP peek) =====
  box(g, 0.42, 0.28, 0.42, PAL.interior, -0.3, 0.32, 0.05);
  box(g, 0.42, 0.28, 0.42, PAL.interior, 0.3, 0.32, 0.05);
  box(g, 0.95, 0.1, 0.28, PAL.black, 0, 0.52, 0.38); // dash
  box(g, 0.15, 0.15, 0.15, PAL.black, 0.2, 0.55, 0.15); // wheel hub hint

  // ===== Wheels: big off-road tires + black rims =====
  const r = VEHICLE_CONFIG.wheelRadius;
  const rest = VEHICLE_CONFIG.suspRestLength;
  VEHICLE_CONFIG.wheelPositions.forEach((w, i) => {
    const pivot = new THREE.Group();
    pivot.name = `wheel-pivot-${i}`;
    pivot.userData.wheelIndex = i;
    pivot.userData.hardpoint = { x: w.x, y: w.y, z: w.z };
    pivot.position.set(w.x, w.y, w.z);

    // Slightly fatter visual tire
    const tireR = r * 1.05;
    const tire = new THREE.Mesh(
      new THREE.CylinderGeometry(tireR, tireR, 0.38, 14),
      mat(PAL.tire),
    );
    tire.name = `wheel-mesh-${i}`;
    tire.rotation.z = Math.PI / 2;
    tire.position.set(0, -(rest - r), 0);

    // Deep dish black rim
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(tireR * 0.55, tireR * 0.62, 0.4, 10),
      mat(PAL.rim),
    );
    rim.rotation.z = Math.PI / 2;
    rim.position.copy(tire.position);

    // Center cap
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(tireR * 0.22, tireR * 0.22, 0.42, 8),
      mat(PAL.black),
    );
    cap.rotation.z = Math.PI / 2;
    cap.position.copy(tire.position);

    // Spoke blocks (5-spoke look)
    for (let s = 0; s < 5; s++) {
      const spoke = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.08, 0.1),
        mat(PAL.rim),
      );
      spoke.name = "spoke";
      spoke.userData.baseSpin = (s / 5) * Math.PI * 2;
      spoke.rotation.z = Math.PI / 2;
      spoke.rotation.x = spoke.userData.baseSpin as number;
      spoke.position.copy(tire.position);
      pivot.add(spoke);
    }

    pivot.add(tire);
    pivot.add(rim);
    pivot.add(cap);
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
      const m = child as THREE.Mesh;
      if (!m.isMesh) continue;
      m.rotation.z = Math.PI / 2;
      const base = (m.userData.baseSpin as number | undefined) ?? 0;
      m.rotation.x = spin + base;
    }
  }
}
