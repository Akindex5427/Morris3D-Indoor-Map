import { IndoorRouter, RouteCoordinate, RouteResult } from './router';
import {
  createLocalProjection,
  distance,
  lerpPoint,
  LocalProjection,
  Point2D,
} from './geometry';
import { GeoJSONFeature } from './graph';

export type VerticalConnectorType = 'elevator' | 'ramp' | 'stairs';

export interface VerticalConnector {
  id: string;
  type: VerticalConnectorType;
  floors: string[];
  accessPoints: Record<string, RouteCoordinate>;
  accessPointOptions?: Record<string, RouteCoordinate[]>;
  featureKeysByFloor?: Record<string, string[]>;
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
  connectorType: VerticalConnectorType;
  availableConnectorTypes?: VerticalConnectorType[];
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
  roomAnchorIndexesByFloor?: Record<string, CenterlineAnchorIndex | undefined>;
  verticalTransitionPenalty?: number;
  userPreference?: 'stairs' | 'elevator' | 'ramp' | 'accessible' | string;
}

interface CenterlineAnchor {
  coordinates: RouteCoordinate;
  featureId?: string | number | null;
  role?: string;
}

type CenterlineAnchorIndex = Map<string, CenterlineAnchor[]>;

interface AccessPointCandidate {
  point: RouteCoordinate;
  distanceMeters: number;
  componentId: number | null;
  source: 'centerline-anchor' | 'connector-geometry';
}

interface StairFeatureCandidate {
  id: string;
  name: string;
  connectorType: VerticalConnectorType;
  floorKey: string;
  feature: GeoJSONFeature;
  centroid: RouteCoordinate;
  projectedCentroid: Point2D;
}

interface StairCluster {
  id: string;
  name: string;
  connectorType: VerticalConnectorType;
  features: StairFeatureCandidate[];
  centroid: Point2D;
}

