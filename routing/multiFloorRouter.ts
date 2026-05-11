import { IndoorRouter, RouteCoordinate, RouteResult } from './router';
import {
  createLocalProjection,
  distance,
  lerpPoint,
  LocalProjection,
  Point2D,
} from './geometry';
import { GeoJSONFeature } from './graph';

export interface VerticalConnector {
  id: string;
  type: 'stairs' | 'elevator';
  floors: string[];
  accessPoints: Record<string, RouteCoordinate>;
  name?: string;
  debug?: {
    featureCount: number;
    snapDistances: Record<string, number>;
  };
}

export interface HorizontalRouteSegment {
  floorId: string;
  type: 'horizontal';
  coordinates: RouteCoordinate[];
  renderCoordinates: RouteCoordinate[];
  distance: number;
  waypointCount: number;
  route: RouteResult;
}

export interface VerticalTransitionSegment {
  type: 'vertical-transition';
  connectorType: 'stairs' | 'elevator';
  connectorId: string;
  connectorName?: string;
  fromFloor: string;
  toFloor: string;
  fromAccessPoint: RouteCoordinate;
  toAccessPoint: RouteCoordinate;
  instruction: string;
}

export type MultiFloorRouteSegment = HorizontalRouteSegment | VerticalTransitionSegment;

export interface MultiFloorRouteResult {
  success: boolean;
  type: 'same-floor' | 'multi-floor';
  segments: MultiFloorRouteSegment[];
  instructions: string[];
  totalDistance: number;
  totalCost: number;
  connector?: VerticalConnector;
  sameFloorRoute?: RouteResult;
  error?: string;
  debug?: Record<string, unknown>;
}

export interface ComputeMultiFloorRouteOptions {
  start: RouteCoordinate;
  startFloor: number | string;
  destination: RouteCoordinate;
  destinationFloor: number | string;
  routers: Record<string, IndoorRouter>;
  roomsByFloor: Record<string, GeoJSONFeature[]>;
  verticalTransitionPenalty?: number;
  userPreference?: 'stairs' | 'elevator' | 'accessible' | string;
}

interface StairFeatureCandidate {
  id: string;
  name: string;
  connectorType: 'stairs' | 'elevator';
  floorKey: string;
  feature: GeoJSONFeature;
  centroid: RouteCoordinate;
  projectedCentroid: Point2D;
}

interface StairCluster {
  id: string;
  name: string;
  connectorType: 'stairs' | 'elevator';
  features: StairFeatureCandidate[];
  centroid: Point2D;
}

const STAIR_NAME_PATTERN = /stairs?|stair\s*case|stairs?\s*area/i;
const ELEVATOR_NAME_PATTERN = /elevators?|lift/i;
const CONNECTOR_CLUSTER_DISTANCE_METERS = 14;
const STAIR_BOUNDARY_SAMPLE_SPACING_METERS = 1.25;
const MAX_STAIR_BOUNDARY_SAMPLES = 80;
const DEFAULT_VERTICAL_TRANSITION_PENALTY = 30;

