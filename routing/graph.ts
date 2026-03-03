import {
  closestPointOnSegment,
  createLocalProjection,
  distance,
  lerpPoint,
  LocalProjection,
  MultiPolygon,
  Point2D,
  pointInMultiPolygon,
  Polygon,
  projectPolygonWith,
  segmentIntersectionPoint,
  segmentIntersectsAnyPolygon,
} from './geometry';

// ---------------------------------------------------------------------------
// Minimal GeoJSON types
// ---------------------------------------------------------------------------

export interface GeoJSONLineStringGeometry {
  type: 'LineString';
  coordinates: [number, number][];
}

export interface GeoJSONMultiLineStringGeometry {
  type: 'MultiLineString';
  coordinates: [number, number][][];
}

export interface GeoJSONPolygonGeometry {
  type: 'Polygon';
  coordinates: [number, number][][];
}

export interface GeoJSONMultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates: [number, number][][][];
}

export type SupportedGeoJSONGeometry =
  | GeoJSONLineStringGeometry
  | GeoJSONMultiLineStringGeometry
  | GeoJSONPolygonGeometry
  | GeoJSONMultiPolygonGeometry;

export interface GeoJSONFeature<G extends SupportedGeoJSONGeometry = SupportedGeoJSONGeometry> {
  type: 'Feature';
  geometry: G | null;
  properties?: Record<string, unknown> | null;
  id?: string | number;
}

export interface GeoJSONFeatureCollection<G extends SupportedGeoJSONGeometry = SupportedGeoJSONGeometry> {
  type: 'FeatureCollection';
  features: Array<GeoJSONFeature<G>>;
}

export type GeoJSONInput =
  | SupportedGeoJSONGeometry
  | GeoJSONFeature
  | GeoJSONFeatureCollection;

// ---------------------------------------------------------------------------
// Graph types
// ---------------------------------------------------------------------------

export interface GraphNode {
  id: string;
  point: Point2D;
  componentId: number;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  weight: number;
  geometry: [Point2D, Point2D];
}

export interface GraphNeighbor {
  nodeId: string;
  edgeId: string;
  weight: number;
}

export interface NavigationGraph {
  projection: LocalProjection;
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  adjacency: Map<string, GraphNeighbor[]>;
  walkablePolygons: MultiPolygon;
  obstaclePolygons: MultiPolygon;
  nodeToleranceMeters: number;
  validationSampleStepMeters: number;
  componentCount: number;
}

export interface BuildNavigationGraphOptions {
  centerlinesGeoJSON: GeoJSONInput;
  walkableGeoJSON?: GeoJSONInput | null;
  obstaclesGeoJSON?: GeoJSONInput | null;
  nodeToleranceMeters?: number;
  validationSampleStepMeters?: number;
}

export interface GraphSnap {
  kind: 'node' | 'edge';
  point: Point2D;
  distanceMeters: number;
  componentId: number;
  nodeId?: string;
  edgeId?: string;
  edgeFromNodeId?: string;
  edgeToNodeId?: string;
  t?: number;
}

export interface SnapOptions {
  maxSnapDistanceMeters?: number;
}

export interface QueryGraphResult {
  graph: NavigationGraph;
  startNodeId: string;
  endNodeId: string;
}