const STAIR_NAME_PATTERN = /stairs?|stair\s*case|stairs?\s*area/i;
const ELEVATOR_NAME_PATTERN = /elevators?|lift/i;
const RAMP_NAME_PATTERN = /(?:accessible\s*)?ramps?/i;
const CONNECTOR_CLUSTER_DISTANCE_METERS = 14;
const STAIR_BOUNDARY_SAMPLE_SPACING_METERS = 1.25;
const MAX_STAIR_BOUNDARY_SAMPLES = 80;
const DEFAULT_VERTICAL_TRANSITION_PENALTY = 30;
const CONNECTOR_PREFERENCE_PENALTY = 1_000_000_000;
const CONNECTOR_ENDPOINT_TOLERANCE_METERS = 0.1;
const DEFAULT_CONNECTOR_PREFERENCE: VerticalConnectorType[] = [
  'elevator',
  'ramp',
  'stairs',
];

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
    roomAnchorIndexesByFloor = {},
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

  const connectors = buildVerticalConnectors({
    roomsByFloor,
    routers,
    roomAnchorIndexesByFloor,
    userPreference,
  });
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
  const successfulConnectorTypes = new Set<VerticalConnectorType>();

  for (const connector of candidateConnectors) {
    const startRouter = routers[startFloorKey];
    const destinationRouter = routers[destinationFloorKey];
    const startAccessOptions =
      connector.accessPointOptions?.[startFloorKey] ??
      [connector.accessPoints[startFloorKey]].filter(Boolean);
    const destinationAccessOptions =
      connector.accessPointOptions?.[destinationFloorKey] ??
      [connector.accessPoints[destinationFloorKey]].filter(Boolean);

    if (
      !startRouter ||
      !destinationRouter ||
      startAccessOptions.length === 0 ||
      destinationAccessOptions.length === 0
    ) {
      continue;
    }

    for (const startAccessPoint of startAccessOptions) {
      const startFloorRoute = computeConnectorBoundRoute(
        startRouter,
        start,
        startAccessPoint,
        'end',
      );
      if (!startFloorRoute.success) {
        continue;
      }

      for (const destinationAccessPoint of destinationAccessOptions) {
        const destinationFloorRoute = computeConnectorBoundRoute(
          destinationRouter,
          destinationAccessPoint,
          destination,
          'start',
        );
        if (!destinationFloorRoute.success) {
          continue;
        }

        const selectedConnector: VerticalConnector = {
          ...connector,
          accessPoints: {
            ...connector.accessPoints,
            [startFloorKey]: startAccessPoint,
            [destinationFloorKey]: destinationAccessPoint,
          },
        };
        const floorDelta = Math.abs(Number(destinationFloorKey) - Number(startFloorKey));
        const verticalCost =
          verticalTransitionPenalty * Math.max(1, Number.isFinite(floorDelta) ? floorDelta : 1);
        const totalDistance = startFloorRoute.distance + destinationFloorRoute.distance;
        const preferenceCost = connectorPreferenceScore(connector, userPreference);
        const totalCost = totalDistance + verticalCost + preferenceCost;
        const result: MultiFloorRouteResult = {
          success: true,
          type: 'multi-floor',
          connector: selectedConnector,
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
              instruction: `Take the ${formatConnectorInstructionNoun(connector)} from ${formatFloorLabel(startFloorKey)} to ${formatFloorLabel(destinationFloorKey)}`,
            },
            toHorizontalSegment(destinationFloorKey, destinationFloorRoute),
          ],
          debug: {
            connectorId: connector.id,
            connectorType: connector.type,
            originFloorElevatorNode: startFloorRoute.debug?.endSnap?.nodeId ?? null,
            destinationFloorElevatorNode:
              destinationFloorRoute.debug?.startSnap?.nodeId ?? null,
            originFloorRouteEndNode: startFloorRoute.debug?.graphNodeIds?.at(-1) ?? null,
            destinationFloorRouteStartNode:
              destinationFloorRoute.debug?.graphNodeIds?.[0] ?? null,
            routeNodeCountBeforeElevator:
              startFloorRoute.debug?.graphNodeIds?.length ??
              startFloorRoute.debug?.graphCoordinates?.length ??
              startFloorRoute.coordinates.length,
            routeNodeCountAfterElevator:
              destinationFloorRoute.debug?.graphNodeIds?.length ??
              destinationFloorRoute.debug?.graphCoordinates?.length ??
              destinationFloorRoute.coordinates.length,
            centerlineContinuity: {
              originRouteEndsAtConnector: pointsWithinToleranceMeters(
                getLastCoordinate(startFloorRoute),
                startAccessPoint,
                CONNECTOR_ENDPOINT_TOLERANCE_METERS,
              ),
              destinationRouteStartsAtConnector: pointsWithinToleranceMeters(
                getFirstCoordinate(destinationFloorRoute),
                destinationAccessPoint,
                CONNECTOR_ENDPOINT_TOLERANCE_METERS,
              ),
            },
            selectedConnectorAccessPoints: {
              [startFloorKey]: startAccessPoint,
              [destinationFloorKey]: destinationAccessPoint,
            },
            connectorAccessOptionCounts: {
              [startFloorKey]: startAccessOptions.length,
              [destinationFloorKey]: destinationAccessOptions.length,
            },
            startFloorRouteDistance: startFloorRoute.distance,
            destinationFloorRouteDistance: destinationFloorRoute.distance,
            verticalTransitionFloors: [startFloorKey, destinationFloorKey],
            totalCost,
          },
        };
        successfulConnectorTypes.add(connector.type);

        if (!bestCandidate || result.totalCost < bestCandidate.totalCost) {
          bestCandidate = result;
          bestDebug = result.debug ?? null;
        }
      }
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

  const availableConnectorTypes = Array.from(successfulConnectorTypes).sort(
    compareConnectorTypes,
  );
  bestCandidate.segments = bestCandidate.segments.map((segment) =>
    segment.type === 'vertical-transition'
      ? { ...segment, availableConnectorTypes }
      : segment,
  );

  console.log('[MultiFloorRoute] selected vertical connector', bestCandidate.connector);
  console.log(
    '[MultiFloorRoute] selected elevator ID',
    bestCandidate.connector?.type === 'elevator' ? bestCandidate.connector.id : null,
  );
  console.log('[MultiFloorRoute] continuity diagnostics', bestDebug);
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
  roomAnchorIndexesByFloor,
}: {
  roomsByFloor: Record<string, GeoJSONFeature[]>;
  routers: Record<string, IndoorRouter>;
  roomAnchorIndexesByFloor?: Record<string, CenterlineAnchorIndex | undefined>;
}): VerticalConnector[] {
  return buildVerticalConnectors({ roomsByFloor, routers, roomAnchorIndexesByFloor })
    .filter((connector) => connector.type === 'stairs');
}

