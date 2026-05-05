import { aStarGraphPath } from './astarGraph';
import {
  buildNavigationGraph,
  buildQueryGraph,
  GeoJSONInput,
  isSegmentNavigable,
  NavigationGraph,
  snapPointToGraph,
} from './graph';
import { distance, Point2D, segmentIntersectsAnyPolygon } from './geometry';

export interface RouteCoordinate {
  lat: number;
  lng: number;
}

export interface RouteSnapDebug {
  kind: 'node' | 'edge';
  point: RouteCoordinate;
  distanceMeters: number;
  componentId: number;
  nodeId?: string;
  edgeId?: string;
  edgeFromNodeId?: string;
  edgeToNodeId?: string;
  t?: number;
}

export interface RouteSegmentValidation {
  segmentIndex: number;
  start: RouteCoordinate;
  end: RouteCoordinate;
  intersectsObstacle: boolean;
  valid: boolean;
}

export interface RouteDebugInfo {
  startSnap?: RouteSnapDebug;
  endSnap?: RouteSnapDebug;
  graphNodeIds?: string[];
  graphCoordinates?: RouteCoordinate[];
  renderedCoordinates?: RouteCoordinate[];
  validationFallbackUsed?: boolean;
  finalGraphStart?: RouteCoordinate;
  finalGraphEnd?: RouteCoordinate;
  renderedSegments?: RouteSegmentValidation[];
}

export interface PolylineValidationResult {
  valid: boolean;
  segments: RouteSegmentValidation[];
}

export interface RouteResult {
  success: boolean;
  coordinates: RouteCoordinate[];
  renderCoordinates: RouteCoordinate[];
  distance: number;
  waypointCount: number;
  error?: string;
  debug?: RouteDebugInfo;
}

export interface IndoorRouterOptions {
  maxSnapDistanceMeters?: number;
  nodeToleranceMeters?: number;
  validationSampleStepMeters?: number;
  simplifyCollinearPoints?: boolean;
}

export class IndoorRouter {
  private readonly graph: NavigationGraph;
  private readonly options: IndoorRouterOptions;

  constructor(
    centerlinesGeoJSON: GeoJSONInput,
    walkableGeoJSON?: GeoJSONInput | null,
    obstaclesGeoJSON?: GeoJSONInput | null,
    options: IndoorRouterOptions = {}
  ) {
    this.options = options;
    this.graph = buildNavigationGraph({
      centerlinesGeoJSON,
      walkableGeoJSON,
      obstaclesGeoJSON,
      nodeToleranceMeters: options.nodeToleranceMeters,
      validationSampleStepMeters: options.validationSampleStepMeters,
    });
  }

  getGraph(): NavigationGraph {
    return this.graph;
  }

  snapToGraph(point: RouteCoordinate): RouteSnapDebug | null {
    const projectedPoint = this.graph.projection.project(point.lng, point.lat);
    const snap = snapPointToGraph(projectedPoint, this.graph, {
      maxSnapDistanceMeters: this.options.maxSnapDistanceMeters,
    });

    return snap ? toRouteSnapDebug(this.graph, snap) : null;
  }

  validatePolyline(coordinates: RouteCoordinate[]): PolylineValidationResult {
    const segments: RouteSegmentValidation[] = [];
    const checkObstacleCollisions = this.options.simplifyCollinearPoints !== false;

    for (let index = 1; index < coordinates.length; index += 1) {
      const start = coordinates[index - 1];
      const end = coordinates[index];
      const startPoint = this.graph.projection.project(start.lng, start.lat);
      const endPoint = this.graph.projection.project(end.lng, end.lat);
      const intersectsObstacle =
        checkObstacleCollisions &&
        this.graph.obstaclePolygons.length > 0 &&
        segmentIntersectsAnyPolygon(startPoint, endPoint, this.graph.obstaclePolygons);
      const valid = isSegmentNavigable(
        startPoint,
        endPoint,
        this.graph.walkablePolygons,
        this.graph.obstaclePolygons,
        this.graph.validationSampleStepMeters,
        checkObstacleCollisions
      );

      segments.push({
        segmentIndex: index - 1,
        start,
        end,
        intersectsObstacle,
        valid,
      });
    }

    return {
      valid: segments.every((segment) => segment.valid && !segment.intersectsObstacle),
      segments,
    };
  }