interface ProjectedSegment {
  id: string;
  start: Point2D;
  end: Point2D;
  splitPoints: Array<{ t: number; point: Point2D }>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildNavigationGraph(options: BuildNavigationGraphOptions): NavigationGraph {
  const {
    centerlinesGeoJSON,
    walkableGeoJSON = null,
    obstaclesGeoJSON = null,
    nodeToleranceMeters = 0.05,
    validationSampleStepMeters = 0.5,
  } = options;

  const lineStrings = extractLineStrings(centerlinesGeoJSON);
  if (lineStrings.length === 0) {
    throw new Error('IndoorRouter: centerlinesGeoJSON contains no valid LineString geometry.');
  }

  const projection = createProjectionFromLineStrings(lineStrings);
  const projectedLineStrings = lineStrings
    .map((lineString) => lineString
      .map(([lng, lat]) => projection.project(lng, lat))
      .filter((point, index, points) => index === 0 || distance(point, points[index - 1]) > 1e-9))
    .filter((lineString) => lineString.length >= 2);

  const walkablePolygons = walkableGeoJSON
    ? extractAndProjectPolygons(walkableGeoJSON, projection)
    : [];
  const obstaclePolygons = obstaclesGeoJSON
    ? extractAndProjectPolygons(obstaclesGeoJSON, projection)
    : [];

  const sourceSegments = createSourceSegments(projectedLineStrings);
  splitSegmentsAtIntersections(sourceSegments, nodeToleranceMeters);

  const validatedGraph = assembleGraph({
    projection,
    sourceSegments,
    walkablePolygons,
    obstaclePolygons,
    nodeToleranceMeters,
    validationSampleStepMeters,
  });

  if (validatedGraph.nodes.size > 0 && validatedGraph.edges.size > 0) {
    return validatedGraph;
  }

  if (walkablePolygons.length === 0 && obstaclePolygons.length === 0) {
    throw new Error('IndoorRouter: centerline graph is empty after graph construction.');
  }

  const fallbackGraph = assembleGraph({
    projection,
    sourceSegments,
    walkablePolygons: [],
    obstaclePolygons: [],
    nodeToleranceMeters,
    validationSampleStepMeters,
  });

  if (fallbackGraph.nodes.size === 0 || fallbackGraph.edges.size === 0) {
    throw new Error('IndoorRouter: centerline graph is empty after graph construction.');
  }

  return {
    ...fallbackGraph,
    walkablePolygons,
    obstaclePolygons,
  };
}

export function snapPointToGraph(
  point: Point2D,
  graph: NavigationGraph,
  options: SnapOptions = {}
): GraphSnap | null {
  const maxSnapDistanceMeters = options.maxSnapDistanceMeters ?? Number.POSITIVE_INFINITY;

  let nearestNode: GraphNode | null = null;
  let nearestNodeDistance = Number.POSITIVE_INFINITY;

  for (const node of graph.nodes.values()) {
    const candidateDistance = distance(point, node.point);
    if (candidateDistance < nearestNodeDistance) {
      nearestNodeDistance = candidateDistance;
      nearestNode = node;
    }
  }

  let nearestEdge: GraphEdge | null = null;
  let nearestPointOnEdge: Point2D | null = null;
  let nearestEdgeDistance = Number.POSITIVE_INFINITY;
  let nearestEdgeT = 0;

  for (const edge of graph.edges.values()) {
    const [edgeStart, edgeEnd] = edge.geometry;
    const closest = closestPointOnSegment(point, edgeStart, edgeEnd);

    if (closest.distanceMeters < nearestEdgeDistance) {
      nearestEdgeDistance = closest.distanceMeters;
      nearestPointOnEdge = closest.point;
      nearestEdge = edge;
      nearestEdgeT = closest.t;
    }
  }

  if (!nearestNode && !nearestEdge) {
    return null;
  }

  const bestDistance = Math.min(nearestNodeDistance, nearestEdgeDistance);
  if (bestDistance > maxSnapDistanceMeters) {
    return null;
  }

  if (
    nearestNode &&
    (nearestNodeDistance <= nearestEdgeDistance || !nearestEdge || !nearestPointOnEdge)
  ) {
    return {
      kind: 'node',
      point: { ...nearestNode.point },
      distanceMeters: nearestNodeDistance,
      nodeId: nearestNode.id,
      componentId: nearestNode.componentId,
    };
  }

  const edge = nearestEdge!;
  const edgeFromPoint = graph.nodes.get(edge.from)!.point;
  const edgeToPoint = graph.nodes.get(edge.to)!.point;

  if (nearestPointOnEdge && distance(nearestPointOnEdge, edgeFromPoint) <= graph.nodeToleranceMeters) {
    const node = graph.nodes.get(edge.from)!;
    return {
      kind: 'node',
      point: { ...node.point },
      distanceMeters: nearestEdgeDistance,
      nodeId: node.id,
      componentId: node.componentId,
    };
  }

  if (nearestPointOnEdge && distance(nearestPointOnEdge, edgeToPoint) <= graph.nodeToleranceMeters) {
    const node = graph.nodes.get(edge.to)!;
    return {
      kind: 'node',
      point: { ...node.point },
      distanceMeters: nearestEdgeDistance,
      nodeId: node.id,
      componentId: node.componentId,
    };
  }

  return {
    kind: 'edge',
    point: { ...nearestPointOnEdge! },
    distanceMeters: nearestEdgeDistance,
    edgeId: edge.id,
    edgeFromNodeId: edge.from,
    edgeToNodeId: edge.to,
    t: nearestEdgeT,
    componentId: graph.nodes.get(edge.from)!.componentId,
  };
}

export function buildQueryGraph(
  baseGraph: NavigationGraph,
  startSnap: GraphSnap,
  endSnap: GraphSnap
): QueryGraphResult {
  const graph: NavigationGraph = {
    projection: baseGraph.projection,
    nodes: new Map(baseGraph.nodes),
    edges: new Map(baseGraph.edges),
    adjacency: new Map(
      Array.from(baseGraph.adjacency.entries(), ([nodeId, neighbors]) => [nodeId, [...neighbors]])
    ),
    walkablePolygons: baseGraph.walkablePolygons,
    obstaclePolygons: baseGraph.obstaclePolygons,
    nodeToleranceMeters: baseGraph.nodeToleranceMeters,
    validationSampleStepMeters: baseGraph.validationSampleStepMeters,
    componentCount: baseGraph.componentCount,
  };

  const edgeIdsByPair = new Map<string, string>();
  for (const edge of graph.edges.values()) {
    edgeIdsByPair.set(createEdgePairKey(edge.from, edge.to), edge.id);
  }

  const connectNodes = (fromNodeId: string, toNodeId: string): void => {
    if (fromNodeId === toNodeId) {
      return;
    }

    const pairKey = createEdgePairKey(fromNodeId, toNodeId);
    if (edgeIdsByPair.has(pairKey)) {
      return;
    }

    const fromPoint = graph.nodes.get(fromNodeId)!.point;
    const toPoint = graph.nodes.get(toNodeId)!.point;
    const edgeId = `__temp_edge_${graph.edges.size}`;
    const weight = distance(fromPoint, toPoint);

    edgeIdsByPair.set(pairKey, edgeId);
    graph.edges.set(edgeId, {
      id: edgeId,
      from: fromNodeId,
      to: toNodeId,
      weight,
      geometry: [{ ...fromPoint }, { ...toPoint }],
    });
    graph.adjacency.get(fromNodeId)!.push({ nodeId: toNodeId, edgeId, weight });
    graph.adjacency.get(toNodeId)!.push({ nodeId: fromNodeId, edgeId, weight });
  };

  const materializeSnap = (snap: GraphSnap, tempNodeId: string): string => {
    if (snap.kind === 'node') {
      return snap.nodeId!;
    }

    graph.nodes.set(tempNodeId, {
      id: tempNodeId,
      point: { ...snap.point },
      componentId: snap.componentId,
    });
    graph.adjacency.set(tempNodeId, []);

    connectNodes(tempNodeId, snap.edgeFromNodeId!);
    connectNodes(tempNodeId, snap.edgeToNodeId!);

    return tempNodeId;
  };

  const startNodeId = materializeSnap(startSnap, '__start_snap');
  const endNodeId = materializeSnap(endSnap, '__end_snap');

  if (
    startNodeId !== endNodeId &&
    startSnap.kind === 'edge' &&
    endSnap.kind === 'edge' &&
    startSnap.edgeId === endSnap.edgeId
  ) {
    connectNodes(startNodeId, endNodeId);
  }

  return {
    graph,
    startNodeId,
    endNodeId,
  };
}

export function isSegmentNavigable(
  start: Point2D,
  end: Point2D,
  walkablePolygons: MultiPolygon,
  obstaclePolygons: MultiPolygon,
  sampleStepMeters = 0.5
): boolean {
  if (obstaclePolygons.length > 0) {
    if (segmentIntersectsAnyPolygon(start, end, obstaclePolygons)) {
      return false;
    }
  }

  if (walkablePolygons.length === 0) {
    return true;
  }

  const totalLength = distance(start, end);
  const steps = Math.max(2, Math.ceil(totalLength / Math.max(sampleStepMeters, 0.1)));

  for (let index = 0; index <= steps; index += 1) {
    const point = lerpPoint(start, end, index / steps);

    if (!pointInMultiPolygon(point, walkablePolygons)) {
      return false;
    }

    if (obstaclePolygons.length > 0 && pointInMultiPolygon(point, obstaclePolygons)) {
      return false;
    }
  }

  return true;
}

interface AssembleGraphOptions {
  projection: LocalProjection;
  sourceSegments: ProjectedSegment[];
  walkablePolygons: MultiPolygon;
  obstaclePolygons: MultiPolygon;
  nodeToleranceMeters: number;
  validationSampleStepMeters: number;
}

function assembleGraph(options: AssembleGraphOptions): NavigationGraph {
  const {
    projection,
    sourceSegments,
    walkablePolygons,
    obstaclePolygons,
    nodeToleranceMeters,
    validationSampleStepMeters,
  } = options;

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const adjacency = new Map<string, GraphNeighbor[]>();
  const nodeIdsByKey = new Map<string, string>();
  const edgeIdsByPair = new Map<string, string>();

  const getOrCreateNodeId = (point: Point2D): string => {
    const key = createPointKey(point, nodeToleranceMeters);
    const existingNodeId = nodeIdsByKey.get(key);

    if (existingNodeId) {
      return existingNodeId;
    }

    const nodeId = `n${nodes.size}`;
    nodes.set(nodeId, {
      id: nodeId,
      point: { ...point },
      componentId: -1,
    });
    adjacency.set(nodeId, []);
    nodeIdsByKey.set(key, nodeId);
    return nodeId;
  };

  for (const segment of sourceSegments) {
    const sortedSplitPoints = collapseAndSortSplitPoints(segment.splitPoints, nodeToleranceMeters);

    for (let index = 1; index < sortedSplitPoints.length; index += 1) {
      const fromPoint = sortedSplitPoints[index - 1].point;
      const toPoint = sortedSplitPoints[index].point;
      const weight = distance(fromPoint, toPoint);

      if (weight <= nodeToleranceMeters * 0.5) {
        continue;
      }

      if (!isSegmentNavigable(
        fromPoint,
        toPoint,
        walkablePolygons,
        obstaclePolygons,
        validationSampleStepMeters
      )) {
        continue;
      }

      const fromNodeId = getOrCreateNodeId(fromPoint);
      const toNodeId = getOrCreateNodeId(toPoint);

      if (fromNodeId === toNodeId) {
        continue;
      }

      const pairKey = createEdgePairKey(fromNodeId, toNodeId);
      if (edgeIdsByPair.has(pairKey)) {
        continue;
      }

      const edgeId = `e${edges.size}`;
      edgeIdsByPair.set(pairKey, edgeId);
      edges.set(edgeId, {
        id: edgeId,
        from: fromNodeId,
        to: toNodeId,
        weight,
        geometry: [{ ...fromPoint }, { ...toPoint }],
      });

      adjacency.get(fromNodeId)!.push({ nodeId: toNodeId, edgeId, weight });
      adjacency.get(toNodeId)!.push({ nodeId: fromNodeId, edgeId, weight });
    }
  }

  const componentCount = assignConnectedComponents(nodes, adjacency);

  return {
    projection,
    nodes,
    edges,
    adjacency,
    walkablePolygons,
    obstaclePolygons,
    nodeToleranceMeters,
    validationSampleStepMeters,
    componentCount,
  };
}

// ---------------------------------------------------------------------------
// GeoJSON extraction helpers
// ---------------------------------------------------------------------------

function extractLineStrings(input: GeoJSONInput): [number, number][][] {
  const lineStrings: [number, number][][] = [];
  collectLineStrings(input, lineStrings);
  return lineStrings.filter((lineString) => lineString.length >= 2);
}

function collectLineStrings(input: GeoJSONInput, lineStrings: [number, number][][]): void {
  if (input.type === 'FeatureCollection') {
    for (const feature of input.features) {
      if (feature.geometry) {
        collectLineStrings(feature.geometry, lineStrings);
      }
    }
    return;
  }

  if (input.type === 'Feature') {
    if (input.geometry) {
      collectLineStrings(input.geometry, lineStrings);
    }
    return;
  }

  if (input.type === 'LineString') {
    lineStrings.push(input.coordinates);
    return;
  }

  if (input.type === 'MultiLineString') {
    lineStrings.push(...input.coordinates);
  }
}

function extractAndProjectPolygons(
  input: GeoJSONInput,
  projection: LocalProjection
): MultiPolygon {
  const polygons: MultiPolygon = [];
  collectPolygons(input, polygons, projection);
  return polygons;
}

function collectPolygons(
  input: GeoJSONInput,
  polygons: MultiPolygon,
  projection: LocalProjection
): void {
  if (input.type === 'FeatureCollection') {
    for (const feature of input.features) {
      if (feature.geometry) {
        collectPolygons(feature.geometry, polygons, projection);
      }
    }
    return;
  }

  if (input.type === 'Feature') {
    if (input.geometry) {
      collectPolygons(input.geometry, polygons, projection);
    }
    return;
  }

  if (input.type === 'Polygon') {
    polygons.push(projectPolygonWith(input.coordinates as Polygon, projection.project));
    return;
  }

  if (input.type === 'MultiPolygon') {
    for (const polygon of input.coordinates) {
      polygons.push(projectPolygonWith(polygon as Polygon, projection.project));
    }
  }
}

function createProjectionFromLineStrings(lineStrings: [number, number][][]): LocalProjection {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const lineString of lineStrings) {
    for (const [lng, lat] of lineString) {
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
    }
  }

