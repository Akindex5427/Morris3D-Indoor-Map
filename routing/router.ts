import { aStarGraphPath } from './astarGraph';
import {
  buildNavigationGraph,
  buildQueryGraph,
  GeoJSONInput,
  isSegmentNavigable,
  NavigationGraph,
  snapPointToGraph,
} from './graph';
import { distance, Point2D } from './geometry';

export interface RouteResult {
  success: boolean;
  coordinates: Array<{ lat: number; lng: number }>;
  distance: number;
  waypointCount: number;
  error?: string;
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
    walkableGeoJSON: GeoJSONInput,
    obstaclesGeoJSON: GeoJSONInput,
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

  computeRoute(
    start: { lat: number; lng: number },
    end: { lat: number; lng: number }
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

      const worldPath = this.options.simplifyCollinearPoints === false
        ? dedupeConsecutivePoints(rawPath)
        : simplifyPath(
          rawPath,
          query.graph.walkablePolygons,
          query.graph.obstaclePolygons,
          query.graph.validationSampleStepMeters
        );

      const coordinates = worldPath.map((point) => {
        const { lng, lat } = query.graph.projection.unproject(point.x, point.y);
        return { lat, lng };
      });

      return {
        success: true,
        coordinates,
        distance: Math.round(pathLength(worldPath) * 100) / 100,
        waypointCount: coordinates.length,
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
      distance: 0,
      waypointCount: 0,
      error,
    };
  }
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
      isSegmentNavigable(previous, next, walkablePolygons, obstaclePolygons, sampleStepMeters)
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

function pathLength(points: Point2D[]): number {
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1], points[index]);
  }

  return total;
}