export function computeMultiFloorRoute(
  options: ComputeMultiFloorRouteOptions,
): MultiFloorRouteResult {
  const {
    start,
    startFloor,
    destination,
    destinationFloor,
    routers,
    roomsByFloor,
    verticalTransitionPenalty = DEFAULT_VERTICAL_TRANSITION_PENALTY,
    userPreference,
  } = options;
  const startFloorKey = normalizeFloorKey(startFloor);
  const destinationFloorKey = normalizeFloorKey(destinationFloor);

  if (startFloorKey === destinationFloorKey) {
    const router = routers[startFloorKey];
    if (!router) {
      return failure(
        'same-floor',
        `Routing is not available for Floor ${formatFloorLabel(startFloorKey)}.`,
      );
    }

    const sameFloorRoute = router.computeRoute(start, destination);
    return {
      success: sameFloorRoute.success,
      type: 'same-floor',
      segments: sameFloorRoute.success
        ? [toHorizontalSegment(startFloorKey, sameFloorRoute)]
        : [],
      instructions: sameFloorRoute.success ? [] : [],
      totalDistance: sameFloorRoute.distance,
      totalCost: sameFloorRoute.distance,
      sameFloorRoute,
      error: sameFloorRoute.error,
    };
  }

  console.log('[MultiFloorRoute] startFloor', startFloorKey);
  console.log('[MultiFloorRoute] destinationFloor', destinationFloorKey);

  const connectors = buildVerticalConnectors({ roomsByFloor, routers, userPreference });
  const candidateConnectors = connectors.filter(
    (connector) =>
      connector.accessPoints[startFloorKey] &&
      connector.accessPoints[destinationFloorKey],
  );

  console.log('[MultiFloorRoute] candidate vertical connectors found', {
    totalConnectors: connectors.length,
    usableConnectors: candidateConnectors.length,
    connectors: candidateConnectors,
  });

  let bestCandidate: MultiFloorRouteResult | null = null;
  let bestDebug: Record<string, unknown> | null = null;

  for (const connector of candidateConnectors) {
    const startRouter = routers[startFloorKey];
    const destinationRouter = routers[destinationFloorKey];
    const startAccessPoint = connector.accessPoints[startFloorKey];
    const destinationAccessPoint = connector.accessPoints[destinationFloorKey];

    if (!startRouter || !destinationRouter || !startAccessPoint || !destinationAccessPoint) {
      continue;
    }

    const startFloorRoute = startRouter.computeRoute(start, startAccessPoint);
    if (!startFloorRoute.success) {
      continue;
    }

    const destinationFloorRoute = destinationRouter.computeRoute(
      destinationAccessPoint,
      destination,
    );
    if (!destinationFloorRoute.success) {
      continue;
    }

    const floorDelta = Math.abs(Number(destinationFloorKey) - Number(startFloorKey));
    const verticalCost =
      verticalTransitionPenalty * Math.max(1, Number.isFinite(floorDelta) ? floorDelta : 1);
    const totalDistance = startFloorRoute.distance + destinationFloorRoute.distance;
    const totalCost = totalDistance + verticalCost;
    const result: MultiFloorRouteResult = {
      success: true,
      type: 'multi-floor',
      connector,
      totalDistance: Math.round(totalDistance * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      instructions: [],
      segments: [
        toHorizontalSegment(startFloorKey, startFloorRoute),
        {
          type: 'vertical-transition',
          connectorType: connector.type,
          connectorId: connector.id,
          connectorName: connector.name,
          fromFloor: startFloorKey,
          toFloor: destinationFloorKey,
          fromAccessPoint: startAccessPoint,
          toAccessPoint: destinationAccessPoint,
          instruction: `Take the ${connector.type === 'elevator' ? 'elevator' : 'stairs'} from ${formatFloorLabel(startFloorKey)} to ${formatFloorLabel(destinationFloorKey)}`,
        },
        toHorizontalSegment(destinationFloorKey, destinationFloorRoute),
      ],
      debug: {
        connectorId: connector.id,
        startFloorRouteDistance: startFloorRoute.distance,
        destinationFloorRouteDistance: destinationFloorRoute.distance,
        verticalTransitionFloors: [startFloorKey, destinationFloorKey],
        totalCost,
      },
    };

    if (!bestCandidate || result.totalCost < bestCandidate.totalCost) {
      bestCandidate = result;
      bestDebug = result.debug ?? null;
    }
  }

  if (!bestCandidate) {
    return failure(
      'multi-floor',
      `No vertical connector could route from ${formatFloorLabel(startFloorKey)} to ${formatFloorLabel(destinationFloorKey)} using the centerline graphs.`,
      {
        startFloor: startFloorKey,
        destinationFloor: destinationFloorKey,
        candidateConnectors,
      },
    );
  }

  console.log('[MultiFloorRoute] selected vertical connector', bestCandidate.connector);
  console.log('[MultiFloorRoute] start floor route distance', bestDebug?.startFloorRouteDistance);
  console.log(
    '[MultiFloorRoute] destination floor route distance',
    bestDebug?.destinationFloorRouteDistance,
  );
  console.log('[MultiFloorRoute] vertical transition floors', [
    startFloorKey,
    destinationFloorKey,
  ]);
  console.log('[MultiFloorRoute] final route segments generated', bestCandidate.segments);

  return bestCandidate;
}

export function buildStairConnectors({
  roomsByFloor,
  routers,
}: {
  roomsByFloor: Record<string, GeoJSONFeature[]>;
  routers: Record<string, IndoorRouter>;
}): VerticalConnector[] {
  return buildVerticalConnectors({ roomsByFloor, routers })
    .filter((connector) => connector.type === 'stairs');
}

export function buildVerticalConnectors({
  roomsByFloor,
  routers,
  userPreference,
}: {
  roomsByFloor: Record<string, GeoJSONFeature[]>;
  routers: Record<string, IndoorRouter>;
  userPreference?: string;
}): VerticalConnector[] {
  const candidates = extractVerticalCandidates(roomsByFloor);
  if (candidates.length === 0) {
    return [];
  }

  const projection = createConnectorProjection(candidates);
  const projectedCandidates = candidates.map((candidate) => ({
    ...candidate,
    projectedCentroid: projection.project(candidate.centroid.lng, candidate.centroid.lat),
  }));
  const clusters = clusterStairFeatures(projectedCandidates);

  return clusters
    .map((cluster, index) =>
      createConnectorFromCluster(cluster, index, projection, routers),
    )
    .filter((connector): connector is VerticalConnector => connector !== null)
    .sort((left, right) =>
      connectorPreferenceScore(left, userPreference) -
      connectorPreferenceScore(right, userPreference),
    );
}

function extractVerticalCandidates(
  roomsByFloor: Record<string, GeoJSONFeature[]>,
): StairFeatureCandidate[] {
  const candidates: StairFeatureCandidate[] = [];

  for (const [floorKey, features] of Object.entries(roomsByFloor)) {
    for (const feature of features ?? []) {
      const name = getFeatureName(feature);
      const connectorType = getConnectorType(name);
      if (!connectorType) {
        continue;
      }

      const centroid = getFeatureCentroid(feature);
      if (!centroid) {
        continue;
      }

      candidates.push({
        id: String(feature.id ?? feature.properties?.OBJECTID ?? `${floorKey}-${candidates.length}`),
        name,
        connectorType,
        floorKey: normalizeFloorKey(floorKey),
        feature,
        centroid,
        projectedCentroid: { x: 0, y: 0 },
      });
    }
  }

  return candidates;
}

function clusterStairFeatures(candidates: StairFeatureCandidate[]): StairCluster[] {
  const clusters: StairCluster[] = [];

  for (const candidate of candidates) {
    let bestCluster: StairCluster | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const cluster of clusters) {
      const candidateDistance = distance(candidate.projectedCentroid, cluster.centroid);
      if (
        cluster.connectorType === candidate.connectorType &&
        candidateDistance <= CONNECTOR_CLUSTER_DISTANCE_METERS &&
        candidateDistance < bestDistance
      ) {
        bestCluster = cluster;
        bestDistance = candidateDistance;
      }
    }

    if (!bestCluster) {
      clusters.push({
        id: `${candidate.connectorType}-${clusters.length + 1}`,
        name: candidate.name,
        connectorType: candidate.connectorType,
        features: [candidate],
        centroid: { ...candidate.projectedCentroid },
      });
      continue;
    }

    bestCluster.features.push(candidate);
    bestCluster.centroid = averageProjectedCentroid(bestCluster.features);
  }

  return clusters;
}

