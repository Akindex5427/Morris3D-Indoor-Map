/**
 * grid.ts
 * -------
 * Builds a boolean occupancy grid from walkable and obstacle polygons.
 *
 * Coordinate convention
 * ---------------------
 *   World space  : planar metres (EPSG:3857), X = easting, Y = northing.
 *   Grid space   : integer (row i, col j).
 *     - row i increases northward  (Y increases → i increases)
 *     - col j increases eastward   (X increases → j increases)
 *   Origin of the grid = (floorBounds.minX, floorBounds.minY)
 *
 * A cell (i, j) is walkable if:
 *   1. Its centre point is inside at least one walkable polygon, AND
 *   2. Its centre point is NOT inside any obstacle polygon.
 *
 * Usage example:
 *   const result = buildOccupancyGrid({
 *     walkablePolygons: projectedWalkable,
 *     obstaclePolygons: projectedObstacles,
 *     cellSizeMeters: 0.5,
 *     floorBounds: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
 *   });
 *   // result.grid[10][20] === true  → cell (row=10, col=20) is passable
 *   const {x, y} = result.cellToWorld(10, 20);
 *   const {i, j} = result.worldToCell(x, y);
 */

import {
  Point2D,
  MultiPolygon,
  AABB,
  pointInPolygon,
  pointInMultiPolygon,
} from './geometry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OccupancyGrid {
  /** grid[row][col] === true means the cell is walkable */
  grid: boolean[][];
  rows: number;
  cols: number;
  cellSizeMeters: number;
  bounds: AABB;

  /**
   * Convert world coordinates (planar metres) → nearest grid cell indices.
   * Returns clamped indices — never out of range.
   */
  worldToCell(x: number, y: number): { i: number; j: number };

  /**
   * Convert grid cell (row i, col j) → world centre point (planar metres).
   */
  cellToWorld(i: number, j: number): Point2D;

  /**
   * Given a potentially non-walkable cell (i, j), return the nearest
   * walkable cell using BFS.  Returns null if none found within the grid.
   */
  findNearestWalkableCell(i: number, j: number): { i: number; j: number } | null;
}

export interface BuildGridOptions {
  walkablePolygons: MultiPolygon;
  obstaclePolygons: MultiPolygon;
  cellSizeMeters: number;
  floorBounds: AABB;
}

// ---------------------------------------------------------------------------
// buildOccupancyGrid
// ---------------------------------------------------------------------------

/**
 * Build an occupancy grid from projected (planar metres) walkable and obstacle polygons.
 *
 * @param options  See BuildGridOptions
 * @returns        OccupancyGrid with helper methods attached
 */
