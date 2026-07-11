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

// Scratch vectors for lateral suspension placement (no per-frame alloc).
const _suspFrom = new THREE.Vector3();
const _suspTo = new THREE.Vector3();
const _suspMid = new THREE.Vector3();
const _suspDir = new THREE.Vector3();
const _suspY = new THREE.Vector3(0, 1, 0);
const _suspQuat = new THREE.Quaternion();

/**
 * Shared wheel-arch / flare lip geometry (chassis local).
 * Spring upper anchor = underside center of the main top lip.
 */
const FLARE_LIP = {
  /** Lip center X offset from body half-width (toward outside). */
  xOff: 0.02,
  /** Lip box height. */
  h: 0.1,
  /** Lip center Y. */
  yCenter: 0.3,
  w: 0.16,
  d: 0.72,
} as const;

/**
 * Visual tire width along axle (m). Cylinder is rotated so this is local X span.
 * Lateral suspension seats on the **inner face center** (hub side), not volume mid.
 */
const VISUAL_TIRE_WIDTH = 0.5;

/** Underside of main flare top lip (where spring seats). */
function flareLipUndersideY(): number {
  return FLARE_LIP.yCenter - FLARE_LIP.h * 0.5;
}

/** Flare lip center X for a given side (+1 right / -1 left). */
function flareLipCenterX(side: number, bodyHalfW: number): number {
  return side * (bodyHalfW + FLARE_LIP.xOff);
}

/**
 * Place a unit-Y cylinder (height 1 centered at origin) so it spans from→to.
 */
function placeUnitCylinder(
  mesh: THREE.Object3D,
  from: THREE.Vector3,
  to: THREE.Vector3,
  lengthScale = 1,
): number {
  _suspDir.subVectors(to, from);
  const len = _suspDir.length();
  if (len < 1e-4) {
    mesh.visible = false;
    return 0;
  }
  mesh.visible = true;
  _suspMid.copy(from).add(to).multiplyScalar(0.5);
  mesh.position.copy(_suspMid);
  _suspDir.multiplyScalar(1 / len);
  _suspQuat.setFromUnitVectors(_suspY, _suspDir);
  mesh.quaternion.copy(_suspQuat);
  mesh.scale.set(1, len * lengthScale, 1);
  return len;
}

/**
 * Lateral suspension visuals:
 * - One thick crossbar: chassis body → **inner tire face center** (hub side)
 * - Coil spring: **fixed wheel-arch mount** → **inner tire face center**
 *
 * Wheel volume mid = hard + (0, yOff, 0); inner face is inset toward body by
 * half visual tire width along X (wide tires would otherwise look mis-seated).
 * Arch mount is chassis-fixed and never moves.
 */