function createConnectorFromCluster(
  cluster: StairCluster,
  index: number,
  projection: LocalProjection,
  routers: Record<string, IndoorRouter>,
): VerticalConnector | null {
  const accessPoints: Record<string, RouteCoordinate> = {};
  const snapDistances: Record<string, number> = {};
  const floors = Array.from(new Set(cluster.features.map((feature) => feature.floorKey)))
    .sort(compareFloorKeys);

  for (const floorKey of floors) {
    const router = routers[floorKey];
    if (!router) {
      continue;
    }

    const floorFeatures = cluster.features.filter((feature) => feature.floorKey === floorKey);
    const access = findBestStairAccessPoint(floorFeatures, router, projection);
    if (!access) {
      continue;
    }

    accessPoints[floorKey] = access.point;
    snapDistances[floorKey] = Math.round(access.distanceMeters * 100) / 100;
  }

  const accessFloors = Object.keys(accessPoints).sort(compareFloorKeys);
  if (accessFloors.length < 2) {
    return null;
  }

  return {
    id: `${cluster.id}-${index + 1}`,
    type: cluster.connectorType,
    floors: accessFloors,
    accessPoints,
    name: cluster.name,
    debug: {
      featureCount: cluster.features.length,
      snapDistances,
    },
  };
}

function findBestStairAccessPoint(
  candidates: StairFeatureCandidate[],
  router: IndoorRouter,
  projection: LocalProjection,
): { point: RouteCoordinate; distanceMeters: number } | null {
  let bestAccess: { point: RouteCoordinate; distanceMeters: number } | null = null;

  for (const candidate of candidates) {
    const samplePoints = [
      candidate.centroid,
      ...sampleFeatureBoundary(candidate.feature, projection),
    ];

    for (const point of samplePoints) {
      const snapped = router.snapToGraph(point);
      if (!snapped) {
        continue;
      }

      const score = snapped.distanceMeters + (snapped.kind === 'edge' ? 0.05 : 0);
      if (!bestAccess || score < bestAccess.distanceMeters) {
        bestAccess = {
          point: snapped.point,
          distanceMeters: score,
        };
      }
    }
  }

  return bestAccess;
}

