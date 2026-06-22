import React, { useState, useEffect, useRef, useMemo } from "react";
import DeckGL from "@deck.gl/react";
import Map from "react-map-gl";
import {
  PathLayer,
  TextLayer,
  IconLayer,
  ScatterplotLayer,
} from "@deck.gl/layers";
import { FlyToInterpolator, WebMercatorViewport } from "@deck.gl/core";
import { CollisionFilterExtension } from "@deck.gl/extensions";
import { useIndoorBuilding } from "./IndoorBuilding";
import { useBuildingWallLayers } from "../layers/buildingWallLayer";
import { usePerimeterWallLayer } from "../layers/perimeterWallLayer";
import { useStackedWallLayer } from "../layers/stackedWallLayer";
import "mapbox-gl/dist/mapbox-gl.css";

// Mapbox API token - Get yours free at https://account.mapbox.com/access-tokens/
const MAPBOX_ACCESS_TOKEN =
  import.meta.env.VITE_MAPBOX_TOKEN || "YOUR_MAPBOX_TOKEN_HERE";

// Available basemap styles
export const BASEMAP_STYLES = {
  topographic: {
    url: "mapbox://styles/mapbox/outdoors-v12",
    name: "Topographic",
    description: "Topographic map with terrain",
  },
  streets: {
    url: "mapbox://styles/mapbox/streets-v12",
    name: "Streets",
    description: "OpenStreetMap-style streets",
  },
};

const BUILDING_FLOOR_SPACING = 4.5;
const INITIAL_REVEAL_DURATION_MS = 2400;
const ROUTE_MARKER_PULSE_DURATION_MS = 16000;
const ROUTE_CAMERA_PADDING_PX = 96;
const ROUTE_CAMERA_TRANSITION_MS = 1200;
const ROUTE_CAMERA_MIN_ZOOM = 16.5;
const ROUTE_CAMERA_MAX_ZOOM = 20.5;
const ROUTE_LANDMARK_LABEL_LIMIT = 8;
const routeLabelCollisionExtension = new CollisionFilterExtension();

const clamp01 = (value) => Math.max(0, Math.min(1, value));

const easeOutCubic = (value) => 1 - Math.pow(1 - clamp01(value), 3);

const getRoomFeatureId = (featureOrRoom) => {
  const props = featureOrRoom?.properties || featureOrRoom || {};
  return props.id || props.name || props.room_id || props.OBJECTID || null;
};

const getRoomFeatureName = (featureOrRoom, fallback = "Room") => {
  const props = featureOrRoom?.properties || featureOrRoom || {};
  return props.name || props.id || props.room_id || fallback;
};

const normalizeRouteKey = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");

const getConnectorFeatureType = (featureOrRoom) => {
  const props = featureOrRoom?.properties || featureOrRoom || {};
  const searchableText = [
    props.name,
    props.type,
    props.id,
    props.room_id,
    props.roomname,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\belevators?\b|\blifts?\b/.test(searchableText)) return "elevator";
  if (/\bstairs?\b|\bstair\s*case\b|\bstaircase\b/.test(searchableText)) {
    return "stairs";
  }
  return null;
};

const distanceLngLatMeters = (a, b) => {
  if (!isValidLngLat(a) || !isValidLngLat(b)) return Infinity;
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng = Math.cos(lat) * metersPerDegreeLat;
  const dx = (a[0] - b[0]) * metersPerDegreeLng;
  const dy = (a[1] - b[1]) * metersPerDegreeLat;
  return Math.hypot(dx, dy);
};

const getRoomFeatureFloor = (featureOrRoom) => {
  const props = featureOrRoom?.properties || featureOrRoom || {};
  return props.level ?? props.floor ?? props.nivel ?? 0;
};

const getGeometryCoordinates = (geometry) => {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates.flat();
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.flatMap((polygon) => polygon.flat());
  }
  if (geometry.type === "LineString") return geometry.coordinates;
  if (geometry.type === "MultiLineString") return geometry.coordinates.flat();
  return [];
};

const getFeatureCentroid = (feature) => {
  const coords = getGeometryCoordinates(feature?.geometry).filter(
    (coord) => Number.isFinite(coord?.[0]) && Number.isFinite(coord?.[1]),
  );
  if (coords.length === 0) return null;
  const sum = coords.reduce(
    (acc, coord) => [acc[0] + coord[0], acc[1] + coord[1]],
    [0, 0],
  );
  return [sum[0] / coords.length, sum[1] / coords.length];
};

const isValidLngLat = (coords) =>
  Array.isArray(coords) &&
  Number.isFinite(coords[0]) &&
  Number.isFinite(coords[1]);

// ── Label geometry helpers ────────────────────────────────────────────────────

// Area-weighted centroid of a closed ring via the Shoelace theorem.
// Returns [lng, lat] or null for degenerate input.
const polygonRingCentroid = (ring) => {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-14) {
    // Degenerate polygon — vertex average of exterior ring (skip closing vertex)
    const pts = ring.slice(0, -1);
    if (!pts.length) return null;
    const sum = pts.reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0]);
    return [sum[0] / pts.length, sum[1] / pts.length];
  }
  return [cx / (6 * area), cy / (6 * area)];
};

// Ray-casting point-in-polygon (2-D; accurate enough for indoor WGS-84 scales).
const pointInPolygonRing = ([px, py], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (
      (yi > py) !== (yj > py) &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
};

const pointInPolygonRings = (point, rings) => {
  const [exterior, ...holes] = rings;
  if (!exterior || !pointInPolygonRing(point, exterior)) return false;
  return !holes.some((hole) => pointInPolygonRing(point, hole));
};

const distanceToSegment = (point, start, end) => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared),
  );
  return Math.hypot(point[0] - (start[0] + dx * t), point[1] - (start[1] + dy * t));
};

const distanceToPolygonEdges = (point, rings) => {
  let best = Infinity;
  for (const ring of rings) {
    for (let index = 0; index < ring.length - 1; index += 1) {
      best = Math.min(best, distanceToSegment(point, ring[index], ring[index + 1]));
    }
  }
  return best;
};

const pointOnSurface = (rings) => {
  const exterior = rings[0];
  if (!exterior?.length) return null;

  const lngs = exterior.map((coord) => coord[0]);
  const lats = exterior.map((coord) => coord[1]);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const candidates = [];

  const steps = 8;
  for (let xIndex = 1; xIndex < steps; xIndex += 1) {
    for (let yIndex = 1; yIndex < steps; yIndex += 1) {
      candidates.push([
        minLng + ((maxLng - minLng) * xIndex) / steps,
        minLat + ((maxLat - minLat) * yIndex) / steps,
      ]);
    }
  }

  return candidates
    .filter((point) => pointInPolygonRings(point, rings))
    .sort(
      (left, right) =>
        distanceToPolygonEdges(right, rings) - distanceToPolygonEdges(left, rings),
    )[0] ?? null;
};

