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
const ROUTE_FLOW_ANIMATION_DURATION_MS = 7000;
const ROUTE_FLOW_MAX_MARKERS = 3;
const ROUTE_FLOW_MARKER_SPACING_DEGREES = 0.000095;
const ROUTE_FLOW_MARKER_SIZE_PX = 16;
const ROUTE_FLOW_MARKER_OPACITY = 0.78;
const ROUTE_CAMERA_PADDING_PX = 96;
const ROUTE_CAMERA_TRANSITION_MS = 1200;
const ROUTE_CAMERA_MIN_ZOOM = 16.5;
const ROUTE_CAMERA_MAX_ZOOM = 20.5;
const ROUTE_LANDMARK_LABEL_LIMIT = 8;

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

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const getRouteSegmentAngle = (from, to) => {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
};

const interpolateRoutePoint = (path, targetDistance) => {
  if (!Array.isArray(path) || path.length < 2) return null;
  let walked = 0;
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1];
    const to = path[index];
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const segmentLength = Math.hypot(dx, dy);
    if (segmentLength <= 0) continue;
    if (walked + segmentLength >= targetDistance) {
      const t = (targetDistance - walked) / segmentLength;
      return {
        position: [
          from[0] + dx * t,
          from[1] + dy * t,
          from[2] + ((to[2] || 0) - (from[2] || 0)) * t,
        ],
        angle: getRouteSegmentAngle(from, to),
      };
    }
    walked += segmentLength;
  }
  const last = path[path.length - 1];
  const previous = path[path.length - 2];
  return { position: last, angle: getRouteSegmentAngle(previous, last) };
};