function sampleFeatureBoundary(
  feature: GeoJSONFeature,
  projection: LocalProjection,
): RouteCoordinate[] {
  const rings = getExteriorRings(feature);
  const samples: RouteCoordinate[] = [];
  const seen = new Set<string>();

  const addSample = (point: Point2D) => {
    const key = `${point.x.toFixed(2)}:${point.y.toFixed(2)}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    samples.push(projection.unproject(point.x, point.y));
  };

  for (const ring of rings) {
    const projectedRing = ring.map(([lng, lat]) => projection.project(lng, lat));

    for (let index = 1; index < projectedRing.length; index += 1) {
      const start = projectedRing[index - 1];
      const end = projectedRing[index];
      const segmentLength = distance(start, end);
      const steps = Math.max(
        1,
        Math.ceil(segmentLength / STAIR_BOUNDARY_SAMPLE_SPACING_METERS),
      );

      for (let step = 0; step < steps; step += 1) {
        addSample(lerpPoint(start, end, step / steps));
      }
    }
  }

  if (samples.length <= MAX_STAIR_BOUNDARY_SAMPLES) {
    return samples;
  }

  const reduced: RouteCoordinate[] = [];
  const interval = samples.length / MAX_STAIR_BOUNDARY_SAMPLES;
  for (let index = 0; index < MAX_STAIR_BOUNDARY_SAMPLES; index += 1) {
    reduced.push(samples[Math.floor(index * interval)]);
  }
  return reduced;
}

function toHorizontalSegment(floorKey: string, route: RouteResult): HorizontalRouteSegment {
  return {
    floorId: floorKey,
    type: 'horizontal',
    coordinates: route.coordinates,
    renderCoordinates: route.renderCoordinates?.length
      ? route.renderCoordinates
      : route.debug?.graphCoordinates?.length
        ? route.debug.graphCoordinates
        : route.coordinates,
    distance: route.distance,
    waypointCount: route.waypointCount,
    route,
  };
}

function failure(
  type: 'same-floor' | 'multi-floor',
  error: string,
  debug?: Record<string, unknown>,
): MultiFloorRouteResult {
  return {
    success: false,
    type,
    segments: [],
    instructions: [],
    totalDistance: 0,
    totalCost: 0,
    error,
    debug,
  };
}

function createConnectorProjection(candidates: Array<{ centroid: RouteCoordinate }>): LocalProjection {
  const lngSum = candidates.reduce((sum, candidate) => sum + candidate.centroid.lng, 0);
  const latSum = candidates.reduce((sum, candidate) => sum + candidate.centroid.lat, 0);
  return createLocalProjection(lngSum / candidates.length, latSum / candidates.length);
}

function getFeatureName(feature: GeoJSONFeature): string {
  return String(
    feature.properties?.name ??
      feature.properties?.type ??
      feature.properties?.tipo ??
      feature.properties?.id ??
      '',
  );
}

function getConnectorType(name: string): 'stairs' | 'elevator' | null {
  if (ELEVATOR_NAME_PATTERN.test(name)) {
    return 'elevator';
  }

  if (STAIR_NAME_PATTERN.test(name)) {
    return 'stairs';
  }

  return null;
}

function connectorPreferenceScore(
  connector: VerticalConnector,
  userPreference?: string,
): number {
  if (userPreference === 'accessible' || userPreference === 'elevator') {
    return connector.type === 'elevator' ? 0 : 1000;
  }

  if (userPreference === 'stairs' || userPreference === 'stairs_first') {
    return connector.type === 'stairs' ? 0 : 1000;
  }

  return connector.type === 'elevator' ? 10 : 0;
}

function getFeatureCentroid(feature: GeoJSONFeature): RouteCoordinate | null {
  const rings = getExteriorRings(feature);
  const firstRing = rings[0];
  if (!firstRing || firstRing.length === 0) {
    return null;
  }

  let lngSum = 0;
  let latSum = 0;

  for (const [lng, lat] of firstRing) {
    lngSum += lng;
    latSum += lat;
  }

  return {
    lng: lngSum / firstRing.length,
    lat: latSum / firstRing.length,
  };
}

function getExteriorRings(feature: GeoJSONFeature): [number, number][][] {
  if (feature.geometry?.type === 'Polygon') {
    return [feature.geometry.coordinates[0] as [number, number][]].filter(Boolean);
  }

  if (feature.geometry?.type === 'MultiPolygon') {
    return feature.geometry.coordinates
      .map((polygon) => polygon[0] as [number, number][])
      .filter(Boolean);
  }

  return [];
}

function averageProjectedCentroid(features: StairFeatureCandidate[]): Point2D {
  const sum = features.reduce(
    (accumulator, feature) => ({
      x: accumulator.x + feature.projectedCentroid.x,
      y: accumulator.y + feature.projectedCentroid.y,
    }),
    { x: 0, y: 0 },
  );

  return {
    x: sum.x / features.length,
    y: sum.y / features.length,
  };
}

function normalizeFloorKey(floor: number | string): string {
  const numericFloor = Number(floor);
  return Number.isFinite(numericFloor) ? String(numericFloor) : String(floor);
}

function compareFloorKeys(left: string, right: string): number {
  return Number(left) - Number(right);
}

function formatFloorLabel(floorKey: string): string {
  return floorKey === '0' ? 'Floor 0' : `Floor ${floorKey}`;
}
