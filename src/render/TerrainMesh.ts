import * as THREE from "three";
import type { LevelData } from "@/levelgen/types";
import type { BiomeProfile } from "@/biome/types";
import { gridToWorld, idx } from "@/shared/coords";

function parseColor(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

function pathProximity(
  x: number,
  z: number,
  path: LevelData["pathPolyline"],
  halfWidth: number,
): number {
  let minD = Infinity;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < minD) minD = d;
  }
  if (minD >= halfWidth) return 0;
  return 1 - minD / halfWidth;
}

/**
 * Grid mesh matching heightfield collider: same samples, origin, and world size.
 * Vertex colors from biome palette + path ribbon.
 *
 * Uses THREE.Color so hex is converted into the working (linear) color space —
 * raw 0–1 sRGB channel writes look washed-out / too bright under MeshLambert.
 */
export function createTerrainMesh(
  level: LevelData,
  biome: BiomeProfile,
): THREE.Mesh {
  const res = level.resolution;
  const worldSize = level.worldSize;
  const positions = new Float32Array(res * res * 3);
  const colors = new Float32Array(res * res * 3);
  const indices: number[] = [];

  const colHigh = parseColor(biome.groundPalette.high);
  const colMid = parseColor(biome.groundPalette.mid);
  const colLow = parseColor(biome.groundPalette.low);
  const colPath = parseColor(biome.groundPalette.path);

  let minH = Infinity;
  let maxH = -Infinity;
  for (let i = 0; i < level.heightmap.length; i++) {
    const h = level.heightmap[i];
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }
  const hRange = Math.max(1e-3, maxH - minH);
  const pathHalf = (biome.pathWidth ?? 4) * 0.75;

  for (let row = 0; row < res; row++) {
    for (let col = 0; col < res; col++) {
      const vi = row * res + col;
      const { x, z } = gridToWorld(col, row, worldSize, res);
      const y = level.heightmap[idx(res, col, row)];
      positions[vi * 3] = x;
      positions[vi * 3 + 1] = y;
      positions[vi * 3 + 2] = z;

      const t = (y - minH) / hRange;
      const ground = new THREE.Color();
      if (t < 0.45) {
        ground.copy(colLow).lerp(colMid, t / 0.45);
      } else {
        ground.copy(colMid).lerp(colHigh, (t - 0.45) / 0.55);
      }
      const pathW = pathProximity(x, z, level.pathPolyline, pathHalf);
      if (pathW > 0) {
        ground.lerp(colPath, Math.min(1, pathW * 1.2));
      }
      colors[vi * 3] = ground.r;
      colors[vi * 3 + 1] = ground.g;
      colors[vi * 3 + 2] = ground.b;
    }
  }

  for (let row = 0; row < res - 1; row++) {
    for (let col = 0; col < res - 1; col++) {
      const a = row * res + col;
      const b = row * res + col + 1;
      const c = (row + 1) * res + col;
      const d = (row + 1) * res + col + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "terrain";
  mesh.receiveShadow = true;
  return mesh;
}
