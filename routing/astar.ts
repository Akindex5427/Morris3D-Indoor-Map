/**
 * astar.ts
 * --------
 * A* pathfinding on the occupancy grid produced by grid.ts.
 *
 * Features:
 *   - 8-directional movement with correct diagonal cost (√2 × cellSize)
 *   - Euclidean distance heuristic (admissible → optimal paths)
 *   - Binary min-heap priority queue (O(log n) push/pop, no external deps)
 *   - Path smoothing via line-of-sight: removes redundant waypoints while
 *     keeping the path clear of obstacles
 *   - No recursion anywhere
 *
 * Usage example:
 *   const cells = aStarGridPath({ grid, startCell: {i:2,j:3}, endCell: {i:40,j:60} });
 *   const worldPath = smoothPath(cells, cellToWorld, obstaclePolygons);
 */

import { Point2D, MultiPolygon, segmentIntersectsAnyPolygon, distance } from './geometry';
import { OccupancyGrid } from './grid';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CellCoord {
  i: number;
  j: number;
}

export interface AStarOptions {
  grid: OccupancyGrid;
  startCell: CellCoord;
  endCell: CellCoord;
}

export interface AStarResult {
  found: boolean;
  cells: CellCoord[];
}

// ---------------------------------------------------------------------------
// Binary min-heap
// ---------------------------------------------------------------------------

interface HeapNode {
  f: number; // f = g + h
  g: number; // cost so far
  idx: number; // encoded cell index
}

class MinHeap {
  private data: HeapNode[] = [];

  get size(): number {
    return this.data.length;
  }

  push(node: HeapNode): void {
    this.data.push(node);
    this._bubbleUp(this.data.length - 1);
  }