  return createLocalProjection((minLng + maxLng) / 2, (minLat + maxLat) / 2);
}

// ---------------------------------------------------------------------------
// Segment splitting and graph assembly
// ---------------------------------------------------------------------------

function createSourceSegments(lineStrings: Point2D[][]): ProjectedSegment[] {
  const sourceSegments: ProjectedSegment[] = [];

  for (const lineString of lineStrings) {
    for (let index = 1; index < lineString.length; index += 1) {
      const start = lineString[index - 1];
      const end = lineString[index];

      if (distance(start, end) <= 1e-9) {
        continue;
      }

      sourceSegments.push({
        id: `s${sourceSegments.length}`,
        start,
        end,
        splitPoints: [
          { t: 0, point: { ...start } },
          { t: 1, point: { ...end } },
        ],
      });
    }
  }

  return sourceSegments;
}

function splitSegmentsAtIntersections(
  segments: ProjectedSegment[],
  nodeToleranceMeters: number
): void {
  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    const left = segments[leftIndex];

    for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
      const right = segments[rightIndex];

      splitSegmentWithEndpoint(left.start, right, nodeToleranceMeters);
      splitSegmentWithEndpoint(left.end, right, nodeToleranceMeters);
      splitSegmentWithEndpoint(right.start, left, nodeToleranceMeters);
      splitSegmentWithEndpoint(right.end, left, nodeToleranceMeters);

      const intersection = segmentIntersectionPoint(left.start, left.end, right.start, right.end);
      if (!intersection || intersection.kind !== 'cross') {
        continue;
      }

      addSplitPoint(left, intersection.t, intersection.point, nodeToleranceMeters);
      addSplitPoint(right, intersection.u, intersection.point, nodeToleranceMeters);
    }
  }
}

