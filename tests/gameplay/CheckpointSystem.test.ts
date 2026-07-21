import { describe, expect, it } from "vitest";
import { CheckpointSystem } from "@/gameplay/CheckpointSystem";
import { createHeightmap } from "@/levelgen/heightmap";
import { chassisSpawnY } from "@/shared/vehicleConfig";

describe("CheckpointSystem respawn height", () => {
  const resolution = 5;
  const worldSize = 40;
  /** Flat terrain at Y = 20 everywhere. */
  const flatHm = createHeightmap(resolution, 20);

  const terrain = {
    heightmap: flatHm,
    resolution,
    worldSize,
  };

  const start = {
    position: { x: 0, y: chassisSpawnY(20), z: -10 },
    yaw: 0.1,
  };

  it("respawns at start above sampled heightmap (not stored chassis Y alone)", () => {
    const sys = new CheckpointSystem(start, [], terrain);
    const pose = sys.getRespawnPose();
    expect(pose.position.x).toBe(0);
    expect(pose.position.z).toBe(-10);
    expect(pose.yaw).toBeCloseTo(0.1);
    expect(pose.position.y).toBeCloseTo(chassisSpawnY(20), 5);
  });

  it("uses heightmap at checkpoint XZ, not path polyline Y", () => {
    // Path Y is intentionally wrong (grade-limited / stale) — classic bury bug.
    const checkpoints = [
      {
        id: "cp_0",
        position: { x: 5, y: 2, z: 5 },
        yaw: 1.2,
        radius: 6,
      },
    ];
    const sys = new CheckpointSystem(start, checkpoints, terrain);
    sys.update({ x: 5, y: 100, z: 5 });
    const pose = sys.getRespawnPose();
    expect(pose.position.x).toBe(5);
    expect(pose.position.z).toBe(5);
    expect(pose.yaw).toBeCloseTo(1.2);
    // Must sit on heightmap 20, not chassisSpawnY(pathY=2) which buries under mesh.
    expect(pose.position.y).toBeCloseTo(chassisSpawnY(20), 5);
    expect(pose.position.y).toBeGreaterThan(chassisSpawnY(2) + 1);
  });

  it("follows a raised heightmap patch under the checkpoint", () => {
    const hm = createHeightmap(resolution, 10);
    // Raise center column so sample near origin is higher.
    for (let i = 0; i < hm.length; i++) hm[i] = 10;
    // world origin is map center; set all samples high for a simple case
    for (let i = 0; i < hm.length; i++) hm[i] = 30;

    const sys = new CheckpointSystem(
      start,
      [
        {
          id: "cp_0",
          position: { x: 0, y: 0, z: 0 },
          yaw: 0,
          radius: 6,
        },
      ],
      { heightmap: hm, resolution, worldSize },
    );
    sys.update({ x: 0, y: 0, z: 0 });
    const pose = sys.getRespawnPose();
    expect(pose.position.y).toBeCloseTo(chassisSpawnY(30), 5);
  });
});