function createSuspensionLink(
  parent: THREE.Group,
  index: number,
  hard: { x: number; y: number; z: number },
  side: number,
  bodyHalfW: number,
  tireWidth: number = VISUAL_TIRE_WIDTH,
): THREE.Group {
  const link = new THREE.Group();
  link.name = `susp-link-${index}`;
  link.userData.wheelIndex = index;
  link.userData.side = side;
  link.userData.tireHalfW = tireWidth * 0.5;
  link.userData.hardpoint = { x: hard.x, y: hard.y, z: hard.z };
  link.userData.restHubTravel = VEHICLE_CONFIG.suspRestLength;

  // FIXED spring upper anchor = exact underside center of flare top lip.
  // Same constants as the flare mesh so the spring seats on the arch.
  link.userData.archLocal = {
    x: flareLipCenterX(side, bodyHalfW),
    y: flareLipUndersideY(),
    z: hard.z,
  };
  // FIXED body root deep inboard so the bar reads as a long lateral tube.
  link.userData.barRootLocal = {
    x: side * 0.22,
    y: hard.y + 0.05,
    z: hard.z,
  };

  // Thick lateral crossbar (body → inner tire face / hub side)
  const bar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.055, 1, 10),
    mat(PAL.chrome),
  );
  bar.name = "crossbar";
  link.add(bar);

  // Slightly thinner twin bar below for readability
  const bar2 = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, 0.032, 1, 8),
    mat(PAL.black),
  );
  bar2.name = "crossbar-2";
  link.add(bar2);

  // Coil spring: arch → inner tire face
  const spring = new THREE.Group();
  spring.name = "spring";
  const sleeve = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.034, 1, 8),
    mat(PAL.blackSoft),
  );
  sleeve.name = "sleeve";
  spring.add(sleeve);
  // Coils span nearly full unit strut: local -Y = arch end, +Y = hub end
  // (placeUnitCylinder aligns +Y with arch→hub). Keep baseY fixed forever.
  const coils = 10;
  for (let k = 0; k < coils; k++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.072, 0.02, 6, 12),
      mat(PAL.orange),
    );
    ring.name = "coil";
    ring.rotation.x = Math.PI / 2;
    const baseY = -0.48 + (k / (coils - 1)) * 0.96;
    ring.userData.baseY = baseY;
    ring.position.y = baseY;
    spring.add(ring);
  }
  link.add(spring);

  // Thin plate on the lip underside (sits flush under the flare mesh)
  const archPlate = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.04, 0.14),
    mat(PAL.black),
  );
  archPlate.name = "arch-plate";
  // Slightly below underside so it doesn't z-fight the lip
  archPlate.position.set(
    link.userData.archLocal.x,
    link.userData.archLocal.y - 0.02,
    link.userData.archLocal.z,
  );
  link.add(archPlate);

  // Hub ball on inner tire face center
  const hubBall = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 10, 8),
    mat(PAL.chrome),
  );
  hubBall.name = "hub-ball";
  link.add(hubBall);

  // Body root ball (crossbar inner end)
  const rootBall = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 8, 6),
    mat(PAL.black),
  );
  rootBall.name = "root-ball";
  rootBall.position.set(
    link.userData.barRootLocal.x,
    link.userData.barRootLocal.y,
    link.userData.barRootLocal.z,
  );
  link.add(rootBall);

  parent.add(link);
  return link;
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

  // Tint hierarchy: front lightest → side mid → rear darkest (opacity ↑ = less clear)
  const glassFrontOpacity = 0.42;
  const glassSideOpacity = 0.62;
  const glassRearOpacity = 0.82;
  const glassT = 0.04;

  const ws = new THREE.Mesh(
    new THREE.BoxGeometry(bodyW * 0.84, Math.max(0.2, wsH - 0.06), glassT),
    mat(PAL.glass, { opacity: glassFrontOpacity }),
  );
  ws.name = "glass-windshield";
  ws.userData.isGlass = true;
  ws.position.set(0, wsMidY + 0.01, wsZ + 0.03);
  ws.rotation.x = -0.08;
  g.add(ws);

  // ===== Black hardtop: roof + open window frames (glass fills bays) =====
  // Frame first; glass is derived from inner faces so panes sit flush in openings.
  const roofZ = -0.2;
  const roofD = 2.0;
  box(g, bodyW + 0.06, 0.12, roofD, PAL.black, 0, roofY, roofZ, "roof");
  box(g, bodyW + 0.04, 0.1, 0.18, PAL.black, 0, roofY - 0.02, 0.5);

  // Pillar centers along vehicle Z (front → rear).
  const pillarZs = [0.48, -0.18, -0.82, -1.16];
  const pillarD = 0.1;
  const pillarW = 0.11;
  const frameW = 0.1;
  const botRailH = 0.1;
  const topRailH = 0.08;
  const botRailY = beltY;
  const topRailY = roofBottomY - 0.02;
  const frameX = halfW + 0.02; // side-frame centerline (|X|)
  /** Clearance from frame inner faces — avoids z-fight, still reads as filled. */
  const glassInset = 0.012;

  // Rails span front face of first pillar → rear face of last pillar
  const railZFront = pillarZs[0]! + pillarD * 0.5;
  const railZRear = pillarZs[pillarZs.length - 1]! - pillarD * 0.5;
  const railZLen = railZFront - railZRear;
  const railZMid = (railZFront + railZRear) * 0.5;

  // Window opening in Y (inner faces of top/bottom rails)
  const openY0 = botRailY + botRailH * 0.5;
  const openY1 = topRailY - topRailH * 0.5;
  const glassH = Math.max(0.2, openY1 - openY0 - glassInset * 2);
  const glassY = (openY0 + openY1) * 0.5;

  // Pillar vertical span (slightly inside roof/belt so rails read on top)
  const pillarH = openY1 - openY0 + botRailH * 0.35 + topRailH * 0.35;
  const pillarY = (openY0 + openY1) * 0.5;

  for (const sx of [-1, 1]) {
    const x = sx * frameX;
    // Bottom / top rails only (no full-height side slab)
    box(g, frameW, botRailH, railZLen, PAL.blackSoft, x, botRailY, railZMid);
    box(g, frameW, topRailH, railZLen, PAL.blackSoft, x, topRailY, railZMid);
    // Vertical pillars
    for (let i = 0; i < pillarZs.length; i++) {
      const z = pillarZs[i]!;
      box(
        g,
        pillarW,
        pillarH,
        pillarD,
        PAL.black,
        x,
        pillarY,
        z,
        i === 0
          ? sx < 0
            ? "hardtop-pillar-Lf"
            : "hardtop-pillar-Rf"
          : i === pillarZs.length - 1
            ? sx < 0
              ? "hardtop-pillar-Lr"
              : "hardtop-pillar-Rr"
            : undefined,
      );
    }
    // Side glass: fill each bay to pillar/rail inners (minus inset), on frame midplane
    for (let i = 0; i < pillarZs.length - 1; i++) {
      const zFwd = pillarZs[i]!;
      const zAft = pillarZs[i + 1]!;
      const openFront = zFwd - pillarD * 0.5;
      const openRear = zAft + pillarD * 0.5;
      const paneD = Math.max(0.1, openFront - openRear - glassInset * 2);
      const paneZ = (openFront + openRear) * 0.5;
      const pane = new THREE.Mesh(
        new THREE.BoxGeometry(glassT, glassH, paneD),
        mat(PAL.glassTint, { opacity: glassSideOpacity }),
      );
      pane.name = "glass-side";
      pane.userData.isGlass = true;
      pane.position.set(x, glassY, paneZ);
      g.add(pane);
    }
  }

  // Rear window frame on the same rear-pillar plane; posts share side rear pillars in Z
  const rearZ = pillarZs[pillarZs.length - 1]!;
  const rearFrameD = pillarD;
  const rearPostW = pillarW;
  // Posts sit on body sides (inner of side-frame centerline) so rear glass spans cabin width
  const rearPostX = halfW - rearPostW * 0.5;
  box(g, bodyW + 0.02, botRailH, rearFrameD, PAL.black, 0, botRailY, rearZ, "hardtop-rear-sill");
  box(
    g,
    bodyW + 0.02,
    topRailH,
    rearFrameD,
    PAL.black,
    0,
    topRailY,
    rearZ,
    "hardtop-rear-header",
  );
  for (const sx of [-1, 1]) {
    box(g, rearPostW, pillarH, rearFrameD, PAL.black, sx * rearPostX, pillarY, rearZ);
  }

  // Rear glass: between post inners + rail inners; centered on rear frame midplane
  const rearOpenHalfW = rearPostX - rearPostW * 0.5;
  const rearGlassW = Math.max(0.4, rearOpenHalfW * 2 - glassInset * 2);
  const rearGlass = new THREE.Mesh(
    new THREE.BoxGeometry(rearGlassW, glassH, glassT),
    mat(PAL.glassTint, { opacity: glassRearOpacity }),
  );
  rearGlass.name = "glass-rear";
  rearGlass.userData.isGlass = true;
  rearGlass.position.set(0, glassY, rearZ);
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

  // ===== Fender flares / wheel arches (geometry shared with spring anchors) =====
  for (const z of [wb2, -wb2]) {
    for (const sx of [-1, 1]) {
      // Main top lip — spring seats on its underside (see FLARE_LIP / archLocal)
      box(
        g,
        FLARE_LIP.w,
        FLARE_LIP.h,
        FLARE_LIP.d,
        PAL.black,
        sx * (halfW + FLARE_LIP.xOff),
        FLARE_LIP.yCenter,
        z,
      );
      // Outer secondary lip
      box(g, 0.12, 0.08, 0.76, PAL.blackSoft, sx * (halfW + 0.08), 0.36, z);
      // Front/rear arch cheeks (mid open so spring/bar stay visible)
      box(
        g,
        0.14,
        0.28,
        0.14,
        PAL.black,
        sx * (halfW + FLARE_LIP.xOff),
        0.12,
        z + 0.28,
      );
      box(
        g,
        0.14,
        0.28,
        0.14,
        PAL.black,
        sx * (halfW + FLARE_LIP.xOff),
        0.12,
        z - 0.28,
      );
    }
  }

  // ===== Rear body / tailgate / spare =====
  const tailH = 0.62 * bodyScaleY;
  box(g, bodyW * 0.98, tailH, 0.18, PAL.body, 0, beltY - tailH * 0.45, -1.28, "tailgate");
  box(g, bodyW * 0.98, 0.1, 0.14, PAL.black, 0, roofY, -1.18, "roof-rear-lip");
  box(g, 0.4, 0.05, 0.04, PAL.orange, 0, roofY + 0.06, -1.16);
  // Tail / brake lamps (emissive toggled by setJeepBrakeLights)
  addBrakeLamp(g, -halfW + 0.14, 0.42 * bodyScaleY, -1.38);
  addBrakeLamp(g, halfW - 0.14, 0.42 * bodyScaleY, -1.38);
  // Center high-mount stop lamp on rear roof lip
  const chmsl = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.045, 0.04),
    makeBrakeLensMaterial(),
  );
  chmsl.name = "brake-light-chmsl";
  chmsl.userData.isBrakeLight = true;
  chmsl.position.set(0, roofY + 0.02, -1.2);
  g.add(chmsl);
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

    // Slightly meatier than physics radius for Rubicon stance
    const tireR = r * 1.1;
    const tireW = VISUAL_TIRE_WIDTH;
    const tire = new THREE.Mesh(
      new THREE.CylinderGeometry(tireR, tireR, tireW, 14),
      mat(PAL.tire),
    );
    tire.name = `wheel-mesh-${i}`;
    tire.rotation.z = Math.PI / 2;
    // Rapier rest length is hardpoint → wheel center (not to ground).
    tire.position.set(0, -rest, 0);

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

    // Lateral suspension: crossbars + spring → inner tire face (hub side)
    createSuspensionLink(g, i, hardpoint, side, halfW, tireW);
  });

  // Initial pose at rest (before first physics sample)
  const restYOff = -rest;
  for (const link of getSuspensionLinks(g)) {
    const hard = link.userData.hardpoint as {
      x: number;
      y: number;
      z: number;
    };
    updateSuspensionLink(link, hard, restYOff);
  }

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