export function buildOccupancyGrid(options: BuildGridOptions): OccupancyGrid {
  const { walkablePolygons, obstaclePolygons, cellSizeMeters, floorBounds } = options;

  const { minX, minY, maxX, maxY } = floorBounds;

  // Grid dimensions — add 1 to include the upper edge
  const cols = Math.ceil((maxX - minX) / cellSizeMeters) + 1;
  const rows = Math.ceil((maxY - minY) / cellSizeMeters) + 1;

  // -----------------------------------------------------------------------
  // Pre-compute bounding boxes for each obstacle polygon for fast rejection.
  // A cell that doesn't overlap any obstacle AABB cannot be inside one.
  // -----------------------------------------------------------------------
  interface PolygonEntry {
    poly: MultiPolygon[number];
    minX: number; minY: number; maxX: number; maxY: number;
  }
  const obstacleMeta: PolygonEntry[] = obstaclePolygons.map((poly) => {
    let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
    for (const ring of poly) {
      for (const [x, y] of ring) {
        if (x < bMinX) bMinX = x;
        if (y < bMinY) bMinY = y;
        if (x > bMaxX) bMaxX = x;
        if (y > bMaxY) bMaxY = y;
      }
    }
    return { poly, minX: bMinX, minY: bMinY, maxX: bMaxX, maxY: bMaxY };
  });

  const walkableMeta: PolygonEntry[] = walkablePolygons.map((poly) => {
    let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
    for (const ring of poly) {
      for (const [x, y] of ring) {
        if (x < bMinX) bMinX = x;
        if (y < bMinY) bMinY = y;
        if (x > bMaxX) bMaxX = x;
        if (y > bMaxY) bMaxY = y;
      }
    }
    return { poly, minX: bMinX, minY: bMinY, maxX: bMaxX, maxY: bMaxY };
  });

  // -----------------------------------------------------------------------
  // Helper: is point (px, py) inside any obstacle, using AABB pre-filter?
  // -----------------------------------------------------------------------
  function isBlocked(px: number, py: number): boolean {
    for (const meta of obstacleMeta) {
      if (px < meta.minX || px > meta.maxX || py < meta.minY || py > meta.maxY) continue;
      if (pointInPolygon({ x: px, y: py }, meta.poly)) return true;
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // Helper: is point (px, py) inside any walkable polygon?
  // -----------------------------------------------------------------------
  function isWalkable(px: number, py: number): boolean {
    for (const meta of walkableMeta) {
      if (px < meta.minX || px > meta.maxX || py < meta.minY || py > meta.maxY) continue;
      if (pointInPolygon({ x: px, y: py }, meta.poly)) return true;
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // Fill the grid.
  // Row 0 corresponds to minY (south edge).  Row (rows-1) → maxY (north edge).
  // Col 0 corresponds to minX (west edge).   Col (cols-1) → maxX (east edge).
  // -----------------------------------------------------------------------
  const grid: boolean[][] = [];

  for (let i = 0; i < rows; i++) {
    const row: boolean[] = new Array(cols).fill(false);
    // World Y of cell centre: minY + (i + 0.5) * cellSizeMeters
    const py = minY + (i + 0.5) * cellSizeMeters;

    for (let j = 0; j < cols; j++) {
      const px = minX + (j + 0.5) * cellSizeMeters;
      row[j] = isWalkable(px, py) && !isBlocked(px, py);
    }

    grid.push(row);
  }

  // -----------------------------------------------------------------------
  // Coordinate conversion helpers
  // -----------------------------------------------------------------------

  function worldToCell(x: number, y: number): { i: number; j: number } {
    // (x - minX) / cellSizeMeters gives the fractional column; floor → cell index
    const j = Math.max(0, Math.min(cols - 1, Math.floor((x - minX) / cellSizeMeters)));
    const i = Math.max(0, Math.min(rows - 1, Math.floor((y - minY) / cellSizeMeters)));
    return { i, j };
  }

  function cellToWorld(i: number, j: number): Point2D {
    // Centre of cell
    return {
      x: minX + (j + 0.5) * cellSizeMeters,
      y: minY + (i + 0.5) * cellSizeMeters,
    };
  }

  // -----------------------------------------------------------------------
  // BFS to find nearest walkable cell
  // -----------------------------------------------------------------------

  function findNearestWalkableCell(
    startI: number,
    startJ: number
  ): { i: number; j: number } | null {
    if (grid[startI]?.[startJ]) return { i: startI, j: startJ };

    // BFS using a simple queue
    const visited = new Uint8Array(rows * cols);
    const queue: number[] = []; // encoded as i * cols + j

    const encode = (i: number, j: number) => i * cols + j;
    const startIdx = encode(startI, startJ);
    visited[startIdx] = 1;
    queue.push(startIdx);

    // 8-directional neighbours
    const DIRS = [
      [-1, -1], [-1, 0], [-1, 1],
      [ 0, -1],           [ 0, 1],
      [ 1, -1], [ 1, 0], [ 1, 1],
    ];

    let head = 0;
    while (head < queue.length) {
      const idx = queue[head++];
      const ci = Math.floor(idx / cols);
      const cj = idx % cols;

      for (const [di, dj] of DIRS) {
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || ni >= rows || nj < 0 || nj >= cols) continue;
        const nIdx = encode(ni, nj);
        if (visited[nIdx]) continue;
        visited[nIdx] = 1;
        if (grid[ni][nj]) return { i: ni, j: nj };
        queue.push(nIdx);
      }
    }

    return null; // no walkable cell found in the entire grid
  }

  return {
    grid,
    rows,
    cols,
    cellSizeMeters,
    bounds: floorBounds,
    worldToCell,
    cellToWorld,
    findNearestWalkableCell,
  };
}
