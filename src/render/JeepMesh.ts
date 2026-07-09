import * as THREE from "three";
import { VEHICLE_CONFIG } from "@/shared/vehicleConfig";

export type WheelVisualState = {
  suspensionLength: number;
  rotation: number;
  steering: number;
};

/**
 * Rubicon JK Unlimited palette — white body, black hardtop / flares / accents.
 * Target: low-poly silhouette close to the studio Rubicon reference photo.
 */
const PAL = {
  body: 0xf5f5f3,
  bodyShade: 0xc8c8c4,
  black: 0x111111,
  blackSoft: 0x1e1e1e,
  tire: 0x0e0e0e,
  rim: 0x1a1a1a,
  grille: 0x0a0a0a,
  light: 0xfff6e0,
  lightRing: 0x181818,
  glass: 0x121820,
  glassTint: 0x182028,
  bumper: 0x0a0a0a,
  orange: 0xff6a00,
  interior: 0x1a1a1a,
  chrome: 0x909090,
  red: 0xb01a1a,
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
 * Low-poly Jeep Wrangler Rubicon Unlimited.
 * Local: +Z forward, +Y up, +X right. Physics collider unchanged.
 *
 * Construction notes (from reference photo QA):
 * - White lower body + doors must dominate; black hardtop is a CAP not a brick
 * - Windshield must read from front (not buried in black volume)
 * - Chunky black flares, tubular bumper, meaty tires, tall stance
 */
export function createJeepMesh(): THREE.Group {
  const g = new THREE.Group();
  g.name = "jeep";

  const bodyW = 1.72;
  const halfW = bodyW / 2;
  const wb2 = VEHICLE_CONFIG.wheelPositions[0].z;

  // ===== Undercarriage / rock rails =====
  box(g, bodyW + 0.04, 0.1, 2.6, PAL.black, 0, -0.34, 0, "rocker");
  for (const sx of [-1, 1]) {
    box(g, 0.11, 0.055, 2.0, PAL.black, sx * (halfW + 0.07), -0.28, -0.05);
    for (const z of [0.4, -0.1, -0.6]) {
      box(g, 0.13, 0.035, 0.26, PAL.blackSoft, sx * (halfW + 0.09), -0.24, z);
    }
  }

  // Body +15% taller, glass shorter; roof height stays fixed (see greenhouse).
  const bodyScaleY = 1.15;

  // ===== Main white tub (taller body skin) =====
  const tubH = 0.58 * bodyScaleY;
  box(g, bodyW, tubH, 2.5, PAL.body, 0, 0.08 + tubH * 0.5 - 0.29, -0.05, "tub");

  // ===== Hood (raised with body) =====
  const hoodY = 0.48 * bodyScaleY;
  box(g, bodyW * 0.98, 0.2 * bodyScaleY, 0.78, PAL.body, 0, hoodY, 0.95, "hood");
  box(g, 0.5, 0.05, 0.34, PAL.black, 0, hoodY + 0.12, 0.92);
  // Cowl shelf under windshield (meets raised door belt)
  box(g, bodyW * 0.98, 0.14 * bodyScaleY, 0.18, PAL.body, 0, hoodY, 0.52, "cowl");
  box(g, bodyW * 0.9, 0.04, 0.08, PAL.bodyShade, 0, hoodY + 0.08, 0.48);

  // ===== Front fenders (white; kept inward so tires can poke past) =====
  for (const sx of [-1, 1]) {
    box(g, 0.22, 0.34 * bodyScaleY, 0.62, PAL.body, sx * (halfW - 0.2), 0.18 * bodyScaleY, 0.95);
  }

  // ===== 7-slot grille =====
  const gZ = 1.32;
  const grilleY = 0.36 * bodyScaleY;
  box(g, 0.95, 0.5 * bodyScaleY, 0.1, PAL.grille, 0, grilleY, gZ, "grille");
  for (let i = 0; i < 7; i++) {
    const x = -0.36 + i * 0.12;
    box(g, 0.04, 0.42 * bodyScaleY, 0.06, PAL.black, x, grilleY, gZ + 0.05);
  }
  box(g, 0.28, 0.07, 0.04, PAL.chrome, 0, grilleY + 0.24 * bodyScaleY, gZ + 0.06);

  // Round headlights sit in white face beside grille
  for (const sx of [-1, 1]) {
    const lx = sx * 0.62;
    const ly = grilleY + 0.02;
    box(g, 0.28, 0.36 * bodyScaleY, 0.08, PAL.body, lx, ly, gZ - 0.02);
    cyl(g, 0.14, 0.14, 0.1, 12, PAL.lightRing, lx, ly, gZ + 0.04, Math.PI / 2);
    cyl(g, 0.11, 0.11, 0.08, 12, PAL.light, lx, ly, gZ + 0.09, Math.PI / 2);
    box(g, 0.08, 0.05, 0.04, PAL.orange, sx * 0.72, ly + 0.18, gZ + 0.02);
  }

  // ===== Tubular bumper hoop (reference) =====
  const bump = new THREE.Group();
  bump.name = "bumper-front";
  bump.position.set(0, -0.1, 1.42);
  cyl(bump, 0.055, 0.055, bodyW + 0.4, 8, PAL.bumper, 0, 0.04, 0.04, 0, 0, Math.PI / 2);
  for (const sx of [-1, 1]) {
    cyl(bump, 0.045, 0.045, 0.48, 6, PAL.bumper, sx * (halfW + 0.1), 0.2, 0.08);
    cyl(bump, 0.04, 0.04, 0.34, 6, PAL.bumper, sx * (halfW + 0.1), 0.08, -0.12, Math.PI / 2);
  }
  cyl(bump, 0.04, 0.04, bodyW * 0.72, 6, PAL.bumper, 0, 0.32, 0.12, 0, 0, Math.PI / 2);
  box(bump, 0.44, 0.2, 0.26, PAL.black, 0, 0.02, -0.04);
  for (const sx of [-1, 1]) {
    cyl(bump, 0.05, 0.05, 0.08, 8, PAL.light, sx * 0.2, 0.14, 0.16, Math.PI / 2);
  }
  g.add(bump);

  // ===== Greenhouse: roof FIXED, body belt raised → shorter glass =====
  // Previous doorTopY≈0.52 / roofBottom≈1.36. Body +15% raises beltline;
  // glass only fills remaining doorTop → roof (overall vehicle height unchanged).
  const roofBottomY = 1.36; // fixed vehicle height
  const roofY = roofBottomY + 0.06;
  const doorTopY = 0.52 * bodyScaleY; // 0.598 — white body taller
  // Extra body rise: reclaim ~half of the +15% intent from glass band
  // (belt climbs further so glass is clearly shorter while roof stays put)
  const doorTopYRaised = doorTopY + (1.36 - 0.52) * 0.12; // ~0.70
  const beltY = doorTopYRaised;
  const greenH = roofBottomY - beltY; // shorter greenhouse (~0.66)
  const greenMidY = beltY + greenH * 0.5;

  // ===== White doors (taller) — tops meet raised glass beltline =====
  const doorH = 0.54 * bodyScaleY;
  const doorY = beltY - doorH * 0.5;
  box(g, bodyW + 0.02, doorH, 0.78, PAL.body, 0, doorY, 0.18, "doors-f");
  box(g, bodyW + 0.02, doorH, 0.78, PAL.body, 0, doorY, -0.58, "doors-r");
  for (const z of [0.55, -0.2, -0.95]) {
    box(g, 0.025, doorH - 0.04, 0.03, PAL.bodyShade, -halfW - 0.012, doorY, z);
    box(g, 0.025, doorH - 0.04, 0.03, PAL.bodyShade, halfW + 0.012, doorY, z);
  }
  for (const z of [0.32, -0.42]) {
    for (const sx of [-1, 1]) {
      box(g, 0.035, 0.05, 0.11, PAL.black, sx * (halfW + 0.025), beltY - 0.12, z);
    }
  }

  // ===== Windshield: shorter band from raised cowl to fixed roof =====
  const wsZ = 0.52;
  const wsBottom = beltY - 0.02; // planted on raised body belt
  const wsTop = roofBottomY;
  const wsH = wsTop - wsBottom;
  const wsMidY = wsBottom + wsH * 0.5;
  box(g, 0.1, wsH + 0.04, 0.11, PAL.black, -halfW + 0.07, wsMidY, wsZ, "a-L");
  box(g, 0.1, wsH + 0.04, 0.11, PAL.black, halfW - 0.07, wsMidY, wsZ, "a-R");
  box(g, bodyW * 0.94, 0.08, 0.1, PAL.black, 0, wsBottom, wsZ, "ws-base");
  box(g, bodyW * 0.96, 0.09, 0.12, PAL.black, 0, wsTop - 0.02, wsZ - 0.02, "ws-header");

  const ws = new THREE.Mesh(
    new THREE.BoxGeometry(bodyW * 0.84, Math.max(0.2, wsH - 0.06), 0.05),
    mat(PAL.glass, { opacity: 0.58 }),
  );
  ws.name = "windshield";
  ws.position.set(0, wsMidY + 0.01, wsZ + 0.03);
  ws.rotation.x = -0.08;
  g.add(ws);

  // ===== Black hardtop: roof fixed; short side walls over glass only =====
  const roofZ = -0.2;
  const roofD = 2.0;
  box(g, bodyW + 0.06, 0.12, roofD, PAL.black, 0, roofY, roofZ, "roof");
  box(g, bodyW + 0.04, 0.1, 0.18, PAL.black, 0, roofY - 0.02, 0.5);
  box(g, bodyW + 0.02, greenH, 0.12, PAL.black, 0, greenMidY, -1.18, "hardtop-rear");

  for (const sx of [-1, 1]) {
    box(
      g,
      0.08,
      greenH,
      1.78,
      PAL.black,
      sx * (halfW - 0.01),
      greenMidY,
      -0.2,
      sx < 0 ? "hardtop-side-L" : "hardtop-side-R",
    );
    // Beltline on raised white body
    box(g, 0.1, 0.1, 1.78, PAL.blackSoft, sx * (halfW + 0.01), beltY, -0.2);
    box(g, 0.1, 0.08, 1.78, PAL.blackSoft, sx * (halfW + 0.01), roofBottomY - 0.02, -0.2);
    for (const z of [0.5, -0.2, -0.9]) {
      box(g, 0.1, greenH - 0.06, 0.09, PAL.blackSoft, sx * (halfW + 0.03), greenMidY, z);
    }
  }

  // Side glass: shorter panes in the reduced greenhouse band
  const sideGlassH = Math.max(0.22, greenH - 0.14);
  const sideGlassY = greenMidY + 0.01;
  const panes = [
    { z: 0.16, d: 0.55 },
    { z: -0.52, d: 0.55 },
    { z: -1.05, d: 0.3 },
  ];
  for (const sx of [-1, 1]) {
    for (const p of panes) {
      const pane = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, sideGlassH, p.d),
        mat(PAL.glassTint, { opacity: 0.58 }),
      );
      pane.position.set(sx * (halfW + 0.04), sideGlassY, p.z);
      g.add(pane);
    }
  }

  const rearGlass = new THREE.Mesh(
    new THREE.BoxGeometry(bodyW * 0.74, sideGlassH - 0.02, 0.05),
    mat(PAL.glassTint, { opacity: 0.58 }),
  );
  rearGlass.position.set(0, sideGlassY, -1.25);
  g.add(rearGlass);

  // ===== Mirrors =====
  for (const sx of [-1, 1]) {
    box(g, 0.07, 0.1, 0.07, PAL.black, sx * (halfW - 0.02), beltY + 0.1, 0.48);
    box(g, 0.2, 0.12, 0.14, PAL.black, sx * (halfW + 0.14), beltY + 0.14, 0.42);
  }

  // A-pillar light pods (roof height unchanged)
  for (const sx of [-1, 1]) {
    box(g, 0.1, 0.12, 0.12, PAL.black, sx * (halfW - 0.14), roofY + 0.02, 0.52);
    box(g, 0.08, 0.09, 0.08, PAL.light, sx * (halfW - 0.14), roofY + 0.08, 0.54);
  }

  // ===== Fender flares / wheel arches (inset toward body so tires poke out) =====
  // Arch sits near body skin; tires use visual track outset past this.
  for (const z of [wb2, -wb2]) {
    for (const sx of [-1, 1]) {
      // Main arch: slightly inside body half-width (inset wheel well)
      box(g, 0.18, 0.38, 0.7, PAL.black, sx * (halfW - 0.02), 0.1, z);
      // Thin outer lip (does not cover tire outer face)
      box(g, 0.1, 0.08, 0.76, PAL.blackSoft, sx * (halfW + 0.06), 0.32, z);
      // Inner well wall (defines inset arch pocket)
      box(g, 0.08, 0.36, 0.66, PAL.blackSoft, sx * (halfW - 0.16), 0.08, z);
    }
  }

  // ===== Rear body / tailgate / spare =====
  const tailH = 0.62 * bodyScaleY;
  box(g, bodyW * 0.98, tailH, 0.18, PAL.body, 0, beltY - tailH * 0.45, -1.28, "tailgate");
  box(g, bodyW * 0.98, 0.1, 0.14, PAL.black, 0, roofY, -1.18, "roof-rear-lip");
  box(g, 0.4, 0.05, 0.04, PAL.orange, 0, roofY + 0.06, -1.16);
  box(g, 0.11, 0.3, 0.07, PAL.red, -halfW + 0.14, 0.42 * bodyScaleY, -1.38);
  box(g, 0.11, 0.3, 0.07, PAL.red, halfW - 0.14, 0.42 * bodyScaleY, -1.38);
  cyl(g, 0.045, 0.045, bodyW + 0.1, 8, PAL.bumper, 0, -0.14, -1.42, 0, 0, Math.PI / 2);

  // Spare: disc faces -Z (rear)
  const spare = new THREE.Group();
  spare.name = "spare-tire";
  spare.position.set(0, 0.42 * bodyScaleY, -1.5);
  cyl(spare, 0.4, 0.4, 0.22, 14, PAL.tire, 0, 0, 0, Math.PI / 2, 0, 0);
  cyl(spare, 0.18, 0.18, 0.24, 8, PAL.rim, 0, 0, 0, Math.PI / 2, 0, 0);
  cyl(spare, 0.09, 0.09, 0.08, 8, PAL.black, 0, 0, -0.14, Math.PI / 2, 0, 0);
  box(spare, 0.14, 0.48, 0.16, PAL.black, 0, -0.04, 0.14);
  g.add(spare);

  // ===== Interior peek =====
  box(g, 0.4, 0.26, 0.4, PAL.interior, -0.32, 0.28, 0.02);
  box(g, 0.4, 0.26, 0.4, PAL.interior, 0.32, 0.28, 0.02);
  box(g, 0.95, 0.1, 0.26, PAL.black, 0, 0.52, 0.4);

  // ===== Meaty off-road wheels (visual track wider than body / physics) =====
  // Physics hardpoints stay on VEHICLE_CONFIG; mesh only is pushed out.
  const r = VEHICLE_CONFIG.wheelRadius;
  const rest = VEHICLE_CONFIG.suspRestLength;
  /** Extra half-track (m) so tires stick past body / inset arches. */
  const visualTrackOutset = 0.16;
  VEHICLE_CONFIG.wheelPositions.forEach((w, i) => {
    const pivot = new THREE.Group();
    pivot.name = `wheel-pivot-${i}`;
    pivot.userData.wheelIndex = i;
    const side = w.x >= 0 ? 1 : -1;
    const hardpoint = {
      x: w.x + side * visualTrackOutset,
      y: w.y,
      z: w.z,
    };
    pivot.userData.hardpoint = hardpoint;
    pivot.position.set(hardpoint.x, hardpoint.y, hardpoint.z);

    // Visually larger / fatter than physics radius for Rubicon stance
    const tireR = r * 1.2;
    const tireW = 0.5;
    const tire = new THREE.Mesh(
      new THREE.CylinderGeometry(tireR, tireR, tireW, 14),
      mat(PAL.tire),
    );
    tire.name = `wheel-mesh-${i}`;
    tire.rotation.z = Math.PI / 2;
    // Sit contact near physics contact: use physics r for y offset
    tire.position.set(0, -(rest - r), 0);

    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(tireR * 0.5, tireR * 0.56, tireW + 0.02, 10),
      mat(PAL.rim),
    );
    rim.rotation.z = Math.PI / 2;
    rim.position.copy(tire.position);

    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(tireR * 0.18, tireR * 0.18, tireW + 0.04, 8),
      mat(PAL.black),
    );
    cap.rotation.z = Math.PI / 2;
    cap.position.copy(tire.position);

    for (let s = 0; s < 8; s++) {
      const spoke = new THREE.Mesh(
        new THREE.BoxGeometry(tireR * 0.92, 0.065, 0.085),
        mat(PAL.rim),
      );
      spoke.name = "spoke";
      spoke.userData.baseSpin = (s / 8) * Math.PI * 2;
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