function getSuspensionLinks(mesh: THREE.Group): THREE.Group[] {
  const links: THREE.Group[] = [];
  for (const child of mesh.children) {
    if (child.name.startsWith("susp-link-")) {
      links.push(child as THREE.Group);
    }
  }
  links.sort(
    (a, b) =>
      (a.userData.wheelIndex as number) - (b.userData.wheelIndex as number),
  );
  return links;
}

/**
 * Each frame:
 *   volume mid = hard + (0, yOff, 0)  — matches tire mesh center
 *   hub seat   = volume mid inset toward body by tireHalfW (inner face)
 *   spring / crossbar: fixed arch/root → hub seat
 *
 * Arch never moves; only the hub end tracks suspension.
 */
function updateSuspensionLink(
  link: THREE.Group,
  hard: { x: number; y: number; z: number },
  yOff: number,
): void {
  const arch = link.userData.archLocal as { x: number; y: number; z: number };
  const root = link.userData.barRootLocal as {
    x: number;
    y: number;
    z: number;
  };
  const side = (link.userData.side as number) ?? 1;
  const tireHalfW =
    (link.userData.tireHalfW as number) ?? VISUAL_TIRE_WIDTH * 0.5;

  // Inner face center: toward chassis (x→0), not mid-volume of the fat tire.
  // side +1 = right wheel → inner is −X; side −1 = left → inner is +X.
  const hubX = hard.x - side * tireHalfW;
  const hubY = hard.y + yOff;
  const hubZ = hard.z;

  // --- Hub marker on inner tire face ---
  const hubBall = link.getObjectByName("hub-ball");
  if (hubBall) {
    hubBall.position.set(hubX, hubY, hubZ);
  }

  // Arch plate stays fixed on lip underside (do not follow suspension)
  const archPlate = link.getObjectByName("arch-plate");
  if (archPlate) {
    archPlate.position.set(arch.x, arch.y - 0.02, arch.z);
  }
  const rootBall = link.getObjectByName("root-ball");
  if (rootBall) {
    rootBall.position.set(root.x, root.y, root.z);
  }

  // --- Spring: FIXED arch → inner hub face ---
  // Ends always span arch→hub. Do NOT re-pack coil local Y toward center —
  // that pulled the orange rings off the arch when compressed. Compression is
  // already shown by placeUnitCylinder shortening the whole strut (scale.y=len).
  _suspFrom.set(arch.x, arch.y, arch.z);
  _suspTo.set(hubX, hubY, hubZ);
  const spring = link.getObjectByName("spring");
  if (spring) {
    placeUnitCylinder(spring, _suspFrom, _suspTo, 1);
    for (const child of spring.children) {
      if (child.name !== "coil") continue;
      const baseY = (child.userData.baseY as number) ?? 0;
      child.position.y = baseY; // fixed local seats; world spacing follows strut length
    }
  }

  // --- Thick crossbar: FIXED body → inner hub face ---
  const bar = link.getObjectByName("crossbar");
  if (bar) {
    _suspFrom.set(root.x, root.y, root.z);
    _suspTo.set(hubX, hubY, hubZ);
    placeUnitCylinder(bar, _suspFrom, _suspTo, 1);
  }
  // Parallel bar slightly below for readability
  const bar2 = link.getObjectByName("crossbar-2");
  if (bar2) {
    _suspFrom.set(root.x, root.y - 0.05, root.z);
    _suspTo.set(hubX, hubY - 0.02, hubZ);
    placeUnitCylinder(bar2, _suspFrom, _suspTo, 1);
  }
}

