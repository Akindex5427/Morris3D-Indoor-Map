export { IndoorRouter } from './router';
export type { IndoorRouterOptions, RouteResult } from './router';

export { aStarGraphPath } from './astarGraph';
export type { AStarGraphOptions, AStarGraphResult } from './astarGraph';

export {
  buildNavigationGraph,
  buildQueryGraph,
  isSegmentNavigable,
  snapPointToGraph,
} from './graph';
export type {
  BuildNavigationGraphOptions,
  GeoJSONFeature,
  GeoJSONFeatureCollection,
  GeoJSONInput,
  GeoJSONLineStringGeometry,
  GeoJSONMultiLineStringGeometry,
  GeoJSONMultiPolygonGeometry,
  GeoJSONPolygonGeometry,
  GraphEdge,
  GraphNeighbor,
  GraphNode,
  GraphSnap,
  NavigationGraph,
  QueryGraphResult,
  SnapOptions,
  SupportedGeoJSONGeometry,
} from './graph';

export {
  closestPointOnSegment,
  computeBounds,
  createLocalProjection,
  distance,
  distanceSquared,
  lerpPoint,
  mercatorProject,
  mercatorUnproject,
  pointInMultiPolygon,
  pointInPolygon,
  pointOnSegment,
  projectMultiPolygon,
  projectMultiPolygonWith,
  projectPolygon,
  projectPolygonWith,
  projectRing,
  projectRingWith,
  segmentIntersectionPoint,
  segmentIntersectsAnyPolygon,
  segmentIntersectsPolygon,
  segmentIntersectsSegment,
} from './geometry';
export type {
  AABB,
  LocalProjection,
  MultiPolygon,
  Point2D,
  Polygon,
  Ring,
  SegmentIntersection,
} from './geometry';
