import { describe, expect, it, vi } from 'vitest';
import { computeMultiFloorRoute, buildStairConnectors, IndoorRouter } from './index';
import type { RouteCoordinate } from './router';

const makeRoom = (floor: number, name: string, center: RouteCoordinate) => ({
  type: 'Feature' as const,
  geometry: {
    type: 'Polygon' as const,
    coordinates: [[
      [center.lng - 0.00001, center.lat - 0.00001],
      [center.lng + 0.00001, center.lat - 0.00001],
      [center.lng + 0.00001, center.lat + 0.00001],
      [center.lng - 0.00001, center.lat + 0.00001],
      [center.lng - 0.00001, center.lat - 0.00001],
    ]],
  },
  properties: {
    level: floor,
    name,
  },
});

const makeRouter = () => {
  const computeRoute = vi.fn((start: RouteCoordinate, end: RouteCoordinate) => ({
    success: true,
    coordinates: [start, end],
    renderCoordinates: [start, end],
    distance: Math.round(
      (Math.abs(start.lng - end.lng) + Math.abs(start.lat - end.lat)) * 100000,
    ),
    waypointCount: 2,
    debug: {
      renderedSegments: [{ valid: true, intersectsObstacle: false }],
    },
  }));
  const snapToGraph = vi.fn((point: RouteCoordinate) => ({
    kind: 'node',
    point,
    distanceMeters: 1,
    componentId: 0,
    nodeId: 'n0',
  }));

  return {
    computeRoute,
    snapToGraph,
  } as unknown as IndoorRouter & {
    computeRoute: typeof computeRoute;
    snapToGraph: typeof snapToGraph;
  };
};