const buildFlowMarkers = (path, phase, count = ROUTE_FLOW_MAX_MARKERS) => {
  if (!Array.isArray(path) || path.length < 2) return [];
  let totalLength = 0;
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1];
    const to = path[index];
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    totalLength += length;
  }
  if (totalLength <= 0) return [];
  const markerCount = Math.min(
    count,
    Math.max(1, Math.floor(totalLength / ROUTE_FLOW_MARKER_SPACING_DEGREES)),
  );
  return Array.from({ length: markerCount }, (_, index) => {
    const offset = ((index / markerCount + phase) % 1) * totalLength;
    return interpolateRoutePoint(path, offset);
  }).filter(Boolean);
};

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
        ((now - start) / ROUTE_FLOW_ANIMATION_DURATION_MS) % 1,
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
  const routeChevronIcon = useMemo(() => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <path d="M16 5l10 14h-6v8h-8v-8H6z" fill="#ffffff" stroke="#052f7c" stroke-width="2" stroke-linejoin="round"/>
    </svg>`;
    return {
      url: `data:image/svg+xml;base64,${btoa(svg)}`,
      width: 32,
      height: 32,
      anchorX: 16,
      anchorY: 16,
    };
  }, []);
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
  const activeSingleRoutePathCoords =
    shouldRenderRoute && activeRenderPath?.length > 1
      ? activeRenderPath.map((point) => [
          point.coords[0],
          point.coords[1],
          routeElevation(point.floor, 0.08),
        ])
      : null;
  const routeFocusMarkers = useMemo(() => {
    if (!routeFocus) return [];

    const markers = [
      { id: routeFocus.startRoomId, type: "start", label: "Start" },
      { id: routeFocus.endRoomId, type: "end", label: "Destination" },
    ];

    return markers
      .map((marker) => {
        const feature = roomsData.find(
          (room) => getRoomFeatureId(room) === marker.id,
        );
        const coords = getFeatureCentroid(feature);
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
  }, [roomsData, routeFocus, selectedFloor, selectedFloors, activeFloor]);
  const routeLandmarkMarkers = useMemo(() => {
    if (!routeFocus?.landmarkRoomIds?.length) return [];

    const seen = new Set();
    const markers = [];
    for (const id of routeFocus.landmarkRoomIds) {
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const feature = roomsData.find((room) => getRoomFeatureId(room) === id);
      const coords = getFeatureCentroid(feature);
      if (!feature || !coords) continue;

      const floor = getRoomFeatureFloor(feature);
      if (!shouldShowRouteFloor(floor)) continue;

      markers.push({
        id,
        type: "landmark",
        roomName: getRoomFeatureName(feature, "Landmark"),
        floor,
        position: [coords[0], coords[1], routeElevation(floor, 0.86)],
        glowPosition: [coords[0], coords[1], routeElevation(floor, 0.14)],
      });

      if (markers.length >= ROUTE_LANDMARK_LABEL_LIMIT) break;
    }

    return markers;
  }, [roomsData, routeFocus, selectedFloor, selectedFloors, activeFloor]);

  useEffect(() => {
    if (
      !routeCameraKey ||
      routeCameraKey === lastRouteCameraKeyRef.current ||
      !onViewStateChange
    ) {
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

    if (routePoints.length === 0) {
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
        getWidth: 5,
        widthMinPixels: 3,
        widthMaxPixels: 8,
        widthScale: 1,
        rounded: true,
        billboard: false,
        pickable: false,
        parameters: { depthTest: false, depthMask: false },
      }),
    );

    layers.push(
      new PathLayer({
        id: "multi-floor-route-path-main",
        data: pathLayerData,
        getPath: (d) => d.path,
        getColor: [26, 115, 232, 255],
        getWidth: 3,
        widthMinPixels: 2,
        widthMaxPixels: 5,
        widthScale: 1,
        rounded: true,
        billboard: false,
        pickable: true,
        parameters: { depthTest: false, depthMask: false },
      }),
    );

    if (cinematicAnimationsEnabled) {
      const flowData = pathLayerData.flatMap((routeSegment, segmentIndex) =>
        buildFlowMarkers(routeSegment.path, routeAnimationPhase).map(
          (marker, markerIndex) => ({
            ...marker,
            id: `${segmentIndex}-${markerIndex}`,
          }),
        ),
      );

      layers.push(
        new IconLayer({
          id: "multi-floor-route-flow-chevrons",
          data: flowData,
          getPosition: (d) => d.position,
          getIcon: () => routeChevronIcon,
          getAngle: (d) => d.angle,
          getSize: ROUTE_FLOW_MARKER_SIZE_PX,
          sizeUnits: "pixels",
          pickable: false,
          billboard: true,
          opacity: ROUTE_FLOW_MARKER_OPACITY,
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
    const stairIcon = {
      url: createStairSVG(),
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
        getIcon: () => stairIcon,
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
        data: markerData,
        getPosition: (d) => [d.position[0], d.position[1], d.position[2] + 0.1],
        getText: () => "Stairs",
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
        getTextAnchor: "middle",
        getAlignmentBaseline: "bottom",
        sizeUnits: "pixels",
        billboard: true,
        pickable: true,
        parameters: { depthTest: false, depthMask: false },
      }),
    );
  }

  // Add route visualization layers if route exists
  console.log("[Map3D] routePath prop:", routePath);
  console.log("[Map3D] routeRenderPath prop:", routeRenderPath);
  if (shouldRenderRoute) {
    console.log(
      "[Map3D] Rendering route with",
      activeRenderPath.length,
      "graph points",
    );

    // Elevation strategy:
    // - In single-floor mode, IndoorBuilding normalizes the selected floor so
    //   the floor surface sits near Z=0 while stairs can still rise above it.
    // - In dollhouse mode, floors are stacked at floorNum * floorSpacing.
    // So: single-floor → path at Z≈0; dollhouse → path at floorNum * spacing.
    const isDollhouse =
      selectedFloor === "all" || (selectedFloors && selectedFloors.length > 1);
    const pathElevation = (floorNum) =>
      isDollhouse ? floorNum * BUILDING_FLOOR_SPACING + 0.05 : 0.05;

    const pathCoords = activeRenderPath.map((point) => {
      const floorNum = typeof point.floor === "number" ? point.floor : 0;
      return [...point.coords, pathElevation(floorNum)]; // [lon, lat, elevation]
    });

    console.log("[Map3D] Route path coordinates:", pathCoords);
    console.log(
      "[Map3D] pathCoords length:",
      pathCoords.length,
      "First:",
      pathCoords[0],
      "Last:",
      pathCoords[pathCoords.length - 1],
    );

    // Route line – depthTest disabled so it always paints on top of floor geometry
    // without being occluded by 3D room extrusions or suffering z-fighting.

    // Outer dark-blue border for contrast
    layers.push(
      new PathLayer({
        id: "route-path-border",
        data: [{ path: pathCoords }],
        getPath: (d) => d.path,
        getColor: [10, 60, 160, 220],
        getWidth: 5,
        widthMinPixels: 3,
        widthMaxPixels: 8,
        widthScale: 1,
        rounded: true,
        billboard: false,
        pickable: false,
        parameters: { depthTest: false, depthMask: false },
      }),
    );

    // Main Google-blue fill
    layers.push(
      new PathLayer({
        id: "route-path-main",
        data: [{ path: pathCoords }],
        getPath: (d) => d.path,
        getColor: [26, 115, 232, 255], // vivid Google blue
        getWidth: 3,
        widthMinPixels: 2,
        widthMaxPixels: 5,
        widthScale: 1,
        rounded: true,
        billboard: false,
        pickable: true,
        parameters: { depthTest: false, depthMask: false },
      }),
    );

    if (cinematicAnimationsEnabled && activeSingleRoutePathCoords) {
      const flowData = buildFlowMarkers(
        activeSingleRoutePathCoords,
        routeAnimationPhase,
      );
      layers.push(
        new IconLayer({
          id: "route-flow-chevrons",
          data: flowData,
          getPosition: (d) => d.position,
          getIcon: () => routeChevronIcon,
          getAngle: (d) => d.angle,
          getSize: ROUTE_FLOW_MARKER_SIZE_PX,
          sizeUnits: "pixels",
          pickable: false,
          billboard: true,
          opacity: ROUTE_FLOW_MARKER_OPACITY,
          parameters: { depthTest: false, depthMask: false },
        }),
      );
    }

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
        onViewStateChange={({ viewState: newViewState }) => {
          setInternalViewState(newViewState);
          if (onViewStateChange) {
            onViewStateChange(newViewState);
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
