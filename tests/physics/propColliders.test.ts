import { describe, expect, it } from "vitest";
import {
  isCollidableRockMesh,
  localColliderSpecs,
  quatFromEulerYXZ,
} from "@/physics/propColliders";
import { getBiome } from "@/biome/registry";

describe("propColliders", () => {
  it("marks only rock_pile and pillar_rock as collidable mesh keys", () => {
    expect(isCollidableRockMesh("rock_pile")).toBe(true);
    expect(isCollidableRockMesh("pillar_rock")).toBe(true);
    expect(isCollidableRockMesh("cactus")).toBe(false);
    expect(isCollidableRockMesh("coconut_palm")).toBe(false);
  });

  it("sand and rainforest rock rules set collides true", () => {
    const sand = getBiome("sand");
    const rf = getBiome("rainforest");
    for (const b of [sand, rf]) {
      for (const rule of b.propTable) {
        if (rule.meshKey === "rock_pile" || rule.meshKey === "pillar_rock") {
          expect(rule.collides).toBe(true);
        }
      }
    }
    expect(sand.propTable.some((r) => r.meshKey === "pillar_rock")).toBe(true);
    expect(rf.propTable.some((r) => r.meshKey === "pillar_rock")).toBe(false);
  });

  it("rock_pile local specs are 3 scaled balls", () => {
    const specs = localColliderSpecs("rock_pile", 1);
    expect(specs).toHaveLength(3);
    expect(specs.every((s) => s.kind === "ball")).toBe(true);
    const balls = specs.filter((s) => s.kind === "ball");
    expect(balls[0].radius).toBeCloseTo(0.7);
    expect(balls[1].radius).toBeCloseTo(0.5);
    expect(balls[2].radius).toBeCloseTo(0.4);
    expect(balls[0].ty).toBeCloseTo(0.25);

    const scaled = localColliderSpecs("rock_pile", 2);
    expect(scaled[0].kind === "ball" && scaled[0].radius).toBeCloseTo(1.4);
    expect(scaled[1].kind === "ball" && scaled[1].tx).toBeCloseTo(0.7);
  });

  it("pillar_rock is a Y cylinder at mid height", () => {
    const specs = localColliderSpecs("pillar_rock", 1);
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      kind: "cylinder",
      halfHeight: 1.1,
      radius: 0.5,
      ty: 1.1,
    });
  });

  it("quatFromEulerYXZ is identity at zero and normalizes", () => {
    const id = quatFromEulerYXZ(0, 0, 0);
    expect(id.x).toBeCloseTo(0);
    expect(id.y).toBeCloseTo(0);
    expect(id.z).toBeCloseTo(0);
    expect(id.w).toBeCloseTo(1);

    const q = quatFromEulerYXZ(0.2, 1.1, -0.3);
    const len = Math.hypot(q.x, q.y, q.z, q.w);
    expect(len).toBeCloseTo(1, 5);
  });

  it("pure yaw matches half-angle formula", () => {
    const yaw = Math.PI / 2;
    const q = quatFromEulerYXZ(0, yaw, 0);
    expect(q.x).toBeCloseTo(0);
    expect(q.y).toBeCloseTo(Math.sin(yaw / 2));
    expect(q.z).toBeCloseTo(0);
    expect(q.w).toBeCloseTo(Math.cos(yaw / 2));
  });
});