  computeRoute(
    start: RouteCoordinate,
    end: RouteCoordinate
  ): RouteResult {
    try {
      const startPoint = this.graph.projection.project(start.lng, start.lat);
      const endPoint = this.graph.projection.project(end.lng, end.lat);

      const startSnap = snapPointToGraph(startPoint, this.graph, {
        maxSnapDistanceMeters: this.options.maxSnapDistanceMeters,
      });
      if (!startSnap) {
        return this.failure('Unable to snap the start point to the centerline graph.');
      }

      const endSnap = snapPointToGraph(endPoint, this.graph, {
        maxSnapDistanceMeters: this.options.maxSnapDistanceMeters,
      });
      if (!endSnap) {
        return this.failure('Unable to snap the end point to the centerline graph.');
      }

      if (startSnap.componentId !== endSnap.componentId) {
        return this.failure('Start and end are in disconnected parts of the centerline graph.');
      }

      const query = buildQueryGraph(this.graph, startSnap, endSnap);
      const result = aStarGraphPath({
        graph: query.graph,
        startNodeId: query.startNodeId,
        endNodeId: query.endNodeId,
      });

      if (!result.found) {
        return this.failure(result.error ?? 'No centerline path found between start and end.');
      }

      const rawPath = result.nodeIds
        .map((nodeId) => query.graph.nodes.get(nodeId)?.point)
        .filter((point): point is Point2D => point !== undefined);

      const graphPath = dedupeConsecutivePoints(rawPath);
      const renderedPath = this.options.simplifyCollinearPoints === false
        ? graphPath
        : simplifyPath(
          graphPath,
          query.graph.walkablePolygons,
          query.graph.obstaclePolygons,
          query.graph.validationSampleStepMeters
        );

      const graphCoordinates = graphPath.map((point) => {
        const { lng, lat } = query.graph.projection.unproject(point.x, point.y);
        return { lat, lng };
      });
      const coordinates = renderedPath.map((point) => {
        const { lng, lat } = query.graph.projection.unproject(point.x, point.y);
        return { lat, lng };
      });
      const routeValidation = this.validatePolyline(coordinates);

      return {
        success: true,
        coordinates,
        renderCoordinates: graphCoordinates,
        distance: Math.round(result.distance * 100) / 100,
        waypointCount: coordinates.length,
        debug: {
          startSnap: toRouteSnapDebug(this.graph, startSnap),
          endSnap: toRouteSnapDebug(this.graph, endSnap),
          graphNodeIds: result.nodeIds,
          graphCoordinates,
          renderedCoordinates: coordinates,
          validationFallbackUsed: this.graph.validationFallbackUsed,
          finalGraphStart: graphCoordinates[0],
          finalGraphEnd: graphCoordinates[graphCoordinates.length - 1],
          renderedSegments: routeValidation.segments,
        },
      };
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'Unknown error during routing.'
      );
    }
  }

  private failure(error: string): RouteResult {
    return {
      success: false,
      coordinates: [],
      renderCoordinates: [],
      distance: 0,
      waypointCount: 0,
      error,
    };
  }
}

function toRouteSnapDebug(
  graph: NavigationGraph,
  snap: NonNullable<ReturnType<typeof snapPointToGraph>>
): RouteSnapDebug {
  const { lng, lat } = graph.projection.unproject(snap.point.x, snap.point.y);

  return {
    kind: snap.kind,
    point: { lat, lng },
    distanceMeters: snap.distanceMeters,
    componentId: snap.componentId,
    nodeId: snap.nodeId,
    edgeId: snap.edgeId,
    edgeFromNodeId: snap.edgeFromNodeId,
    edgeToNodeId: snap.edgeToNodeId,
    t: snap.t,
  };
}

function dedupeConsecutivePoints(points: Point2D[], toleranceMeters = 1e-6): Point2D[] {
  if (points.length === 0) {
    return [];
  }

  const deduped = [{ ...points[0] }];

  for (let index = 1; index < points.length; index += 1) {
    if (distance(points[index], deduped[deduped.length - 1]) <= toleranceMeters) {
      continue;
    }
    deduped.push({ ...points[index] });
  }

  return deduped;
}

function simplifyPath(
  points: Point2D[],
  walkablePolygons: NavigationGraph['walkablePolygons'],
  obstaclePolygons: NavigationGraph['obstaclePolygons'],
  sampleStepMeters: number
): Point2D[] {
  const deduped = dedupeConsecutivePoints(points);
  if (deduped.length <= 2) {
    return deduped;
  }

  const simplified: Point2D[] = [{ ...deduped[0] }];

  for (let index = 1; index < deduped.length - 1; index += 1) {
    const previous = simplified[simplified.length - 1];
    const current = deduped[index];
    const next = deduped[index + 1];

    if (
      isNearlyCollinear(previous, current, next) &&
      isSegmentNavigable(
        previous,
        next,
        walkablePolygons,
        obstaclePolygons,
        sampleStepMeters,
        obstaclePolygons.length > 0
      )
    ) {
      continue;
    }

    simplified.push({ ...current });
  }

  simplified.push({ ...deduped[deduped.length - 1] });
  return simplified;
}

function isNearlyCollinear(
  first: Point2D,
  second: Point2D,
  third: Point2D,
  toleranceMeters = 0.02
): boolean {
  const baseLength = distance(first, third);
  if (baseLength === 0) {
    return true;
  }

  const twiceTriangleArea = Math.abs(
    (second.x - first.x) * (third.y - first.y) -
    (second.y - first.y) * (third.x - first.x)
  );

  return twiceTriangleArea / baseLength <= toleranceMeters;
}
