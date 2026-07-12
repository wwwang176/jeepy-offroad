import * as THREE from "three";
import type { LevelData } from "@/levelgen/types";
import type { SnowCoverConfig } from "@/shared/snowCover";
import { buildSnowCoverMask } from "@/shared/snowCover";
import { cellSize, gridToWorld, idx } from "@/shared/coords";

/**
 * Build a draped snow blanket mesh over the heightfield (like water: visual
 * only, no collider). Vertices follow terrain Y + lift so snow wraps slopes.
 */
export function createSnowCoverMesh(
  level: LevelData,
  cfg: SnowCoverConfig,
  pathWidth?: number,
): THREE.Mesh | null {
  const res = level.resolution;
  const worldSize = level.worldSize;
  const lift = cfg.liftM > 0 ? cfg.liftM : 0.12;
  const pathHalf = (pathWidth ?? 4) * 0.75;

  const mask = buildSnowCoverMask({
    heightmap: level.heightmap,
    resolution: res,
    worldSize,
    pathPolyline: level.pathPolyline,
    pathHalfWidth: pathHalf,
    cfg,
    gridToWorld,
  });

  let snowCells = 0;
  for (let i = 0; i < mask.length; i++) snowCells += mask[i]!;
  if (snowCells < 8) return null;

  // Compact vertex index per grid cell (-1 = no snow)
  const vertOf = new Int32Array(res * res).fill(-1);
  const positions: number[] = [];
  let vCount = 0;

  for (let row = 0; row < res; row++) {
    for (let col = 0; col < res; col++) {
      const i = idx(res, col, row);
      if (!mask[i]) continue;
      // Include cell if it or any neighbor is snow (smoother edge)
      const { x, z } = gridToWorld(col, row, worldSize, res);
      const y = level.heightmap[i]! + lift;
      vertOf[i] = vCount++;
      positions.push(x, y, z);
    }
  }

  const indices: number[] = [];
  for (let row = 0; row < res - 1; row++) {
    for (let col = 0; col < res - 1; col++) {
      const a = vertOf[idx(res, col, row)]!;
      const b = vertOf[idx(res, col + 1, row)]!;
      const c = vertOf[idx(res, col, row + 1)]!;
      const d = vertOf[idx(res, col + 1, row + 1)]!;
      // Emit quads only where all four corners have snow (solid blanket)
      if (a >= 0 && b >= 0 && c >= 0 && d >= 0) {
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  if (indices.length < 3) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(new Float32Array(positions), 3),
  );
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const color = new THREE.Color(cfg.color);
  const opacity = cfg.opacity ?? 0.94;
  const mat = new THREE.MeshLambertMaterial({
    color,
    flatShading: true,
    transparent: opacity < 0.999,
    opacity,
    depthWrite: opacity >= 0.9,
    // Sit visually on top of terrain without z-fight
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "snow-cover";
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = true;
  // No physics — decorative only (same contract as pond water)
  mesh.userData.noCollision = true;

  // Keep cell size in userData for debug
  mesh.userData.cellSize = cellSize(worldSize, res);
  return mesh;
}