// Returns the best label anchor position [lng, lat] for a GeoJSON feature:
//   1. Area-weighted centroid of the exterior ring — if it lies inside the polygon
//   2. Midpoint of the longest edge whose midpoint is inside the polygon
//   3. Vertex-average centroid as last resort
// Using area-weighted centroid instead of vertex-average prevents the label from
// drifting toward clusters of closely-spaced vertices (e.g. one busy corner of
// an L-shaped room), and the interior check guarantees the anchor is actually
// inside the room rather than in the adjacent corridor.
const getLabelPosition = (feature) => {
  let polygons = [];
  if (feature?.geometry?.type === "Polygon") {
    polygons = [feature.geometry.coordinates].filter(Boolean);
  } else if (feature?.geometry?.type === "MultiPolygon") {
    polygons = feature.geometry.coordinates.filter(Boolean);
  }
  if (polygons.length === 0) return null;

  // For multi-polygon, select the ring with the largest bounding-box area.
  const bestRings = polygons.reduce((best, rings) => {
    const exterior = rings?.[0];
    if (!exterior || exterior.length < 3) return best;
    const lngs = exterior.map((c) => c[0]);
    const lats = exterior.map((c) => c[1]);
    const area =
      (Math.max(...lngs) - Math.min(...lngs)) *
      (Math.max(...lats) - Math.min(...lats));
    return !best || area > best.area ? { rings, area } : best;
  }, null)?.rings;

  if (!bestRings?.length) return null;
  const bestRing = bestRings[0];

  const centroid = polygonRingCentroid(bestRing);
  if (!centroid || !Number.isFinite(centroid[0])) return null;

  // If centroid is inside the polygon we are done.
  if (pointInPolygonRings(centroid, bestRings)) return centroid;

  // Centroid falls outside (concave/L-shaped room) — use the midpoint of the
  // longest edge that itself lies inside the polygon.
  return pointOnSurface(bestRings) ?? centroid;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Marker elevation offset (in meters) - to ensure markers appear above floor surface
const MARKER_ELEVATION_OFFSET = 2.0; // Raise markers 2m above floor

const Map3D = ({
  selectedFloor,
  selectedFloors,
  lightingEnabled = true,
  translucency = 60,
  heightExaggeration = 1,
  onRoomSelect,
  filteredRooms,
  highlightedRoomId,
  hoveredRoomId,
  onRoomHover,
  colorScheme,
  viewState: externalViewState,
  onViewStateChange,
  onUserCameraInteraction,
  routePath = null,
  routeRenderPath = null,
  routeSegments = null,
  routeTransitionMarkers = null,
  routeFocus = null,
  routeFloorId = null,
  routeCameraKey = 0,
  roomsData = [],
  centerlinesData = {},
  activeFloor = "all",
  basemapStyle = "topographic",
  showPerimeterWall = true,
  perimeterWallUrl = "/wall.geojson",
  cinematicAnimationsEnabled = true,
  initialRevealReplayKey = 0,
  routePreview = null,
  highlightedStep = null,
}) => {
  const [geojsonData, setGeojsonData] = useState(null);
  const [initialViewState, setInitialViewState] = useState({
    longitude: 0,
    latitude: 0,
    zoom: 17,
    pitch: 45,
    bearing: 0,
  });
  const [internalViewState, setInternalViewState] = useState(initialViewState);
  const [isMounted, setIsMounted] = useState(false);
  const [webglError, setWebglError] = useState(null);
  const [revealProgress, setRevealProgress] = useState(
    cinematicAnimationsEnabled ? 0 : 1,
  );
  const [routeAnimationPhase, setRouteAnimationPhase] = useState(0);
  const deckRef = useRef(null);
  const containerRef = useRef(null);
  const lastRouteCameraKeyRef = useRef(0);
  const isAllFloorsSelected =
    selectedFloor === "all" || selectedFloor === "F-ALL";

  // Wait for component to mount before initializing DeckGL
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsMounted(true);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!cinematicAnimationsEnabled) {
      setRevealProgress(1);
      return undefined;
    }

    let frameId;
    const start = performance.now();
    const animate = (now) => {
      const progress = (now - start) / INITIAL_REVEAL_DURATION_MS;
      setRevealProgress(easeOutCubic(progress));
      if (progress < 1) {
        frameId = requestAnimationFrame(animate);
      } else {
        setRevealProgress(1);
      }
    };

    setRevealProgress(0);
    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [cinematicAnimationsEnabled, initialRevealReplayKey]);

  useEffect(() => {
    if (!cinematicAnimationsEnabled || !routePath?.length) {
      setRouteAnimationPhase(0);
      return undefined;
    }

    let frameId;
    const start = performance.now();
    const animate = (now) => {
      setRouteAnimationPhase(
        ((now - start) / ROUTE_MARKER_PULSE_DURATION_MS) % 1,
      );
      frameId = requestAnimationFrame(animate);
    };

    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [cinematicAnimationsEnabled, routePath]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    let frameId = null;
    const resizeObserver = new ResizeObserver(() => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }

      frameId = requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
        deckRef.current?.deck?.redraw(true);
      });
    });

    resizeObserver.observe(container);
    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      resizeObserver.disconnect();
    };
  }, []);

  // Convert roomsData to GeoJSON format and update geojsonData
  useEffect(() => {
    if (roomsData && roomsData.length > 0) {
      const data = {
        type: "FeatureCollection",
        features: roomsData,
      };
      setGeojsonData(data);

      // Calculate initial view based on data bounds (only on first load with 0,0)
      if (initialViewState.longitude === 0 && initialViewState.latitude === 0) {
        const coords = roomsData.flatMap((f) => {
          if (f.geometry && f.geometry.type === "LineString") {
            return f.geometry.coordinates || [];
          } else if (f.geometry && f.geometry.type === "Polygon") {
            return f.geometry.coordinates[0] || [];
          } else if (f.geometry && f.geometry.type === "MultiPolygon") {
            return f.geometry.coordinates.flatMap((p) => p[0] || []);
          }
          return [];
        });

        if (coords.length > 0) {
          const lngs = coords.map((c) => c[0]);
          const lats = coords.map((c) => c[1]);
          const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
          const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;

          const newViewState = {
            longitude: centerLng,
            latitude: centerLat,
            zoom: 17,
            pitch: 45,
            bearing: 0,
          };
          setInitialViewState(newViewState);
          setInternalViewState(newViewState);
        }
      }
    }
  }, [roomsData, initialViewState.longitude, initialViewState.latitude]);

  // Build the feature collection to display based on selection/filter state
  const getDisplayData = () => {
    if (!geojsonData || !geojsonData.features) {
      return { type: "FeatureCollection", features: [] };
    }

    let features = geojsonData.features;

    // Multi-floor selection: show selected floors and one floor above/below for context
    if (selectedFloors && selectedFloors.length > 0) {
      const maxFloor = Math.max(...selectedFloors);
      const minFloor = Math.min(...selectedFloors);
      features = features.filter((feature) => {
        const floor =
          feature.properties?.floor ||
          feature.properties?.nivel ||
          feature.properties?.level ||
          0;
        return floor >= minFloor - 1 && floor <= maxFloor + 1;
      });
    }
    // Single floor selection: show selected floor and minimal context
    else if (
      selectedFloor !== undefined &&
      selectedFloor !== null &&
      !isAllFloorsSelected
    ) {
      features = features.filter((feature) => {
        const floor =
          feature.properties?.floor ||
          feature.properties?.nivel ||
          feature.properties?.level ||
          0;
        return floor === selectedFloor;
      });
    }
    // 'all' selection leaves features intact (shows everything)

    // Apply room filtering if active
    if (filteredRooms && filteredRooms.length > 0) {
      features = features.filter((feature) => {
        const roomId = feature.properties?.id || feature.properties?.name || "";
        return filteredRooms.includes(roomId);
      });
    }

    return {
      type: "FeatureCollection",
      features: features,
    };
  };

  // Extract all unique floors from roomsData for F-ALL mode
  const allAvailableFloors = useMemo(() => {
    if (!geojsonData || !geojsonData.features) return [];
    const floors = [
      ...new Set(
        geojsonData.features.map(
          (f) =>
            f.properties?.floor ||
            f.properties?.nivel ||
            f.properties?.level ||
            0,
        ),
      ),
    ].sort((a, b) => a - b);
    return floors;
  }, [geojsonData]);

  // Determine which floors to pass to the IndoorBuilding hook
  const floorsToDisplay = useMemo(() => {
    // If specific floors are selected via FilterPanel
    if (selectedFloors && selectedFloors.length > 0) {
      return selectedFloors;
    }
    // If F-ALL is selected, pass all available floors to enable dollhouse mode
    if (isAllFloorsSelected) {
      return allAvailableFloors;
    }
    // If a single floor is selected
    if (selectedFloor !== undefined && selectedFloor !== null) {
      return [selectedFloor];
    }
    // Default: empty array
    return [];
  }, [selectedFloors, selectedFloor, isAllFloorsSelected, allAvailableFloors]);

  const indoorPresentation = useMemo(
    () => ({
      initialRevealActive: cinematicAnimationsEnabled && revealProgress < 1,
      revealProgress,
      routeFocus: routeFocus
        ? {
            ...routeFocus,
            active: true,
          }
        : null,
    }),
    [cinematicAnimationsEnabled, revealProgress, routeFocus],
  );

  // Use the new IndoorBuilding hook for ArcGIS Indoors-style visualization
  const displayData = getDisplayData();
  console.log("[Map3D] Display data:", {
    featureCount: displayData.features?.length || 0,
    floorsToDisplay,
    selectedFloors,
    selectedFloor,
  });

  const indoorBuildingResult = useIndoorBuilding({
    data: displayData,
    selectedFloors: floorsToDisplay,
    translucency: translucency / 100, // Convert from 0-100 to 0-1
    heightExaggeration,
    floorSpacing: BUILDING_FLOOR_SPACING, // 4.5m vertical spacing between floors (matches provided stack)
    highlightedRoomId,
    presentation: indoorPresentation,
    onRoomClick: (roomProps) => {
      const roomId = roomProps?.id || roomProps?.name || "";
      onRoomSelect(roomProps, roomId);
    },
  });

  const { layers: indoorLayers, lightingEffect } = indoorBuildingResult || {
    layers: [],
    lightingEffect: null,
  };

  const singleFloorWallIds = useMemo(() => {
    if ((selectedFloors?.length ?? 0) > 0) {
      return selectedFloors;
    }

    if (isAllFloorsSelected) {
      return [];
    }

    return selectedFloor !== undefined && selectedFloor !== null
      ? [selectedFloor]
      : [];
  }, [selectedFloor, selectedFloors, isAllFloorsSelected]);

  const singleFloorWallLayers = useBuildingWallLayers({
    visibleFloorIds: singleFloorWallIds,
  });

  const hasFloorSpecificWalls = singleFloorWallIds.length > 0;
  const perimeterWallLayers = usePerimeterWallLayer({
    url: perimeterWallUrl,
    enabled: showPerimeterWall && isAllFloorsSelected && !hasFloorSpecificWalls,
    presentation: indoorPresentation,
  });

  const stackedWallLayers = useStackedWallLayer({
    activeFloor: selectedFloor,
    selectedFloor,
    selectedFloors,
    presentation: indoorPresentation,
  });

  console.log("[Map3D] Indoor layers:", indoorLayers?.length || 0);

  const layers = [
    ...indoorLayers,
    ...singleFloorWallLayers,
    ...perimeterWallLayers,
    ...stackedWallLayers,
  ];
  const activeRenderPath =
    routeRenderPath && routeRenderPath.length > 1 ? routeRenderPath : routePath;
  const shouldRenderRoute =
    activeRenderPath &&
    activeRenderPath.length > 1 &&
    routeFloorId !== null &&
    (selectedFloors?.length ?? 0) === 0 &&
    activeFloor !== "all" &&
    Number(activeFloor) === routeFloorId;
  const isRouteDollhouse =
    selectedFloor === "all" || (selectedFloors && selectedFloors.length > 1);
  const routeElevation = (floorNum, offset = 0.05) => {
    const n = typeof floorNum === "number" ? floorNum : Number(floorNum) || 0;
    return isRouteDollhouse ? n * BUILDING_FLOOR_SPACING + offset : offset;
  };
  const shouldShowRouteFloor = (floor) =>
    activeFloor === "all" || Number(activeFloor) === Number(floor);

  // Convert preview path points to 3-D deck.gl coordinates
  const previewLayerData = useMemo(() => {
    if (!routePreview?.cursorPosition) return null;

    const isDH =
      selectedFloor === "all" || (selectedFloors && selectedFloors.length > 1);
    const elev = (floor, offset = 0.08) => {
      const n = typeof floor === "number" ? floor : Number(floor) || 0;
      return isDH ? n * BUILDING_FLOOR_SPACING + offset : offset;
    };

    const toCoords3D = (path) =>
      (path || []).map((pt) => [pt.coords[0], pt.coords[1], elev(pt.floor)]);

    return {
      traveled: toCoords3D(routePreview.traveledPath),
      remaining: toCoords3D(routePreview.remainingPath),
      cursor: [
        routePreview.cursorPosition.coords[0],
        routePreview.cursorPosition.coords[1],
        elev(routePreview.cursorPosition.floor, 0.4),
      ],
    };
  }, [routePreview, selectedFloor, selectedFloors]);
  const visibleRouteSegments = Array.isArray(routeSegments)
    ? routeSegments.filter(
        (segment) =>
          segment?.type === "horizontal" &&
          segment.path?.length > 1 &&
          shouldShowRouteFloor(segment.floorId),
      )
    : [];
  const visibleTransitionMarkers = Array.isArray(routeTransitionMarkers)
    ? routeTransitionMarkers.filter((marker) => shouldShowRouteFloor(marker.floor))
    : [];
  const routePinIcons = useMemo(() => {
    const createPinSVG = (color) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 48 48">
        <defs>
          <filter id="shadow">
            <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.35"/>
          </filter>
        </defs>
        <path d="M24 2C15.2 2 8 9.2 8 18c0 10.5 14 26 16 28 2-2 16-17.5 16-28 0-8.8-7.2-16-16-16zm0 22c-3.3 0-6-2.7-6-6s2.7-6 6-6 6 2.7 6 6-2.7 6-6 6z"
          fill="${color}" filter="url(#shadow)"/>
        <circle cx="24" cy="18" r="5" fill="white" opacity="0.92"/>
      </svg>`;
      return `data:image/svg+xml;base64,${btoa(svg)}`;
    };
    return {
      start: { url: createPinSVG("#16a34a"), width: 34, height: 34, anchorY: 34 },
      end: { url: createPinSVG("#dc2626"), width: 34, height: 34, anchorY: 34 },
    };
  }, []);
  const routeFocusMarkers = useMemo(() => {
    if (!routeFocus) return [];

    const markers = [
      { id: routeFocus.startRoomId, type: "start", label: "Start" },
      { id: routeFocus.endRoomId, type: "end", label: "Destination" },
    ];

    const focusMarkers = markers
      .map((marker) => {
        const feature = roomsData.find(
          (room) => getRoomFeatureId(room) === marker.id,
        );
        const coords = getLabelPosition(feature) ?? getFeatureCentroid(feature);
        if (!feature || !coords) return null;
        const floor = getRoomFeatureFloor(feature);
        if (!shouldShowRouteFloor(floor)) return null;
        return {
          ...marker,
          roomName: getRoomFeatureName(feature, marker.label),
          floor,
          position: [coords[0], coords[1], routeElevation(floor, 1.1)],
          glowPosition: [coords[0], coords[1], routeElevation(floor, 0.18)],
        };
      })
      .filter(Boolean);

    if (import.meta.env?.DEV !== false && focusMarkers.length > 0) {
      console.group(`[RouteLabels] Focus markers — ${focusMarkers.length}`);
      console.table(
        focusMarkers.map((m) => ({
          type: m.type,
          roomName: m.roomName,
          lng: m.position[0].toFixed(6),
          lat: m.position[1].toFixed(6),
          elev: m.position[2].toFixed(2),
        })),
      );
      console.groupEnd();
    }

    return focusMarkers;
  }, [roomsData, routeFocus, selectedFloor, selectedFloors, activeFloor]);
  const routeLandmarkMarkers = useMemo(() => {
    const landmarkItems = Array.isArray(routeFocus?.landmarks)
      ? routeFocus.landmarks
      : (routeFocus?.landmarkRoomIds || []).map((id) => ({ roomId: id }));
    if (!landmarkItems.length) return [];

    const seen = new Set();
    const markers = [];
    for (const landmark of landmarkItems) {
      const id = landmark.roomId || landmark.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const feature = roomsData.find((room) => getRoomFeatureId(room) === id);
      // Route-closest point: glow dot sits on the route line to connect the label
      // visually to the path.
      const routeCoords = Array.isArray(landmark.coords) ? landmark.coords : null;
      const landmarkLabelCoords = Array.isArray(landmark.labelCoords)
        ? landmark.labelCoords
        : null;
      // Label anchor: polygon interior point computed from the feature geometry.
      // Priority: area-weighted centroid (inside polygon) → routing-system roomCoords
      // → route access point (last resort, may be on centerline).
      const labelCoords =
        getLabelPosition(feature) ??
        landmarkLabelCoords ??
        (Array.isArray(landmark.roomCoords) ? landmark.roomCoords : null) ??
        getFeatureCentroid(feature);
      if (!feature || !labelCoords) continue;

      const floor = getRoomFeatureFloor(feature);
      if (!shouldShowRouteFloor(floor)) continue;

      markers.push({
        id,
        type: "landmark",
        roomName: getRoomFeatureName(feature, "Landmark"),
        floor,
        side: landmark.side ?? null,
        position: [labelCoords[0], labelCoords[1], routeElevation(floor, 0.86)],
        routePosition: routeCoords,
        glowPosition: [labelCoords[0], labelCoords[1], routeElevation(floor, 0.14)],
        pixelOffset: [0, 0],
        collisionPriority: 40 - markers.length,
      });

      if (markers.length >= ROUTE_LANDMARK_LABEL_LIMIT) break;
    }

    if (import.meta.env?.DEV !== false && markers.length > 0) {
      console.group(`[RouteLabels] Landmark markers — ${markers.length}`);
      console.table(
        markers.map((m) => ({
          name: m.roomName,
          side: m.side ?? "—",
          labelLng: m.position[0].toFixed(6),
          labelLat: m.position[1].toFixed(6),
          glowLng: m.glowPosition[0].toFixed(6),
          glowLat: m.glowPosition[1].toFixed(6),
          pixelOffset: m.pixelOffset.join(", "),
        })),
      );
      console.groupEnd();
    }

    return markers;
  }, [roomsData, routeFocus, selectedFloor, selectedFloors, activeFloor]);

  const usedConnectorRoomMarkers = useMemo(() => {
    const connectorKeys = new Set(
      (routeFocus?.connectorRoomIds || []).map(normalizeRouteKey).filter(Boolean),
    );
    const connectorFloors = new Set(
      visibleTransitionMarkers.map((marker) => Number(marker.floor)),
    );
    if (connectorKeys.size === 0 && visibleTransitionMarkers.length === 0) {
      return [];
    }

    const markers = [];
    const seen = new Set();
    const addConnectorFeature = (feature, connectorType, source) => {
      if (!feature) return false;
      const floor = getRoomFeatureFloor(feature);
      if (!shouldShowRouteFloor(floor)) return false;
      if (connectorFloors.size > 0 && !connectorFloors.has(Number(floor))) {
        return false;
      }
      const featureType = connectorType ?? getConnectorFeatureType(feature);
      if (!featureType) return false;

      const id = getRoomFeatureId(feature) ?? `${featureType}-${floor}-${markers.length}`;
      const markerKey = `${id}-${floor}`;
      if (seen.has(markerKey)) return false;

      const coords = getLabelPosition(feature) ?? getFeatureCentroid(feature);
      if (!coords) return false;

      seen.add(markerKey);
      markers.push({
        id,
        type: "connector",
        connectorType: featureType,
        source,
        roomName: getRoomFeatureName(
          feature,
          featureType === "elevator" ? "Elevator" : "Stairs",
        ),
        floor,
        position: [coords[0], coords[1], routeElevation(floor, 0.98)],
        glowPosition: [coords[0], coords[1], routeElevation(floor, 0.16)],
        collisionPriority: 80 - markers.length,
      });
      return true;
    };

    for (const feature of roomsData) {
      const connectorType = getConnectorFeatureType(feature);
      if (!connectorType) continue;
      const props = feature.properties || {};
      const featureKeys = [
        getRoomFeatureId(feature),
        props.name,
        props.id,
        props.room_id,
        props.OBJECTID,
      ]
        .map(normalizeRouteKey)
        .filter(Boolean);

      if (featureKeys.some((key) => connectorKeys.has(key))) {
        addConnectorFeature(feature, connectorType, "feature");
      }
    }

    for (const transition of visibleTransitionMarkers) {
      const transitionCoords = transition.coords;
      const transitionType = transition.connectorType;
      const matchingFeature = roomsData
        .filter((feature) => {
          if (Number(getRoomFeatureFloor(feature)) !== Number(transition.floor)) {
            return false;
          }
          const featureType = getConnectorFeatureType(feature);
          return (
            featureType &&
            (!transitionType || featureType === transitionType)
          );
        })
        .map((feature) => {
          const coords = getLabelPosition(feature) ?? getFeatureCentroid(feature);
          return {
            feature,
            coords,
            distanceMeters: distanceLngLatMeters(coords, transitionCoords),
          };
        })
        .filter((candidate) => candidate.coords && candidate.distanceMeters <= 12)
        .sort((left, right) => left.distanceMeters - right.distanceMeters)[0]
        ?.feature;

      if (matchingFeature) {
        addConnectorFeature(matchingFeature, transitionType, "feature");
        continue;
      }

      if (!isValidLngLat(transitionCoords)) continue;
      const fallbackKey = `${transitionType}-${transition.floor}-${transition.role}`;
      if (seen.has(fallbackKey)) continue;
      seen.add(fallbackKey);
      markers.push({
        id: fallbackKey,
        type: "connector",
        connectorType: transitionType,
        source: "transition",
        roomName: transitionType === "elevator" ? "Elevator" : "Stairs",
        floor: transition.floor,
        position: [
          transitionCoords[0],
          transitionCoords[1],
          routeElevation(transition.floor, 0.98),
        ],
        glowPosition: [
          transitionCoords[0],
          transitionCoords[1],
          routeElevation(transition.floor, 0.16),
        ],
        collisionPriority: 70 - markers.length,
      });
    }

    if (import.meta.env?.DEV !== false) {
      console.group(
        `[RouteLabels] Used connector markers — ${markers.length}`,
      );
      if (markers.length > 0) {
        console.table(
          markers.map((marker) => ({
            name: marker.roomName,
            type: marker.connectorType,
            source: marker.source,
            floor: marker.floor,
            labelLng: marker.position[0].toFixed(6),
            labelLat: marker.position[1].toFixed(6),
          })),
        );
      } else {
        console.log("none");
      }
      console.groupEnd();
    }

    return markers;
  }, [
    roomsData,
    routeFocus,
    selectedFloor,
    selectedFloors,
    activeFloor,
    visibleTransitionMarkers,
  ]);

  useEffect(() => {
    if (!routeCameraKey) {
      return;
    }

    if (routeCameraKey === lastRouteCameraKeyRef.current) {
      if (import.meta.env?.DEV !== false) {
        console.log("[RouteCamera] auto-fit skipped", {
          reason: "route already fitted",
          routeCameraKey,
        });
      }
      return;
    }

    if (!onViewStateChange) {
      if (import.meta.env?.DEV !== false) {
        console.log("[RouteCamera] auto-fit skipped", {
          reason: "missing view-state handler",
          routeCameraKey,
        });
      }
      return;
    }

    const routePoints = [];
    const addPoint = (coords) => {
      if (isValidLngLat(coords)) {
        routePoints.push([coords[0], coords[1]]);
      }
    };

    if (visibleRouteSegments.length > 0) {
      visibleRouteSegments.forEach((segment) => {
        segment.path?.forEach((point) => addPoint(point.coords));
      });
    } else if (shouldRenderRoute && activeRenderPath?.length > 0) {
      activeRenderPath.forEach((point) => addPoint(point.coords));
    }

    visibleTransitionMarkers.forEach((marker) => addPoint(marker.coords));
    routeFocusMarkers.forEach((marker) => addPoint(marker.position));
    routeLandmarkMarkers.forEach((marker) => addPoint(marker.position));
    usedConnectorRoomMarkers.forEach((marker) => addPoint(marker.position));

    if (routePoints.length === 0) {
      if (import.meta.env?.DEV !== false) {
        console.log("[RouteCamera] auto-fit skipped — no route points collected");
      }
      return;
    }

    const lngs = routePoints.map((point) => point[0]);
    const lats = routePoints.map((point) => point[1]);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const center = [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
    const containerBounds = containerRef.current?.getBoundingClientRect();
    const width = Math.max(320, containerBounds?.width || window.innerWidth);
    const height = Math.max(320, containerBounds?.height || window.innerHeight);
    const samePoint = minLng === maxLng && minLat === maxLat;

    let fittedViewState = {
      longitude: center[0],
      latitude: center[1],
      zoom: ROUTE_CAMERA_MAX_ZOOM,
    };

    if (!samePoint) {
      try {
        fittedViewState = new WebMercatorViewport({ width, height }).fitBounds(
          [
            [minLng, minLat],
            [maxLng, maxLat],
          ],
          {
            padding: Math.min(
              ROUTE_CAMERA_PADDING_PX,
              Math.floor(Math.min(width, height) * 0.22),
            ),
          },
        );
      } catch (error) {
        console.warn("[RouteCamera] Unable to fit route bounds.", error);
      }
    }

    if (import.meta.env?.DEV !== false) {
      console.log("[RouteCamera] auto-fit triggered", {
        pointCount: routePoints.length,
        center,
        zoom: clamp(fittedViewState.zoom, ROUTE_CAMERA_MIN_ZOOM, ROUTE_CAMERA_MAX_ZOOM),
      });
    }

    lastRouteCameraKeyRef.current = routeCameraKey;
    window.dispatchEvent(new Event("resize"));
    onViewStateChange({
      ...(externalViewState || internalViewState),
      longitude: fittedViewState.longitude,
      latitude: fittedViewState.latitude,
      zoom: clamp(
        fittedViewState.zoom,
        ROUTE_CAMERA_MIN_ZOOM,
        ROUTE_CAMERA_MAX_ZOOM,
      ),
      pitch: 0,
      bearing: 0,
      transitionDuration: ROUTE_CAMERA_TRANSITION_MS,
      transitionInterpolator: new FlyToInterpolator(),
    });
  }, [
    activeRenderPath,
    externalViewState,
    internalViewState,
    onViewStateChange,
    routeCameraKey,
    routeFocusMarkers,
    routeLandmarkMarkers,
    shouldRenderRoute,
    usedConnectorRoomMarkers,
    visibleRouteSegments,
    visibleTransitionMarkers,
  ]);

  // Add centerline graph overlay as blue lines
  const centerlinePaths = useMemo(() => {
    // Determine which floors' centerlines to show
    const floorsToShow =
      activeFloor === "all"
        ? Object.keys(centerlinesData).map(Number)
        : [
            typeof activeFloor === "number"
              ? activeFloor
              : parseInt(activeFloor, 10),
          ].filter(Number.isFinite);

    const paths = [];
    for (const floor of floorsToShow) {
      const geojson = centerlinesData[floor];
      if (!geojson) continue;

      const features = geojson.features || [];
      for (const feature of features) {
        if (!feature.geometry) continue;
        const geomType = feature.geometry.type;
        const coordSets =
          geomType === "LineString"
            ? [feature.geometry.coordinates]
            : geomType === "MultiLineString"
              ? feature.geometry.coordinates
              : [];

        for (const coords of coordSets) {
          if (coords.length < 2) continue;
          paths.push({
            path: coords.map((c) => [c[0], c[1]]),
            floor,
          });
        }
      }
    }
    return paths;
  }, [centerlinesData, activeFloor]);

  // REFACTOR: Centerline network is now hidden by default
  // The centerline data remains loaded in memory for graph-based routing,
  // but is NOT rendered as visible layers on the map.
  // Only computed routes are shown to users (see route rendering below).
  // This provides a clean map interface - users only see their requested route,
  // not the entire digitized centerline network.
  /*
  if (centerlinePaths.length > 0) {
    const isDollhouse =
      selectedFloor === "all" || (selectedFloors && selectedFloors.length > 1);
    const centerlineElev = (floorNum) =>
      isDollhouse ? floorNum * BUILDING_FLOOR_SPACING + 0.02 : 0.02;

    const pathsWithElev = centerlinePaths.map((d) => ({
      path: d.path.map((c) => [c[0], c[1], centerlineElev(d.floor)]),
    }));

    layers.push(
      new PathLayer({
        id: "centerline-graph-lines",
        data: pathsWithElev,
        getPath: (d) => d.path,
        getColor: [40, 120, 255, 180], // blue with slight transparency
        getWidth: 1.5,
        widthMinPixels: 1,
        widthMaxPixels: 4,
        widthScale: 1,
        rounded: true,
        billboard: false,
        pickable: false,
        parameters: { depthTest: false, depthMask: false },
      }),
    );
  }
  */

  if (visibleRouteSegments.length > 0) {
    if (previewLayerData) {
      // ── Preview mode: split path + cursor ────────────────────────────────
      if (previewLayerData.remaining.length > 1) {
        layers.push(
          new PathLayer({
            id: "multi-floor-preview-remaining-border",
            data: [{ path: previewLayerData.remaining }],
            getPath: (d) => d.path,
            getColor: [10, 60, 160, 45],
            getWidth: 5, widthMinPixels: 3, widthMaxPixels: 8,
            rounded: true, billboard: false, pickable: false,
            parameters: { depthTest: false, depthMask: false },
          }),
        );
        layers.push(
          new PathLayer({
            id: "multi-floor-preview-remaining-main",
            data: [{ path: previewLayerData.remaining }],
            getPath: (d) => d.path,
            getColor: [26, 115, 232, 55],
            getWidth: 3, widthMinPixels: 2, widthMaxPixels: 5,
            rounded: true, billboard: false, pickable: false,
            parameters: { depthTest: false, depthMask: false },
          }),
        );
      }
      if (previewLayerData.traveled.length > 1) {
        layers.push(
          new PathLayer({
            id: "multi-floor-preview-traveled-border",
            data: [{ path: previewLayerData.traveled }],
            getPath: (d) => d.path,
            getColor: [10, 60, 160, 220],
            getWidth: 5, widthMinPixels: 3, widthMaxPixels: 8,
            rounded: true, billboard: false, pickable: false,
            parameters: { depthTest: false, depthMask: false },
          }),
        );
        layers.push(
          new PathLayer({
            id: "multi-floor-preview-traveled-main",
            data: [{ path: previewLayerData.traveled }],
            getPath: (d) => d.path,
            getColor: [26, 115, 232, 255],
            getWidth: 3, widthMinPixels: 2, widthMaxPixels: 5,
            rounded: true, billboard: false, pickable: false,
            parameters: { depthTest: false, depthMask: false },
          }),
        );
      }
    } else {
      // ── Normal mode ────────────────────────────────────────────────────────
      const pathLayerData = visibleRouteSegments.map((segment) => ({
        path: segment.path.map((point) => [
          point.coords[0],
          point.coords[1],
          routeElevation(point.floor, 0.08),
        ]),
        floor: segment.floorId,
      }));

      layers.push(
        new PathLayer({
          id: "multi-floor-route-path-border",
          data: pathLayerData,
          getPath: (d) => d.path,
          getColor: [10, 60, 160, 220],
          getWidth: 5, widthMinPixels: 3, widthMaxPixels: 8, widthScale: 1,
          rounded: true, billboard: false, pickable: false,
          parameters: { depthTest: false, depthMask: false },
        }),
      );
      layers.push(
        new PathLayer({
          id: "multi-floor-route-path-main",
          data: pathLayerData,
          getPath: (d) => d.path,
          getColor: [26, 115, 232, 255],
          getWidth: 3, widthMinPixels: 2, widthMaxPixels: 5, widthScale: 1,
          rounded: true, billboard: false, pickable: true,
          parameters: { depthTest: false, depthMask: false },
        }),
      );
    }
  }

  if (visibleTransitionMarkers.length > 0) {
    const createStairSVG = () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="18" fill="#fbbc04" stroke="#8a5f00" stroke-width="3"/>
        <path d="M14 31h6v-5h6v-5h8" fill="none" stroke="#202124" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
      return `data:image/svg+xml;base64,${btoa(svg)}`;
    };
    const createElevatorSVG = () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="18" fill="#dbeafe" stroke="#1d4ed8" stroke-width="3"/>
        <rect x="15" y="13" width="18" height="22" rx="2" fill="none" stroke="#1e3a8a" stroke-width="3"/>
        <path d="M24 16v16M19 21l-3-3-3 3M29 27l3 3 3-3" fill="none" stroke="#1e3a8a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
      return `data:image/svg+xml;base64,${btoa(svg)}`;
    };
    const stairIcon = {
      url: createStairSVG(),
      width: 36,
      height: 36,
      anchorY: 18,
    };
    const elevatorIcon = {
      url: createElevatorSVG(),
      width: 36,
      height: 36,
      anchorY: 18,
    };
    const markerData = visibleTransitionMarkers.map((marker) => ({
      ...marker,
      position: [
        marker.coords[0],
        marker.coords[1],
        routeElevation(marker.floor, 0.35),
      ],
    }));

    layers.push(
      new IconLayer({
        id: "route-transition-markers",
        data: markerData,
        getPosition: (d) => d.position,
        getIcon: (d) =>
          d.connectorType === "elevator" ? elevatorIcon : stairIcon,
        getSize: 30,
        sizeUnits: "pixels",
        sizeScale: 1,
        pickable: true,
        billboard: true,
        opacity: 1,
      }),
    );

    layers.push(
      new TextLayer({
        id: "route-transition-labels",
        data: markerData.filter(
          (marker) =>
            !usedConnectorRoomMarkers.some(
              (connector) =>
                connector.source === "feature" &&
                Number(connector.floor) === Number(marker.floor) &&
                connector.connectorType === marker.connectorType,
            ),
        ),
        getPosition: (d) => [d.position[0], d.position[1], d.position[2] + 0.1],
        getText: (d) => (d.connectorType === "elevator" ? "Elevator" : "Stairs"),
        getSize: 10,
        getColor: [32, 33, 36, 255],
        getTextAnchor: "middle",
        getAlignmentBaseline: "bottom",
        sizeUnits: "pixels",
        pickable: false,
        billboard: true,
      }),
    );
  }

  if (usedConnectorRoomMarkers.length > 0) {
    layers.push(
      new ScatterplotLayer({
        id: "route-used-connector-room-glow",
        data: usedConnectorRoomMarkers,
        getPosition: (d) => d.glowPosition,
        getRadius: 1.25,
        radiusUnits: "meters",
        getFillColor: [251, 188, 4, 78],
        getLineColor: [138, 95, 0, 190],
        lineWidthMinPixels: 1,
        stroked: true,
        filled: true,
        pickable: false,
        parameters: { depthTest: false, depthMask: false },
      }),
    );

    layers.push(
      new TextLayer({
        id: "route-used-connector-room-labels",
        data: usedConnectorRoomMarkers,
        getPosition: (d) => d.position,
        getText: (d) => d.roomName,
        getSize: 10.5,
        getColor: [73, 48, 0, 245],
        getBackgroundColor: [255, 248, 220, 232],
        background: true,
        backgroundPadding: [4, 3],
        getTextAnchor: "middle",
        getAlignmentBaseline: "center",
        sizeUnits: "pixels",
        billboard: true,
        extensions: [routeLabelCollisionExtension],
        collisionEnabled: true,
        collisionGroup: "route-room-labels",
        getCollisionPriority: (d) => d.collisionPriority,
        pickable: true,
        parameters: { depthTest: false, depthMask: false },
      }),
    );
  }

  if (routeFocusMarkers.length > 0) {
    const pulse = cinematicAnimationsEnabled
      ? 1 + Math.sin(routeAnimationPhase * Math.PI * 2) * 0.12
      : 1;

    layers.push(
      new ScatterplotLayer({
        id: "route-focus-room-glow",
        data: routeFocusMarkers,
        getPosition: (d) => d.glowPosition,
        getRadius: (d) => (d.type === "start" ? 1.55 : 1.7) * pulse,
        radiusUnits: "meters",
        getFillColor: (d) =>
          d.type === "start" ? [22, 163, 74, 95] : [220, 38, 38, 95],
        getLineColor: (d) =>
          d.type === "start" ? [20, 83, 45, 210] : [127, 29, 29, 210],
        lineWidthMinPixels: 2,
        stroked: true,
        filled: true,
        pickable: false,
        parameters: { depthTest: false, depthMask: false },
      }),
    );

    layers.push(
      new IconLayer({
        id: "route-focus-start-end-markers",
        data: routeFocusMarkers,
        getPosition: (d) => d.position,
        getIcon: (d) => routePinIcons[d.type],
        getSize: () => 30 * pulse,
        sizeUnits: "pixels",
        pickable: true,
        billboard: true,
        opacity: cinematicAnimationsEnabled
          ? Math.min(1, 0.55 + routeAnimationPhase * 1.8)
          : 1,
        parameters: { depthTest: false, depthMask: false },
      }),
    );

    layers.push(
      new TextLayer({
        id: "route-focus-room-labels",
        data: routeFocusMarkers,
        getPosition: (d) => [
          d.position[0],
          d.position[1],
          d.position[2] + 0.55,
        ],
        getText: (d) => d.roomName,
        getSize: 12,
        getColor: [8, 37, 82, 255],
        getBackgroundColor: [255, 255, 255, 230],
        background: true,
        backgroundPadding: [4, 3],
        getTextAnchor: "middle",
        getAlignmentBaseline: "bottom",
        sizeUnits: "pixels",
        billboard: true,
        extensions: [routeLabelCollisionExtension],
        collisionEnabled: true,
        collisionGroup: "route-room-labels",
        getCollisionPriority: (d) => (d.type === "end" ? 110 : 100),
        pickable: false,
        parameters: { depthTest: false, depthMask: false },
      }),
    );
  }

  if (routeLandmarkMarkers.length > 0) {
    layers.push(
      new ScatterplotLayer({
        id: "route-landmark-room-glow",
        data: routeLandmarkMarkers,
        getPosition: (d) => d.glowPosition,
        getRadius: 1.15,
        radiusUnits: "meters",
        getFillColor: [26, 115, 232, 62],
        getLineColor: [26, 115, 232, 170],
        lineWidthMinPixels: 1,
        stroked: true,
        filled: true,
        pickable: false,
        parameters: { depthTest: false, depthMask: false },
      }),
    );

    layers.push(
      new TextLayer({
        id: "route-landmark-room-labels",
        data: routeLandmarkMarkers,
        getPosition: (d) => d.position,
        getText: (d) => d.roomName,
        getSize: 10.5,
        getColor: [8, 37, 82, 235],
        getBackgroundColor: [239, 246, 255, 220],
        background: true,
        backgroundPadding: [4, 3],
        getPixelOffset: (d) => d.pixelOffset,
        getTextAnchor: "middle",
        getAlignmentBaseline: "center",
        sizeUnits: "pixels",
        billboard: true,
        extensions: [routeLabelCollisionExtension],
        collisionEnabled: true,
        collisionGroup: "route-room-labels",
        getCollisionPriority: (d) => d.collisionPriority,
        pickable: true,
        parameters: { depthTest: false, depthMask: false },
      }),
    );
  }

  if (shouldRenderRoute) {
    const isDollhouse =
      selectedFloor === "all" || (selectedFloors && selectedFloors.length > 1);
    const pathElevation = (floorNum) =>
      isDollhouse ? floorNum * BUILDING_FLOOR_SPACING + 0.05 : 0.05;

    if (previewLayerData) {
      // ── Preview mode: dim remaining path + bright traveled + cursor ────────
      if (previewLayerData.remaining.length > 1) {
        layers.push(
          new PathLayer({
            id: "route-preview-remaining-border",
            data: [{ path: previewLayerData.remaining }],
            getPath: (d) => d.path,
            getColor: [10, 60, 160, 45],
            getWidth: 5, widthMinPixels: 3, widthMaxPixels: 8,
            rounded: true, billboard: false, pickable: false,
            parameters: { depthTest: false, depthMask: false },
          }),
        );
        layers.push(
          new PathLayer({
            id: "route-preview-remaining-main",
            data: [{ path: previewLayerData.remaining }],
            getPath: (d) => d.path,
            getColor: [26, 115, 232, 55],
            getWidth: 3, widthMinPixels: 2, widthMaxPixels: 5,
            rounded: true, billboard: false, pickable: false,
            parameters: { depthTest: false, depthMask: false },
          }),
        );
      }
      if (previewLayerData.traveled.length > 1) {
        layers.push(
          new PathLayer({
            id: "route-preview-traveled-border",
            data: [{ path: previewLayerData.traveled }],
            getPath: (d) => d.path,
            getColor: [10, 60, 160, 220],
            getWidth: 5, widthMinPixels: 3, widthMaxPixels: 8,
            rounded: true, billboard: false, pickable: false,
            parameters: { depthTest: false, depthMask: false },
          }),
        );
        layers.push(
          new PathLayer({
            id: "route-preview-traveled-main",
            data: [{ path: previewLayerData.traveled }],
            getPath: (d) => d.path,
            getColor: [26, 115, 232, 255],
            getWidth: 3, widthMinPixels: 2, widthMaxPixels: 5,
            rounded: true, billboard: false, pickable: false,
            parameters: { depthTest: false, depthMask: false },
          }),
        );
      }
    } else {
      // ── Normal mode ────────────────────────────────────────────────────────
      const pathCoords = activeRenderPath.map((point) => {
        const floorNum = typeof point.floor === "number" ? point.floor : 0;
        return [...point.coords, pathElevation(floorNum)];
      });

      layers.push(
        new PathLayer({
          id: "route-path-border",
          data: [{ path: pathCoords }],
          getPath: (d) => d.path,
          getColor: [10, 60, 160, 220],
          getWidth: 5, widthMinPixels: 3, widthMaxPixels: 8, widthScale: 1,
          rounded: true, billboard: false, pickable: false,
          parameters: { depthTest: false, depthMask: false },
        }),
      );
      layers.push(
        new PathLayer({
          id: "route-path-main",
          data: [{ path: pathCoords }],
          getPath: (d) => d.path,
          getColor: [26, 115, 232, 255],
          getWidth: 3, widthMinPixels: 2, widthMaxPixels: 5, widthScale: 1,
          rounded: true, billboard: false, pickable: true,
          parameters: { depthTest: false, depthMask: false },
        }),
      );
    }
  }

  // ── Active connector highlight (vertical step is current) ─────────────────
  // Renders a pulsing amber ring at the stair/elevator access point when the
  // user has navigated to a floor-transition step.
  if (
    highlightedStep?.type === "vertical" &&
    isValidLngLat(highlightedStep.coords)
  ) {
    const connFloor =
      typeof highlightedStep.floor === "number" ? highlightedStep.floor : 0;
    const connPos = [
      highlightedStep.coords[0],
      highlightedStep.coords[1],
      routeElevation(connFloor, 0.6),
    ];
    const pulse = 1 + Math.sin(routeAnimationPhase * Math.PI * 2) * 0.22;

    layers.push(
      new ScatterplotLayer({
        id: "active-connector-highlight-outer",
        data: [{ position: connPos }],
        getPosition: (d) => d.position,
        getRadius: 5.5 * pulse,
        radiusUnits: "meters",
        getFillColor: [249, 168, 37, Math.round(38 * pulse)],
        stroked: false,
        filled: true,
        pickable: false,
        parameters: { depthTest: false, depthMask: false },
      }),
    );
    layers.push(
      new ScatterplotLayer({
        id: "active-connector-highlight-ring",
        data: [{ position: connPos }],
        getPosition: (d) => d.position,
        getRadius: 3.5 * pulse,
        radiusUnits: "meters",
        getFillColor: [249, 168, 37, Math.round(65 * pulse)],
        getLineColor: [138, 95, 0, 230],
        lineWidthMinPixels: 2,
        stroked: true,
        filled: true,
        pickable: false,
        parameters: { depthTest: false, depthMask: false },
      }),
    );
  }

  // ── Shared preview cursor (rendered for both single and multi-floor) ────────
  if (previewLayerData?.cursor) {
    layers.push(
      new ScatterplotLayer({
        id: "route-preview-cursor-halo",
        data: [{ position: previewLayerData.cursor }],
        getPosition: (d) => d.position,
        getRadius: 3.5,
        radiusUnits: "meters",
        getFillColor: [255, 255, 255, 60],
        stroked: false, filled: true, pickable: false,
        parameters: { depthTest: false, depthMask: false },
      }),
    );
    layers.push(
      new ScatterplotLayer({
        id: "route-preview-cursor-dot",
        data: [{ position: previewLayerData.cursor }],
        getPosition: (d) => d.position,
        getRadius: 2.0,
        radiusUnits: "meters",
        getFillColor: [255, 255, 255, 255],
        getLineColor: [26, 115, 232, 255],
        lineWidthMinPixels: 2.5,
        stroked: true, filled: true, pickable: false,
        parameters: { depthTest: false, depthMask: false },
      }),
    );
  }

  // Show WebGL error if detected
  if (webglError) {
    return (
      <div
        ref={containerRef}
        className="map-3d-container map-error-state"
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#1a1a1a",
          color: "#ffffff",
          padding: "20px",
          textAlign: "center",
        }}
      >
        <h2 style={{ color: "#ff6b6b", marginBottom: "20px" }}>
          ⚠️ WebGL Not Available
        </h2>
        <p style={{ marginBottom: "10px", maxWidth: "600px" }}>
          WebGL is disabled or not supported in your browser. This application
          requires WebGL for 3D rendering.
        </p>
        <div
          style={{
            marginTop: "20px",
            textAlign: "left",
            maxWidth: "600px",
            fontSize: "14px",
          }}
        >
          <p style={{ fontWeight: "bold", marginBottom: "10px" }}>
            To enable WebGL:
          </p>
          <ol style={{ paddingLeft: "20px" }}>
            <li>
              Open browser settings (chrome://settings/system or
              edge://settings/system)
            </li>
            <li>Enable "Use hardware acceleration when available"</li>
            <li>Restart your browser</li>
          </ol>
          <p style={{ marginTop: "15px" }}>
            Test WebGL:{" "}
            <a
              href="https://get.webgl.org/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#4dabf7" }}
            >
              https://get.webgl.org/
            </a>
          </p>
        </div>
      </div>
    );
  }

  // Don't render until we have data and component is mounted
  if (
    !isMounted ||
    !geojsonData ||
    !geojsonData.features ||
    geojsonData.features.length === 0
  ) {
    return (
      <div ref={containerRef} className="map-3d-container map-loading-state">
        Loading map data...
      </div>
    );
  }

  return (
    <div ref={containerRef} className="map-3d-container">
      <DeckGL
        ref={deckRef}
        width="100%"
        height="100%"
        viewState={externalViewState || internalViewState}
        onViewStateChange={({ viewState: newViewState, interactionState }) => {
          setInternalViewState(newViewState);
          if (onViewStateChange) {
            onViewStateChange(newViewState);
          }
          if (
            onUserCameraInteraction &&
            interactionState &&
            (interactionState.isDragging ||
              interactionState.isPanning ||
              interactionState.isRotating ||
              interactionState.isZooming)
          ) {
            onUserCameraInteraction();
          }
        }}
        controller={{
          dragPan: true,
          dragRotate: true,
          scrollZoom: true,
          touchZoom: true,
          touchRotate: true,
          doubleClickZoom: true,
          keyboard: true,
          inertia: true,
          minZoom: 14,
          maxZoom: 22,
          minPitch: 0,
          maxPitch: 85,
        }}
        layers={layers}
        effects={lightingEnabled && lightingEffect ? [lightingEffect] : []}
        parameters={{
          depthTest: true,
          blend: true,
          blendFunc: [770, 771], // GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA
          depthFunc: 515, // GL_LEQUAL
        }}
        getCursor={() => "grab"}
        getTooltip={null}
        style={{ width: "100%", height: "100%" }}
        onWebGLInitialized={(gl) => {
          if (gl) {
            console.log("WebGL initialized successfully", gl);
            setWebglError(null);
          } else {
            console.error("WebGL initialization failed");
            setWebglError("WebGL context could not be created");
          }
        }}
        onError={(error) => {
          console.error("DeckGL error:", error);
          if (error.message && error.message.includes("WebGL")) {
            setWebglError(error.message);
          }
        }}
      >
        {MAPBOX_ACCESS_TOKEN &&
          MAPBOX_ACCESS_TOKEN !== "YOUR_MAPBOX_TOKEN_HERE" && (
            <Map
              mapboxAccessToken={MAPBOX_ACCESS_TOKEN}
              mapStyle={
                BASEMAP_STYLES[basemapStyle]?.url ||
                BASEMAP_STYLES.topographic.url
              }
              dragPan={false}
              dragRotate={false}
              scrollZoom={false}
              doubleClickZoom={false}
              touchZoom={false}
              touchRotate={false}
              keyboard={false}
            />
          )}
      </DeckGL>
    </div>
  );
};

export default Map3D;