  pop(): HeapNode {
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  private _bubbleUp(pos: number): void {
    const node = this.data[pos];
    while (pos > 0) {
      const parent = (pos - 1) >> 1;
      if (this.data[parent].f <= node.f) break;
      this.data[pos] = this.data[parent];
      pos = parent;
    }
    this.data[pos] = node;
  }

  private _sinkDown(pos: number): void {
    const n = this.data.length;
    const node = this.data[pos];
    while (true) {
      const left = (pos << 1) + 1;
      const right = left + 1;
      let smallest = pos;

      if (left < n && this.data[left].f < this.data[smallest].f) smallest = left;
      if (right < n && this.data[right].f < this.data[smallest].f) smallest = right;
      if (smallest === pos) break;

      this.data[pos] = this.data[smallest];
      this.data[smallest] = node;
      pos = smallest;
    }
  }
}

// ---------------------------------------------------------------------------
// 8-directional movement table
// [di, dj, cost multiplier]
// Straight: cost 1.0 × cellSize, diagonal: cost √2 × cellSize
// ---------------------------------------------------------------------------

const SQRT2 = Math.SQRT2;

const DIRS: [number, number, number][] = [
  [-1,  0, 1.0],
  [ 1,  0, 1.0],
  [ 0, -1, 1.0],
  [ 0,  1, 1.0],
  [-1, -1, SQRT2],
  [-1,  1, SQRT2],
  [ 1, -1, SQRT2],
  [ 1,  1, SQRT2],
];

// ---------------------------------------------------------------------------
// A* grid pathfinding
// ---------------------------------------------------------------------------

/**
 * Run A* on the occupancy grid.  Returns an ordered list of cell coordinates
 * from startCell (exclusive) to endCell (inclusive), or an empty list if
 * no path exists.
 *
 * Example:
 *   const result = aStarGridPath({
 *     grid: myGrid,
 *     startCell: { i: 5, j: 3 },
 *     endCell:   { i: 42, j: 60 },
 *   });
 *   if (result.found) console.log(result.cells.length, 'waypoints');
 */
export function aStarGridPath(options: AStarOptions): AStarResult {
  const { grid, startCell, endCell } = options;
  const { grid: walkable, rows, cols, cellToWorld, cellSizeMeters } = grid;

  const encode = (i: number, j: number) => i * cols + j;
  const decode = (idx: number): CellCoord => ({ i: Math.floor(idx / cols), j: idx % cols });

  const startIdx = encode(startCell.i, startCell.j);
  const endIdx   = encode(endCell.i,   endCell.j);

  if (startIdx === endIdx) return { found: true, cells: [startCell] };

  // g-score map (Float32Array is much faster than a Map for dense grids)
  const gScore = new Float32Array(rows * cols).fill(Infinity);
  gScore[startIdx] = 0;

  // parent map for path reconstruction
  const parent = new Int32Array(rows * cols).fill(-1);

  // Closed set as a typed array flag
  const closed = new Uint8Array(rows * cols);

  // Euclidean heuristic in metres
  const endWorld = cellToWorld(endCell.i, endCell.j);
  function heuristic(i: number, j: number): number {
    const w = cellToWorld(i, j);
    const dx = w.x - endWorld.x;
    const dy = w.y - endWorld.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  const heap = new MinHeap();
  heap.push({ f: heuristic(startCell.i, startCell.j), g: 0, idx: startIdx });

  while (heap.size > 0) {
    const { g: currentG, idx: currentIdx } = heap.pop();

    if (closed[currentIdx]) continue;
    closed[currentIdx] = 1;

    if (currentIdx === endIdx) {
      // Reconstruct path
      const cells: CellCoord[] = [];
      let idx = endIdx;
      while (idx !== -1) {
        cells.push(decode(idx));
        idx = parent[idx];
      }
      cells.reverse();
      return { found: true, cells };
    }

    const ci = Math.floor(currentIdx / cols);
    const cj = currentIdx % cols;

    for (const [di, dj, costMul] of DIRS) {
      const ni = ci + di;
      const nj = cj + dj;

      if (ni < 0 || ni >= rows || nj < 0 || nj >= cols) continue;
      if (!walkable[ni][nj]) continue;

      const nIdx = encode(ni, nj);
      if (closed[nIdx]) continue;

      // For diagonal moves, also check that both cardinal neighbours are walkable
      // (prevents cutting through corners)
      if (di !== 0 && dj !== 0) {
        if (!walkable[ci + di][cj] || !walkable[ci][cj + dj]) continue;
      }

      const tentativeG = currentG + costMul * cellSizeMeters;
      if (tentativeG < gScore[nIdx]) {
        gScore[nIdx] = tentativeG;
        parent[nIdx] = currentIdx;
        heap.push({ f: tentativeG + heuristic(ni, nj), g: tentativeG, idx: nIdx });
      }
    }
  }

  return { found: false, cells: [] };
}

// ---------------------------------------------------------------------------
// Path smoothing (line-of-sight / string pulling)
// ---------------------------------------------------------------------------

/**
 * Convert grid cells to world points, then remove unnecessary intermediate
 * waypoints using a greedy line-of-sight check.
 *
 * A segment from A to B is "clear" if it does not intersect any obstacle
 * polygon edge and its midpoint is not inside an obstacle.
 *
 * The smoothed path always starts at cells[0] and ends at cells[last].
 *
 * Example:
 *   const worldPts = smoothPath(cells, grid.cellToWorld, projectedObstacles);
 *   // worldPts is an array of Point2D in planar metres
 */
export function smoothPath(
  pathCells: CellCoord[],
  cellToWorld: (i: number, j: number) => Point2D,
  obstaclePolygons: MultiPolygon
): Point2D[] {
  if (pathCells.length === 0) return [];
  if (pathCells.length === 1) return [cellToWorld(pathCells[0].i, pathCells[0].j)];

  const worldPts: Point2D[] = pathCells.map((c) => cellToWorld(c.i, c.j));

  if (obstaclePolygons.length === 0) {
    // No obstacles → keep only start and end
    return [worldPts[0], worldPts[worldPts.length - 1]];
  }

  const result: Point2D[] = [worldPts[0]];
  let anchor = 0;

  while (anchor < worldPts.length - 1) {
    // Try to jump as far forward as possible without hitting an obstacle
    let furthest = anchor + 1;
    for (let k = worldPts.length - 1; k > anchor + 1; k--) {
      if (!segmentIntersectsAnyPolygon(worldPts[anchor], worldPts[k], obstaclePolygons)) {
        furthest = k;
        break;
      }
    }
    result.push(worldPts[furthest]);
    anchor = furthest;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Total path length in metres
// ---------------------------------------------------------------------------

/**
 * Compute the total Euclidean length (metres) of a world-space path.
 */
export function pathLength(pts: Point2D[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += distance(pts[i - 1], pts[i]);
  }
  return len;
}
