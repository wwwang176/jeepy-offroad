import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  createJeepMesh,
  setJeepBrakeLights,
  setJeepGlassVisible,
} from "@/render/JeepMesh";

function countMeshes(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) n++;
  });
  return n;
}

describe("createJeepMesh static merge", () => {
  it("bakes static body into color batches but keeps dynamic parts", () => {
    const jeep = createJeepMesh();

    // Wheels + suspension still addressable for sync
    expect(
      jeep.children.filter((c) => c.name.startsWith("wheel-pivot-")).length,
    ).toBe(4);
    expect(
      jeep.children.filter((c) => c.name.startsWith("susp-link-")).length,
    ).toBe(4);

    // Glass still toggleable
    const glasses: THREE.Object3D[] = [];
    jeep.traverse((o) => {
      if (o.userData?.isGlass) glasses.push(o);
    });
    expect(glasses.length).toBeGreaterThanOrEqual(3);
    setJeepGlassVisible(jeep, false);
    expect(glasses.every((g) => g.visible === false)).toBe(true);
    setJeepGlassVisible(jeep, true);

    // Brake lenses still toggleable
    const brakes: THREE.Mesh[] = [];
    jeep.traverse((o) => {
      if (o.userData?.isBrakeLight && o instanceof THREE.Mesh) brakes.push(o);
    });
    expect(brakes.length).toBeGreaterThanOrEqual(3);
    setJeepBrakeLights(jeep, true);
    const lit = brakes[0]!.material as THREE.MeshLambertMaterial;
    expect(lit.emissiveIntensity).toBeGreaterThan(1);

    // Static body baked into color batches (wheels/suspension coils still dominate total count)
    const merged = jeep.children.filter((c) => c.name.startsWith("merged-"));
    expect(merged.length).toBeGreaterThanOrEqual(4);
    expect(merged.every((m) => m instanceof THREE.Mesh)).toBe(true);

    // No leftover named static body pieces (they were peeled into merged-*)
    const leftoverStatic: string[] = [];
    jeep.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (o.name.startsWith("merged-")) return;
      if (o.name.startsWith("wheel-") || o.name === "spoke") return;
      if (o.userData?.isGlass || o.userData?.isBrakeLight) return;
      // climb for dynamic roots
      let p: THREE.Object3D | null = o;
      let dyn = false;
      while (p) {
        if (
          p.name.startsWith("wheel-pivot-") ||
          p.name.startsWith("susp-link-")
        ) {
          dyn = true;
          break;
        }
        p = p.parent;
      }
      if (!dyn && o.name) leftoverStatic.push(o.name);
    });
    expect(leftoverStatic).toEqual([]);

    // Total meshes still include 4×(wheel + susp coil stacks)
    expect(countMeshes(jeep)).toBeGreaterThan(80);
  });
});
