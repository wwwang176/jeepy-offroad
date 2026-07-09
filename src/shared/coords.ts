/** Shared world <-> heightmap index mapping used by levelgen, collider, mesh, minimap. */

export function cellSize(worldSize: number, resolution: number): number {
  return worldSize / (resolution - 1);
}

export function worldOrigin(worldSize: number): number {
  return -worldSize / 2;
}

export function idx(resolution: number, col: number, row: number): number {
  return row * resolution + col;
}

export function worldToGrid(
  x: number,
  z: number,
  worldSize: number,
  resolution: number,
): { col: number; row: number; fx: number; fz: number } {
  const origin = worldOrigin(worldSize);
  const cell = cellSize(worldSize, resolution);
  const u = (x - origin) / cell;
  const v = (z - origin) / cell;
  const col = Math.floor(u);
  const row = Math.floor(v);
  return { col, row, fx: u - col, fz: v - row };
}

export function gridToWorld(
  col: number,
  row: number,
  worldSize: number,
  resolution: number,
): { x: number; z: number } {
  const origin = worldOrigin(worldSize);
  const cell = cellSize(worldSize, resolution);
  return { x: origin + col * cell, z: origin + row * cell };
}

/** Heightfield collider translation: centered at origin; samples span worldSize on XZ. */
export function heightfieldWorldCenter(): { x: number; y: number; z: number } {
  return { x: 0, y: 0, z: 0 };
}
