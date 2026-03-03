import { distance } from './geometry';
import { NavigationGraph } from './graph';

export interface AStarGraphOptions {
  graph: NavigationGraph;
  startNodeId: string;
  endNodeId: string;
}

export interface AStarGraphResult {
  found: boolean;
  nodeIds: string[];
  distance: number;
  visitedCount: number;
  error?: string;
}

interface HeapEntry {
  nodeId: string;
  fScore: number;
  gScore: number;
}

class MinHeap {
  private items: HeapEntry[] = [];

  get size(): number {
    return this.items.length;
  }

  push(entry: HeapEntry): void {
    this.items.push(entry);
    this.bubbleUp(this.items.length - 1);
  }

  pop(): HeapEntry {
    const first = this.items[0];
    const last = this.items.pop()!;

    if (this.items.length > 0) {
      this.items[0] = last;
      this.sinkDown(0);
    }

    return first;
  }

  private bubbleUp(index: number): void {
    const entry = this.items[index];

    while (index > 0) {
      const parentIndex = (index - 1) >> 1;
      if (this.items[parentIndex].fScore <= entry.fScore) {
        break;
      }
      this.items[index] = this.items[parentIndex];
      index = parentIndex;
    }

    this.items[index] = entry;
  }

  private sinkDown(index: number): void {
    const length = this.items.length;
    const entry = this.items[index];

    while (true) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      let smallestIndex = index;

      if (leftIndex < length && this.items[leftIndex].fScore < this.items[smallestIndex].fScore) {
        smallestIndex = leftIndex;
      }

      if (rightIndex < length && this.items[rightIndex].fScore < this.items[smallestIndex].fScore) {
        smallestIndex = rightIndex;
      }

      if (smallestIndex === index) {
        break;
      }

      this.items[index] = this.items[smallestIndex];
      this.items[smallestIndex] = entry;
      index = smallestIndex;
    }
  }
}

export function aStarGraphPath(options: AStarGraphOptions): AStarGraphResult {
  const { graph, startNodeId, endNodeId } = options;

  const startNode = graph.nodes.get(startNodeId);
  const endNode = graph.nodes.get(endNodeId);

  if (!startNode || !endNode) {
    return {
      found: false,
      nodeIds: [],
      distance: 0,
      visitedCount: 0,
      error: 'Start or end node does not exist in the graph.',
    };
  }

  if (startNodeId === endNodeId) {
    return {
      found: true,
      nodeIds: [startNodeId],
      distance: 0,
      visitedCount: 1,
    };
  }

  const openHeap = new MinHeap();
  const closed = new Set<string>();
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>();

  const heuristic = (nodeId: string): number => {
    const node = graph.nodes.get(nodeId)!;
    return distance(node.point, endNode.point);
  };

  gScore.set(startNodeId, 0);
  openHeap.push({
    nodeId: startNodeId,
    gScore: 0,
    fScore: heuristic(startNodeId),
  });

  while (openHeap.size > 0) {
    const current = openHeap.pop();

    if (closed.has(current.nodeId)) {
      continue;
    }

    if (current.nodeId === endNodeId) {
      const nodeIds = reconstructPath(cameFrom, endNodeId);
      return {
        found: true,
        nodeIds,
        distance: gScore.get(endNodeId) ?? 0,
        visitedCount: closed.size + 1,
      };
    }

    closed.add(current.nodeId);

    for (const neighbor of graph.adjacency.get(current.nodeId) ?? []) {
      if (closed.has(neighbor.nodeId)) {
        continue;
      }

      const tentativeGScore = (gScore.get(current.nodeId) ?? Number.POSITIVE_INFINITY) + neighbor.weight;
      const existingGScore = gScore.get(neighbor.nodeId) ?? Number.POSITIVE_INFINITY;

      if (tentativeGScore >= existingGScore) {
        continue;
      }

      cameFrom.set(neighbor.nodeId, current.nodeId);
      gScore.set(neighbor.nodeId, tentativeGScore);
      openHeap.push({
        nodeId: neighbor.nodeId,
        gScore: tentativeGScore,
        fScore: tentativeGScore + heuristic(neighbor.nodeId),
      });
    }
  }

  return {
    found: false,
    nodeIds: [],
    distance: 0,
    visitedCount: closed.size,
    error: 'No path exists between the requested graph nodes.',
  };
}

function reconstructPath(cameFrom: Map<string, string>, endNodeId: string): string[] {
  const nodeIds = [endNodeId];
  let currentNodeId = endNodeId;

  while (cameFrom.has(currentNodeId)) {
    currentNodeId = cameFrom.get(currentNodeId)!;
    nodeIds.push(currentNodeId);
  }

  nodeIds.reverse();
  return nodeIds;
}
