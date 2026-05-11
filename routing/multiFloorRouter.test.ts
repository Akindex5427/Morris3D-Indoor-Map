import { describe, expect, it, vi } from 'vitest';
import { computeMultiFloorRoute, buildStairConnectors } from './multiFloorRouter';
import { IndoorRouter, RouteCoordinate } from './router';

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
});