function splitSegmentWithEndpoint(
  endpoint: Point2D,
  segment: ProjectedSegment,
  nodeToleranceMeters: number
): void {
  const closest = closestPointOnSegment(endpoint, segment.start, segment.end);
  if (closest.distanceMeters > nodeToleranceMeters) {
    return;
  }

  if (closest.t <= 1e-6 || closest.t >= 1 - 1e-6) {
    return;
  }

  addSplitPoint(segment, closest.t, closest.point, nodeToleranceMeters);
}

function addSplitPoint(
  segment: ProjectedSegment,
  t: number,
  point: Point2D,
  nodeToleranceMeters: number
): void {
  for (const existing of segment.splitPoints) {
    if (distance(existing.point, point) <= nodeToleranceMeters) {
      return;
    }
  }

  segment.splitPoints.push({
    t,
    point: { ...point },
  });
}

function collapseAndSortSplitPoints(
  splitPoints: Array<{ t: number; point: Point2D }>,
  nodeToleranceMeters: number
): Array<{ t: number; point: Point2D }> {
  const sorted = [...splitPoints].sort((left, right) => left.t - right.t);
  const deduped: Array<{ t: number; point: Point2D }> = [];

  for (const splitPoint of sorted) {
    const previous = deduped[deduped.length - 1];
    if (previous && distance(previous.point, splitPoint.point) <= nodeToleranceMeters) {
      continue;
    }
    deduped.push(splitPoint);
  }

  return deduped;
}

function assignConnectedComponents(
  nodes: Map<string, GraphNode>,
  adjacency: Map<string, GraphNeighbor[]>
): number {
  const visited = new Set<string>();
  let componentId = 0;

  for (const nodeId of nodes.keys()) {
    if (visited.has(nodeId)) {
      continue;
    }

    const queue = [nodeId];
    visited.add(nodeId);

    while (queue.length > 0) {
      const currentNodeId = queue.shift()!;
      nodes.get(currentNodeId)!.componentId = componentId;

      for (const neighbor of adjacency.get(currentNodeId) ?? []) {
        if (visited.has(neighbor.nodeId)) {
          continue;
        }
        visited.add(neighbor.nodeId);
        queue.push(neighbor.nodeId);
      }
    }

    componentId += 1;
  }

  return componentId;
}

function createPointKey(point: Point2D, toleranceMeters: number): string {
  const scale = 1 / Math.max(toleranceMeters, 0.001);
  return `${Math.round(point.x * scale)}:${Math.round(point.y * scale)}`;
}

function createEdgePairKey(fromNodeId: string, toNodeId: string): string {
  return fromNodeId < toNodeId
    ? `${fromNodeId}|${toNodeId}`
    : `${toNodeId}|${fromNodeId}`;
}