/** Dark red when off; bright emissive when braking. */
function makeBrakeLensMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    color: 0x3a0808,
    emissive: 0x1a0000,
    emissiveIntensity: 0.35,
    flatShading: true,
  });
}

function addBrakeLamp(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
): void {
  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.32, 0.06),
    mat(PAL.blackSoft),
  );
  housing.position.set(x, y, z);
  housing.name = "brake-housing";
  parent.add(housing);

  const lens = new THREE.Mesh(
    new THREE.BoxGeometry(0.11, 0.26, 0.05),
    makeBrakeLensMaterial(),
  );
  lens.name = "brake-light";
  lens.userData.isBrakeLight = true;
  lens.position.set(x, y, z - 0.04);
  parent.add(lens);
}

/**
 * Hide greenhouse glass in first person so the cabin view is not fogged.
 * Tagged with `userData.isGlass` at mesh build time.
 */
export function setJeepGlassVisible(mesh: THREE.Object3D, visible: boolean): void {
  mesh.traverse((o) => {
    if (o.userData?.isGlass) o.visible = visible;
  });
}

/**
 * Toggle rear brake lamps (side pair + CHMSL). Lit on service / opposite-throttle brake.
 */
export function setJeepBrakeLights(mesh: THREE.Object3D, on: boolean): void {
  mesh.traverse((o) => {
    if (!o.userData?.isBrakeLight) return;
    const m = o as THREE.Mesh;
    const mat = m.material as THREE.MeshLambertMaterial;
    if (!mat || !("emissive" in mat)) return;
    if (on) {
      mat.color.setHex(0xff2a1a);
      mat.emissive.setHex(0xff1808);
      mat.emissiveIntensity = 1.35;
    } else {
      mat.color.setHex(0x3a0808);
      mat.emissive.setHex(0x1a0000);
      mat.emissiveIntensity = 0.35;
    }
  });
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

  const rest = VEHICLE_CONFIG.suspRestLength;
  const pivots = getWheelPivots(mesh);
  const links = getSuspensionLinks(mesh);

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

    // Rapier suspension_length is already hardpoint → wheel center.
    // Do NOT subtract radius again (that floated tires by ~wheelRadius).
    const yOff = -suspLen;
    for (const child of pivot.children) {
      child.position.set(0, yOff, 0);
      const m = child as THREE.Mesh;
      if (!m.isMesh) continue;
      m.rotation.z = Math.PI / 2;
      const base = (m.userData.baseSpin as number | undefined) ?? 0;
      m.rotation.x = spin + base;
    }

    // Spring/damper follow wheel hub
    const link = links[i];
    if (link) {
      updateSuspensionLink(link, hard, yOff);
    }
  }
}