describe('multi-floor routing orchestration', () => {
  it('delegates same-floor routes directly to the existing floor router', () => {
    const router = makeRouter();
    const result = computeMultiFloorRoute({
      start: { lng: -89, lat: 37 },
      startFloor: 1,
      destination: { lng: -89.0001, lat: 37.0001 },
      destinationFloor: 1,
      routers: { 1: router },
      roomsByFloor: {},
    });

    expect(result.success).toBe(true);
    expect(result.type).toBe('same-floor');
    expect(router.computeRoute).toHaveBeenCalledTimes(1);
    expect(result.segments).toHaveLength(1);
  });

  it('builds stair connectors and returns horizontal plus symbolic vertical segments', () => {
    const floor1Router = makeRouter();
    const floor7Router = makeRouter();
    const roomsByFloor = {
      1: [makeRoom(1, 'stairs area', { lng: -89.22, lat: 37.71 })],
      7: [makeRoom(7, 'stair case', { lng: -89.22001, lat: 37.71001 })],
    };

    const connectors = buildStairConnectors({
      roomsByFloor,
      routers: { 1: floor1Router, 7: floor7Router },
    });
    const result = computeMultiFloorRoute({
      start: { lng: -89.221, lat: 37.711 },
      startFloor: 1,
      destination: { lng: -89.219, lat: 37.709 },
      destinationFloor: 7,
      routers: { 1: floor1Router, 7: floor7Router },
      roomsByFloor,
    });

    expect(connectors).toHaveLength(1);
    expect(result.success).toBe(true);
    expect(result.type).toBe('multi-floor');
    expect(result.segments.map((segment) => segment.type)).toEqual([
      'horizontal',
      'vertical-transition',
      'horizontal',
    ]);
    expect(
      result.segments.some(
        (segment) =>
          segment.type === 'vertical-transition' &&
          segment.connectorType === 'stairs' &&
          segment.instruction.includes('stairs'),
      ),
    ).toBe(true);
    expect(floor1Router.computeRoute).toHaveBeenCalledWith(
      { lng: -89.221, lat: 37.711 },
      expect.any(Object),
    );
    expect(floor7Router.computeRoute).toHaveBeenCalledWith(
      expect.any(Object),
      { lng: -89.219, lat: 37.709 },
    );
  });

  it('selects an elevator by default when one connects both route floors', () => {
    const floor1Router = makeRouter();
    const floor7Router = makeRouter();
    const roomsByFloor = {
      1: [
        makeRoom(1, 'stairs area', { lng: -89.22, lat: 37.71 }),
        makeRoom(1, 'elevator', { lng: -89.225, lat: 37.715 }),
      ],
      7: [
        makeRoom(7, 'stair case', { lng: -89.22001, lat: 37.71001 }),
        makeRoom(7, 'elevator', { lng: -89.22501, lat: 37.71501 }),
      ],
    };

    const result = computeMultiFloorRoute({
      start: { lng: -89.221, lat: 37.711 },
      startFloor: 1,
      destination: { lng: -89.219, lat: 37.709 },
      destinationFloor: 7,
      routers: { 1: floor1Router, 7: floor7Router },
      roomsByFloor,
    });

    const transition = result.segments.find(
      (segment) => segment.type === 'vertical-transition',
    );

    expect(result.success).toBe(true);
    expect(transition).toMatchObject({
      connectorType: 'elevator',
      availableConnectorTypes: ['elevator', 'stairs'],
    });
    expect(result.connector?.featureKeysByFloor?.['1']).toContain('elevator');
    expect(result.connector?.featureKeysByFloor?.['7']).toContain('elevator');
    expect(result.debug).toMatchObject({
      connectorType: 'elevator',
      routeNodeCountBeforeElevator: 2,
      routeNodeCountAfterElevator: 2,
      centerlineContinuity: {
        originRouteEndsAtConnector: true,
        destinationRouteStartsAtConnector: true,
      },
    });
  });

  it('recomputes and enforces connector-bound horizontal endpoints', () => {
    const floor1Router = makeRouter();
    const floor4Router = makeRouter();
    const originalDestinationCompute = floor4Router.computeRoute.getMockImplementation();
    let destinationRouteCalls = 0;
    floor4Router.computeRoute.mockImplementation((start, end) => {
      destinationRouteCalls += 1;
      const route = originalDestinationCompute!(start, end);
      if (destinationRouteCalls === 1) {
        const wrongStart = { lng: start.lng + 0.0001, lat: start.lat };
        return {
          ...route,
          coordinates: [wrongStart, end],
          renderCoordinates: [wrongStart, end],
        };
      }
      return route;
    });

    const roomsByFloor = {
      1: [makeRoom(1, 'elevator', { lng: -89.225, lat: 37.715 })],
      4: [makeRoom(4, 'elevator', { lng: -89.22501, lat: 37.71501 })],
    };
    const result = computeMultiFloorRoute({
      start: { lng: -89.221, lat: 37.711 },
      startFloor: 1,
      destination: { lng: -89.219, lat: 37.709 },
      destinationFloor: 4,
      routers: { 1: floor1Router, 4: floor4Router },
      roomsByFloor,
    });

    expect(result.success).toBe(true);
    expect(floor4Router.computeRoute).toHaveBeenCalledTimes(2);
    const transition = result.segments[1];
    const destinationSegment = result.segments[2];
    expect(transition.type).toBe('vertical-transition');
    expect(destinationSegment.type).toBe('horizontal');
    if (transition.type === 'vertical-transition' && destinationSegment.type === 'horizontal') {
      expect(destinationSegment.renderCoordinates[0]).toEqual(
        transition.toAccessPoint,
      );
    }
  });

  it('allows explicit stairs-first routing to override the default elevator preference', () => {
    const floor1Router = makeRouter();
    const floor7Router = makeRouter();
    const roomsByFloor = {
      1: [
        makeRoom(1, 'stairs area', { lng: -89.22, lat: 37.71 }),
        makeRoom(1, 'elevator', { lng: -89.225, lat: 37.715 }),
      ],
      7: [
        makeRoom(7, 'stair case', { lng: -89.22001, lat: 37.71001 }),
        makeRoom(7, 'elevator', { lng: -89.22501, lat: 37.71501 }),
      ],
    };

    const result = computeMultiFloorRoute({
      start: { lng: -89.221, lat: 37.711 },
      startFloor: 1,
      destination: { lng: -89.219, lat: 37.709 },
      destinationFloor: 7,
      routers: { 1: floor1Router, 7: floor7Router },
      roomsByFloor,
      userPreference: 'stairs_first',
    });

    const transition = result.segments.find(
      (segment) => segment.type === 'vertical-transition',
    );

    expect(result.success).toBe(true);
    expect(transition).toMatchObject({
      connectorType: 'stairs',
      availableConnectorTypes: ['elevator', 'stairs'],
    });
  });

  it('falls back to stairs when no elevator connects both route floors', () => {
    const floor1Router = makeRouter();
    const floor7Router = makeRouter();
    const roomsByFloor = {
      1: [
        makeRoom(1, 'stairs area', { lng: -89.22, lat: 37.71 }),
        makeRoom(1, 'elevator', { lng: -89.225, lat: 37.715 }),
      ],
      7: [makeRoom(7, 'stair case', { lng: -89.22001, lat: 37.71001 })],
    };

    const result = computeMultiFloorRoute({
      start: { lng: -89.221, lat: 37.711 },
      startFloor: 1,
      destination: { lng: -89.219, lat: 37.709 },
      destinationFloor: 7,
      routers: { 1: floor1Router, 7: floor7Router },
      roomsByFloor,
    });

    const transition = result.segments.find(
      (segment) => segment.type === 'vertical-transition',
    );

    expect(result.success).toBe(true);
    expect(transition).toMatchObject({
      connectorType: 'stairs',
      availableConnectorTypes: ['stairs'],
    });
  });
});

describe('centerline graph endpoint snapping', () => {
  it('merges visually connected endpoints within the configured node tolerance', () => {
    const centerlines = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [-89.22, 37.71],
              [-89.219995, 37.71],
            ],
          },
        },
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [-89.2199945, 37.71],
              [-89.21999, 37.71],
            ],
          },
        },
      ],
    };
    const router = new IndoorRouter(centerlines as any, null, null, {
      maxSnapDistanceMeters: 5,
      nodeToleranceMeters: 0.1,
      simplifyCollinearPoints: false,
    });

    const result = router.computeRoute(
      { lng: -89.22, lat: 37.71 },
      { lng: -89.21999, lat: 37.71 },
    );

    expect(result.success).toBe(true);
    expect(router.getGraph().diagnostics.componentCount).toBe(1);
    expect(router.getGraph().diagnostics.geometryTypes.LineString).toBe(2);
  });
});
