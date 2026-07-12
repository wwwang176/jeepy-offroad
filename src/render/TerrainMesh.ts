import * as THREE from "three";
import type { LevelData } from "@/levelgen/types";
import type { BiomeProfile } from "@/biome/types";
import { gridToWorld, idx } from "@/shared/coords";
import {
  buildTerrainColorContext,
  terrainAlbedoAt,
} from "@/shared/terrainColor";

/**
 * Grid mesh matching heightfield collider: same samples, origin, and world size.
 * Vertex colors from biome palette + path ribbon (shared terrainColor helpers).
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

  const colorCtx = buildTerrainColorContext({
    groundPalette: biome.groundPalette,
    heightmap: level.heightmap,
    pathPolyline: level.pathPolyline,
    pathWidth: biome.pathWidth,
    terrainColorMode: biome.terrainColorMode,
  });

  for (let row = 0; row < res; row++) {
    for (let col = 0; col < res; col++) {
      const vi = row * res + col;
      const { x, z } = gridToWorld(col, row, worldSize, res);
      const y = level.heightmap[idx(res, col, row)];
      positions[vi * 3] = x;
      positions[vi * 3 + 1] = y;
      positions[vi * 3 + 2] = z;

      const albedo = terrainAlbedoAt(x, z, y, colorCtx);
      // Feed sRGB-ish 0–1 into THREE.Color so MeshLambert matches prior look.
      const c = new THREE.Color(albedo.r, albedo.g, albedo.b);
      colors[vi * 3] = c.r;
      colors[vi * 3 + 1] = c.g;
      colors[vi * 3 + 2] = c.b;
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