export function buildVerticalConnectors({
  roomsByFloor,
  routers,
  roomAnchorIndexesByFloor = {},
  userPreference,
}: {
  roomsByFloor: Record<string, GeoJSONFeature[]>;
  routers: Record<string, IndoorRouter>;
  roomAnchorIndexesByFloor?: Record<string, CenterlineAnchorIndex | undefined>;
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
      createConnectorFromCluster(
        cluster,
        index,
        projection,
        routers,
        roomAnchorIndexesByFloor,
      ),
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
  roomAnchorIndexesByFloor: Record<string, CenterlineAnchorIndex | undefined>,
): VerticalConnector | null {
  const accessPoints: Record<string, RouteCoordinate> = {};
  const accessPointOptions: Record<string, RouteCoordinate[]> = {};
  const snapDistances: Record<string, number> = {};
  const featureKeysByFloor: Record<string, string[]> = {};
  const floors = Array.from(new Set(cluster.features.map((feature) => feature.floorKey)))
    .sort(compareFloorKeys);

  for (const floorKey of floors) {
    const router = routers[floorKey];
    if (!router) {
      continue;
    }

    const floorFeatures = cluster.features.filter((feature) => feature.floorKey === floorKey);
    const accessCandidates = findStairAccessPoints(
      floorFeatures,
      router,
      projection,
      roomAnchorIndexesByFloor[floorKey],
    );
    if (accessCandidates.length === 0) {
      continue;
    }

    accessPoints[floorKey] = accessCandidates[0].point;
    accessPointOptions[floorKey] = accessCandidates.map((candidate) => candidate.point);
    snapDistances[floorKey] = Math.round(accessCandidates[0].distanceMeters * 100) / 100;
    featureKeysByFloor[floorKey] = Array.from(
      new Set(floorFeatures.flatMap((feature) => getFeatureKeys(feature.feature))),
    );
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
    accessPointOptions,
    featureKeysByFloor,
    name: cluster.name,
    debug: {
      featureCount: cluster.features.length,
      snapDistances,
    },
  };
}

function getFirstCoordinate(route: RouteResult): RouteCoordinate | null {
  return (
    route.renderCoordinates?.[0] ??
    route.debug?.graphCoordinates?.[0] ??
    route.coordinates?.[0] ??
    null
  );
}

function getLastCoordinate(route: RouteResult): RouteCoordinate | null {
  return (
    route.renderCoordinates?.at(-1) ??
    route.debug?.graphCoordinates?.at(-1) ??
    route.coordinates?.at(-1) ??
    null
  );
}

function computeConnectorBoundRoute(
  router: IndoorRouter,
  start: RouteCoordinate,
  end: RouteCoordinate,
  connectorSide: 'start' | 'end',
): RouteResult {
  const connectorPoint = connectorSide === 'start' ? start : end;
  const connectorSnap = router.snapToGraph(connectorPoint);
  if (!connectorSnap) {
    return routeFailure('Unable to snap the selected connector to the centerline graph.');
  }

  const routeStart = connectorSide === 'start' ? connectorSnap.point : start;
  const routeEnd = connectorSide === 'end' ? connectorSnap.point : end;
  let route = router.computeRoute(routeStart, routeEnd);
  if (!route.success) {
    return route;
  }

  const routeConnectorCoordinate =
    connectorSide === 'start' ? getFirstCoordinate(route) : getLastCoordinate(route);
  if (
    !pointsWithinToleranceMeters(
      routeConnectorCoordinate,
      connectorSnap.point,
      CONNECTOR_ENDPOINT_TOLERANCE_METERS,
    )
  ) {
    route = router.computeRoute(routeStart, routeEnd);
  }

  const finalConnectorCoordinate =
    connectorSide === 'start' ? getFirstCoordinate(route) : getLastCoordinate(route);
  if (
    !route.success ||
    !pointsWithinToleranceMeters(
      finalConnectorCoordinate,
      connectorSnap.point,
      CONNECTOR_ENDPOINT_TOLERANCE_METERS,
    )
  ) {
    return routeFailure(
      `The ${connectorSide}-floor route does not connect to the selected connector node.`,
    );
  }

  return forceRouteEndpoint(route, connectorSnap.point, connectorSide);
}

function forceRouteEndpoint(
  route: RouteResult,
  connectorPoint: RouteCoordinate,
  side: 'start' | 'end',
): RouteResult {
  const replaceEndpoint = (coordinates: RouteCoordinate[] | undefined) => {
    if (!coordinates?.length) return coordinates;
    const next = coordinates.map((coordinate) => ({ ...coordinate }));
    const index = side === 'start' ? 0 : next.length - 1;
    next[index] = { ...connectorPoint };
    return next;
  };

  const renderCoordinates = replaceEndpoint(route.renderCoordinates) ?? [];
  const coordinates = replaceEndpoint(route.coordinates) ?? [];
  const graphCoordinates = replaceEndpoint(route.debug?.graphCoordinates);

  return {
    ...route,
    coordinates,
    renderCoordinates,
    waypointCount: coordinates.length,
    debug: route.debug
      ? {
          ...route.debug,
          graphCoordinates,
          renderedCoordinates: replaceEndpoint(route.debug.renderedCoordinates),
          finalGraphStart: graphCoordinates?.[0],
          finalGraphEnd: graphCoordinates?.at(-1),
        }
      : route.debug,
  };
}

function routeFailure(error: string): RouteResult {
  return {
    success: false,
    coordinates: [],
    renderCoordinates: [],
    distance: 0,
    waypointCount: 0,
    error,
  };
}

function pointsWithinToleranceMeters(
  left: RouteCoordinate | null,
  right: RouteCoordinate | null,
  toleranceMeters = 0.75,
): boolean {
  if (!left || !right) return false;
  const projection = createLocalProjection(
    (left.lng + right.lng) / 2,
    (left.lat + right.lat) / 2,
  );
  return distance(
    projection.project(left.lng, left.lat),
    projection.project(right.lng, right.lat),
  ) <= toleranceMeters;
}

function getFeatureKeys(feature: GeoJSONFeature): string[] {
  const props = feature.properties ?? {};
  const identifiers = [
    feature.id,
    props.id,
    props.room_id,
    props.FID,
    props.OBJECTID,
  ]
    .filter((value) => value !== undefined && value !== null && String(value).trim())
    .map((value) => String(value));

  if (identifiers.length > 0) {
    return identifiers;
  }

  return [props.name, props.roomname]
    .filter((value) => value !== undefined && value !== null && String(value).trim())
    .map((value) => String(value));
}

function findStairAccessPoints(
  candidates: StairFeatureCandidate[],
  router: IndoorRouter,
  projection: LocalProjection,
  roomAnchorIndex?: CenterlineAnchorIndex,
): AccessPointCandidate[] {
  const accessCandidates: AccessPointCandidate[] = [];

  const addAccessCandidate = (
    rawPoint: RouteCoordinate,
    source: AccessPointCandidate['source'],
  ) => {
    const snapped = router.snapToGraph(rawPoint);
    if (!snapped) {
      return;
    }

    accessCandidates.push({
      point: snapped.point,
      distanceMeters: snapped.distanceMeters + (snapped.kind === 'edge' ? 0.05 : 0),
      componentId: snapped.componentId ?? null,
      source,
    });
  };

  for (const candidate of candidates) {
    for (const anchor of getConnectorCenterlineAnchors(candidate, roomAnchorIndex)) {
      addAccessCandidate(anchor.coordinates, 'centerline-anchor');
    }

    const samplePoints = [
      candidate.centroid,
      ...sampleFeatureBoundary(candidate.feature, projection),
    ];

    for (const point of samplePoints) {
      addAccessCandidate(point, 'connector-geometry');
    }
  }

  return rankAccessCandidates(accessCandidates);
}

function getConnectorCenterlineAnchors(
  candidate: StairFeatureCandidate,
  roomAnchorIndex?: CenterlineAnchorIndex,
): CenterlineAnchor[] {
  if (!roomAnchorIndex) {
    return [];
  }

  const anchorNames = new Set([
    candidate.name,
    candidate.connectorType,
    getConnectorFallbackAnchorName(candidate.connectorType),
  ].map(normalizeAnchorName));

  return Array.from(anchorNames).flatMap(
    (name) => roomAnchorIndex.get(name) ?? [],
  );
}

function getConnectorFallbackAnchorName(type: VerticalConnectorType): string {
  if (type === 'elevator') return 'elevator';
  if (type === 'ramp') return 'ramp';
  return 'stairs';
}

function rankAccessCandidates(candidates: AccessPointCandidate[]): AccessPointCandidate[] {
  const unique = new Map<string, AccessPointCandidate>();

  for (const candidate of candidates) {
    const key = candidate.componentId === null
      ? `unknown:${candidate.point.lng.toFixed(7)}:${candidate.point.lat.toFixed(7)}`
      : `component:${candidate.componentId}`;
    const existing = unique.get(key);
    if (!existing || accessCandidateScore(candidate) < accessCandidateScore(existing)) {
      unique.set(key, candidate);
    }
  }

  return Array.from(unique.values())
    .sort((left, right) => accessCandidateScore(left) - accessCandidateScore(right))
    .slice(0, 12);
}

function accessCandidateScore(candidate: AccessPointCandidate): number {
  const sourcePenalty = candidate.source === 'centerline-anchor' ? 0 : 5;
  return sourcePenalty + candidate.distanceMeters;
}

function normalizeAnchorName(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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

function getConnectorType(name: string): VerticalConnectorType | null {
  if (ELEVATOR_NAME_PATTERN.test(name)) {
    return 'elevator';
  }

  if (RAMP_NAME_PATTERN.test(name)) {
    return 'ramp';
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
  const hierarchy = getConnectorPreferenceHierarchy(userPreference);
  const index = hierarchy.indexOf(connector.type);

  if (index >= 0) {
    return index * CONNECTOR_PREFERENCE_PENALTY;
  }

  return hierarchy.length * CONNECTOR_PREFERENCE_PENALTY;
}

function getConnectorPreferenceHierarchy(userPreference?: string): VerticalConnectorType[] {
  if (userPreference === 'stairs' || userPreference === 'stairs_first') {
    return ['stairs', 'elevator', 'ramp'];
  }

  if (userPreference === 'ramp' || userPreference === 'ramp_first') {
    return ['ramp', 'elevator', 'stairs'];
  }

  return DEFAULT_CONNECTOR_PREFERENCE;
}

function compareConnectorTypes(left: VerticalConnectorType, right: VerticalConnectorType): number {
  const order = { elevator: 0, ramp: 1, stairs: 2 };
  return order[left] - order[right];
}

function formatConnectorInstructionNoun(connector: VerticalConnector): string {
  if (connector.type === 'elevator') {
    return 'elevator';
  }

  if (connector.type === 'ramp') {
    return 'ramp';
  }

  const name = String(connector.name ?? '').toLowerCase();
  return name.includes('stair case') || name.includes('staircase')
    ? 'staircase'
    : 'stairs';
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
