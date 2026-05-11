import React, { useState, useEffect, useMemo, useRef } from "react";
import { FlyToInterpolator } from "@deck.gl/core";
import "./App.css";
import Map3D from "./components/Map3D";
import FloorSwitcher from "./components/FloorSwitcher";
import SearchBar from "./components/SearchBar";
import RoomInfoPopup from "./components/RoomInfoPopup";
import FilterPanel from "./components/FilterPanel";
import VisualControls from "./components/VisualControls";
import Legend from "./components/Legend";
import RoutePlanner from "./components/RoutePlanner";
import LoadingSpinner from "./components/LoadingSpinner";
import HelpOverlay from "./components/HelpOverlay";
import DirectionsPanel from "./components/DirectionsPanel";
import { computeMultiFloorRoute, IndoorRouter } from "../routing";
import {
  buildRoomAnchorIndex,
  getRoomCentroid,
  getRoomFloor,
  getRoomName,
  resolveRoomRoutingTarget,
} from "./utils/routeAnchors";
import {
  countFeaturesMissingBaseHeight,
  countFeaturesMissingColor,
  enrichMissingFeatureDisplayProperties,
} from "./utils/featureColors";
import {
  generateMultiFloorRouteInstructions,
  generateRouteInstructions,
} from "./utils/routeInstructions";

const centerlinesHaveRoomAnchors = (centerlinesGeoJson) =>
  Array.isArray(centerlinesGeoJson?.features) &&
  centerlinesGeoJson.features.some((feature) => {
    const properties = feature?.properties || {};
    return Boolean(properties.startroom || properties.endroom);
  });

const DEFAULT_SIDEBAR_WIDTH = 360;
const MIN_SIDEBAR_WIDTH = 280;
const MAX_SIDEBAR_WIDTH = 520;
const SIDEBAR_COLLAPSE_THRESHOLD = 180;

const ROUTER_CONFIG = [
  {
    floor: 0,
    centerline: "/basemment_centerlines.geojson",
    walkable: "/room_basement_walkable.geojson",
    obstacle: "/room_basement_obstacle_buffered.geojson",
    label: "Basement",
  },
  {
    floor: 1,
    centerline: "/room_level_1_centerlines.geojson",
    walkable: "/room_level_1_walkable.geojson",
    obstacle: "/room_level_1_obstacle_buffered.geojson",
    label: "Level 1",
  },
  {
    floor: 2,
    centerline: "/room_level_2_centerlines.geojson",
    walkable: "/room_level_2_walkable.geojson",
    obstacle: "/room_level_2_obstacle_buffered.geojson",
    label: "Level 2",
  },
  {
    floor: 3,
    centerline: "/room_level_3_centerlines.geojson",
    walkable: "/room_level_3_walkable.geojson",
    obstacle: "/room_level_3_obstacle_buffered.geojson",
    label: "Level 3",
  },
  {
    floor: 4,
    centerline: "/room_level_4_centerlines.geojson",
    walkable: "/room_level_4_walkable.geojson",
    obstacle: "/room_level_4_obstacle_buffered.geojson",
    label: "Level 4",
  },
  {
    floor: 5,
    centerline: "/room_level_5_centerlines.geojson",
    walkable: "/room_level_5_walkable.geojson",
    obstacle: "/room_level_5_obstacle_buffered.geojson",
    label: "Level 5",
  },
  {
    floor: 6,
    centerline: "/room_level_6_centerlines.geojson",
    label: "Level 6",
    useCenterlineOnlyRouting: true,
    simplifyCollinearPoints: false,
  },
  {
    floor: 7,
    centerline: "/room_level_7_centerlines.geojson",
    walkable: "/room_level_7_walkable.geojson",
    obstacle: "/room_level_7_obstacle_buffered.geojson",
    label: "Level 7",
  },
];

function App() {
  const [selectedFloor, setSelectedFloor] = useState("all");
  const [allRooms, setAllRooms] = useState([]);
  const [filteredRooms, setFilteredRooms] = useState([]);
  const [selectedFloors, setSelectedFloors] = useState([]);
  const [highlightedRoomId, setHighlightedRoomId] = useState(null);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [popupPosition, setPopupPosition] = useState(null);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [availableFloors, setAvailableFloors] = useState([]);
  const [viewState, setViewState] = useState({
    longitude: 0,
    latitude: 0,
    zoom: 17,
    pitch: 45,
    bearing: 0,
  });
  const [lightingEnabled, setLightingEnabled] = useState(true);
  const [translucency, setTranslucency] = useState(60); // default translucency percentage for non-selected floors
  const [basemapStyle, setBasemapStyle] = useState("topographic"); // topographic or streets
  const [showRoutePlanner, setShowRoutePlanner] = useState(false);
  const [routeContext, setRouteContext] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [hoveredRoomId, setHoveredRoomId] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showDirections, setShowDirections] = useState(true);
  const [highlightedStep, setHighlightedStep] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [routers, setRouters] = useState({});
  const [routerError, setRouterError] = useState(null);
  const [centerlinesData, setCenterlinesData] = useState({});
  const [roomAnchorIndexes, setRoomAnchorIndexes] = useState({});
  const [allFloorRouteRooms, setAllFloorRouteRooms] = useState([]);
  const allFloorsColorReferenceRef = useRef(null);
  const sidebarDragRef = useRef(null);
  const suppressSidebarClickRef = useRef(false);

  // Initialize IndoorRouter with graph-based routing for all floors
  useEffect(() => {
    const initializeRouters = async () => {
      try {
        const loadGeoJson = async (path, { required = false } = {}) => {
          if (!path) {
            return null;
          }

          const response = await fetch(path);
          if (!response.ok) {
            if (required) {
              throw new Error(`Unable to load required routing data from ${path}.`);
            }
            return null;
          }

          return response.json();
        };

        const newRouters = {};
        const newCenterlines = {};
        const newRoomAnchorIndexes = {};

        for (const config of ROUTER_CONFIG) {
          try {
            const [centerlines, walkable, obstacles] = await Promise.all([
              loadGeoJson(config.centerline, { required: true }),
              loadGeoJson(config.walkable),
              loadGeoJson(config.obstacle),
            ]);

            if (
              !config.useCenterlineOnlyRouting &&
              (!walkable || !obstacles)
            ) {
              console.warn(
                `⚠ Routing data missing for ${config.label} (floor ${config.floor}). Skipping...`,
              );
            }

            const router = new IndoorRouter(
              centerlines,
              config.useCenterlineOnlyRouting ? null : walkable,
              config.useCenterlineOnlyRouting ? null : obstacles,
              {
                maxSnapDistanceMeters: 50,
                nodeToleranceMeters: 0.05,
                validationSampleStepMeters: 0.5,
                simplifyCollinearPoints:
                  config.simplifyCollinearPoints ??
                  (config.floor !== 1 &&
                    config.floor !== 3 &&
                    config.floor !== 5),
              },
            );
            newRouters[config.floor] = router;

            if (router.getGraph().validationFallbackUsed) {
              console.warn(
                `[Routing] Validation data rejected the graph for ${config.label} (floor ${config.floor}). Using centerline-only routing.`,
              );
            }

            // Store raw centerlines GeoJSON for blue-line overlay
            newCenterlines[config.floor] = centerlines;

            if (centerlinesHaveRoomAnchors(centerlines)) {
              newRoomAnchorIndexes[config.floor] =
                buildRoomAnchorIndex(centerlines);
            }

            console.log(
              `✓ Router initialized for ${config.label} (floor ${config.floor})`,
            );
          } catch (floorError) {
            console.error(
              `Error initializing router for floor ${config.floor}:`,
              floorError,
            );
          }
        }

        setRouters(newRouters);
        setCenterlinesData(newCenterlines);
        setRoomAnchorIndexes(newRoomAnchorIndexes);
        console.log(
          `✓ Graph-based routers initialized for ${Object.keys(newRouters).length} floors`,
        );
      } catch (error) {
        console.error("Router initialization failed:", error);
        setRouterError(error.message);
      }
    };

    initializeRouters();
  }, []);

  // Apply dark mode to body
  useEffect(() => {
    if (darkMode) {
      document.body.classList.add("dark-mode");
    } else {
      document.body.classList.remove("dark-mode");
    }
  }, [darkMode]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e) => {
      // Don't trigger shortcuts when typing in inputs
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")
        return;

      switch (e.key.toLowerCase()) {
        case "0":
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6":
        case "7":
          handleFloorChange(parseInt(e.key));
          break;
        case "a":
          handleFloorChange("all");
          break;
        case "r":
          handleViewReset();
          break;
        case "l":
          setLightingEnabled((prev) => !prev);
          break;
        case "d":
          setDarkMode((prev) => !prev);
          break;
        case "f":
          setShowFilterPanel((prev) => !prev);
          break;
        case "p":
          setShowRoutePlanner((prev) => !prev);
          break;
        case "?":
          setShowHelp((prev) => !prev);
          break;
        case "escape":
          setShowHelp(false);
          setShowFilterPanel(false);
          setShowRoutePlanner(false);
          setSelectedRoom(null);
          setShowDirections(false);
          break;
        case "arrowup":
          setViewState((prev) => ({
            ...prev,
            pitch: Math.min(85, prev.pitch + 5),
          }));
          break;
        case "arrowdown":
          setViewState((prev) => ({
            ...prev,
            pitch: Math.max(0, prev.pitch - 5),
          }));
          break;
        case "arrowleft":
          setViewState((prev) => ({ ...prev, bearing: prev.bearing - 15 }));
          break;
        case "arrowright":
          setViewState((prev) => ({ ...prev, bearing: prev.bearing + 15 }));
          break;
        case "+":
        case "=":
          setViewState((prev) => ({
            ...prev,
            zoom: Math.min(22, prev.zoom + 0.5),
          }));
          break;
        case "-":
        case "_":
          setViewState((prev) => ({
            ...prev,
            zoom: Math.max(14, prev.zoom - 0.5),
          }));
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, []);

  // Polygon extrusion sources (primary) and optional line overlays (outlines)
  const FLOOR_POLYGON_MAP = {
    "-1": "/rooms-basement-WGS.geojson",
    0: "/rooms-basement-WGS.geojson",
    1: "/rooms-level-01-WGS.geojson",
    2: "/rooms-level-02-WGS.geojson",
    3: "/rooms-level-03-WGS.geojson",
    4: "/rooms-level-04-WGS.geojson",
    5: "/rooms-level-5-WGS.geojson",
    6: "/rooms-level-6-WGS.geojson",
    7: "/rooms-level-7-WGS.geojson",
    all: "/rooms-all-WGS-v6.geojson",
  };

  // Line overlays are optional - removed since we're using polygons now
  const FLOOR_LINE_MAP = {
    "-1": null,
    0: null,
    1: null,
    2: null,
    3: null,
    4: null,
    5: null,
    6: null,
    7: null,
    all: null,
  };

  const fetchGeoJson = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load ${url}`);
    return response.json();
  };

  useEffect(() => {
    const loadRouteRoomIndex = async () => {
      try {
        const data = await fetchGeoJson(FLOOR_POLYGON_MAP.all);
        setAllFloorRouteRooms(data.features || []);
      } catch (error) {
        console.warn(
          "[Routing] Unable to load all-floor room data for multi-floor routing.",
          error,
        );
      }
    };

    loadRouteRoomIndex();
  }, []);

  useEffect(() => {
    const resizeTimer = window.setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 240);

    return () => window.clearTimeout(resizeTimer);
  }, [sidebarCollapsed, sidebarWidth]);

  const handleSidebarToggleClick = () => {
    if (suppressSidebarClickRef.current) {
      suppressSidebarClickRef.current = false;
      return;
    }

    setSidebarCollapsed((collapsed) => !collapsed);
  };

  const handleSidebarDragStart = (event) => {
    if (event.button !== 0) {
      return;
    }

    sidebarDragRef.current = {
      startX: event.clientX,
      startWidth: sidebarCollapsed ? 0 : sidebarWidth,
      hasDragged: false,
    };

    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleSidebarDragMove = (event) => {
    const dragState = sidebarDragRef.current;
    if (!dragState) {
      return;
    }

    const deltaX = event.clientX - dragState.startX;
    const nextWidth = dragState.startWidth + deltaX;

    if (Math.abs(deltaX) > 4) {
      dragState.hasDragged = true;
      suppressSidebarClickRef.current = true;
    }

    if (!dragState.hasDragged) {
      return;
    }

    if (nextWidth < SIDEBAR_COLLAPSE_THRESHOLD) {
      setSidebarCollapsed(true);
      return;
    }

    const clampedWidth = Math.min(
      MAX_SIDEBAR_WIDTH,
      Math.max(MIN_SIDEBAR_WIDTH, nextWidth),
    );

    setSidebarCollapsed(false);
    setSidebarWidth(clampedWidth);
  };

  const handleSidebarDragEnd = (event) => {
    const dragState = sidebarDragRef.current;
    sidebarDragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);

    if (!dragState?.hasDragged) {
      return;
    }

    window.setTimeout(() => {
      suppressSidebarClickRef.current = false;
    }, 0);
  };

  const routeRoomsByFloor = useMemo(() => {
    const grouped = {};
    const sourceRooms = allFloorRouteRooms.length > 0 ? allFloorRouteRooms : allRooms;

    for (const room of sourceRooms) {
      const floor = getRoomFloor(room);
      if (floor === null) {
        continue;
      }

      const floorKey = String(floor);
      grouped[floorKey] = grouped[floorKey] || [];
      grouped[floorKey].push(room);
    }

    return grouped;
  }, [allFloorRouteRooms, allRooms]);

  const loadAllFloorDisplayReference = async () => {
    if (!allFloorsColorReferenceRef.current) {
      allFloorsColorReferenceRef.current = fetchGeoJson(FLOOR_POLYGON_MAP.all)
        .catch((error) => {
          allFloorsColorReferenceRef.current = null;
          throw error;
        });
    }

    return allFloorsColorReferenceRef.current;
  };

  // Load GeoJSON data based on selected floor
  useEffect(() => {
    const loadGeojson = async () => {
      try {
        const key = selectedFloor.toString();
        const polygonUrl = FLOOR_POLYGON_MAP[key] || FLOOR_POLYGON_MAP.all;

        // Load polygon data only (no line overlays needed with polygon files)
        const response = await fetch(polygonUrl);
        if (!response.ok) throw new Error(`Failed to load ${polygonUrl}`);
        const data = await response.json();

        let polygons = data.features || [];

        const needsDisplayMetadataRepair =
          selectedFloor !== "all" &&
          (countFeaturesMissingColor(polygons) > 0 ||
            countFeaturesMissingBaseHeight(polygons) > 0);

        if (needsDisplayMetadataRepair) {
          try {
            const displayReference = await loadAllFloorDisplayReference();
            polygons = enrichMissingFeatureDisplayProperties(
              polygons,
              displayReference.features || [],
              { floor: Number(selectedFloor) },
            );
          } catch (displayMetadataError) {
            console.warn(
              `[Display Metadata] Unable to enrich missing floor metadata for floor ${selectedFloor}.`,
              displayMetadataError,
            );
          }
        }

        // In F-ALL mode, keep level metadata as-is for stacking
        const features =
          selectedFloor === "all"
            ? polygons
            : polygons.map((feature) => ({
                ...feature,
                properties: {
                  ...feature.properties,
                  level:
                    feature.properties?.level ??
                    feature.properties?.floor ??
                    feature.properties?.nivel ??
                    selectedFloor,
                },
              }));

        // Use polygons directly (no line overlays)
        const combinedFeatures = features;

        if (combinedFeatures.length > 0) {
          setAllRooms(combinedFeatures);

          // Extract unique floors (supporting floor, nivel, and level properties)
          const floors = [
            ...new Set(
              polygons.map(
                (f) =>
                  f.properties?.floor ||
                  f.properties?.nivel ||
                  f.properties?.level ||
                  0,
              ),
            ),
          ].sort((a, b) => a - b);

          // Safety: if the dataset failed to report floors, default to all levels
          const resolvedFloors =
            floors.length > 0 ? floors : [0, 1, 2, 3, 4, 5, 6, 7];

          setAvailableFloors(resolvedFloors);

          // Calculate initial view bounds
          const coords = polygons.flatMap((f) => {
            if (f.geometry?.type === "Polygon") {
              return f.geometry.coordinates[0];
            } else if (f.geometry?.type === "MultiPolygon") {
              return f.geometry.coordinates.flatMap((p) => p[0]);
            } else if (f.geometry?.type === "LineString") {
              return f.geometry.coordinates;
            }
            return [];
          });

          if (coords.length > 0) {
            const lngs = coords.map((c) => c[0]);
            const lats = coords.map((c) => c[1]);
            const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
            const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;

            setViewState((prev) => ({
              ...prev,
              longitude: centerLng,
              latitude: centerLat,
            }));
          }
        }
      } catch (error) {
        console.error("Error loading GeoJSON:", error);
      } finally {
        setIsLoading(false);
      }
    };

    setIsLoading(true);
    loadGeojson();
  }, [selectedFloor]);

  const handleFloorChange = (floor) => {
    const routeFloors = routeContext?.route?.info?.floors ?? [];
    const routeVisibleOnFloor =
      routeContext?.type === "multi-floor"
        ? floor === "all" || routeFloors.includes(Number(floor))
        : routeContext?.floorId === floor;

    if (routeContext && !routeVisibleOnFloor) {
      setRouteContext(null);
      setShowDirections(false);
      setHighlightedStep(null);
    }

    setSelectedFloor(floor);
    setSelectedFloors([]);
    setSelectedRoom(null);
    setHighlightedRoomId(null);
  };

  const handleRoomSelect = (roomProperties, roomId) => {
    setSelectedRoom(roomProperties);
    setHighlightedRoomId(roomId);

    // Position popup near click location
    setPopupPosition({
      x: window.innerWidth / 2 - 150,
      y: window.innerHeight / 2 - 150,
    });

    // Smooth camera animation to room (if geometry available)
    const feature = allRooms.find(
      (r) => (r.properties?.id || r.properties?.name) === roomId,
    );
    if (feature?.geometry) {
      try {
        const coords =
          feature.geometry.type === "Polygon"
            ? feature.geometry.coordinates[0][0]
            : feature.geometry.type === "MultiPolygon"
              ? feature.geometry.coordinates[0][0][0]
              : null;

        if (coords) {
          setViewState((prev) => ({
            ...prev,
            longitude: coords[0],
            latitude: coords[1],
            zoom: 19.5,
            pitch: 50,
            transitionDuration: 1200,
            transitionInterpolator: new FlyToInterpolator(),
          }));
        }
      } catch (e) {
        console.log("Could not animate to room:", e);
      }
    }
  };

  const handleSearch = (roomIds) => {
    setFilteredRooms(roomIds);
    if (roomIds.length > 0) {
      setHighlightedRoomId(roomIds[0]);
    }
  };

  const handleFilter = (roomIds) => {
    // Support both legacy array payload and new object payload from FilterPanel
    if (Array.isArray(roomIds)) {
      setFilteredRooms(roomIds);
      setSelectedFloors([]);
      return;
    }

    const { roomIds: ids = [], selectedFloors: floors = [] } = roomIds || {};
    setFilteredRooms(ids);
    setSelectedFloors(floors);

    if (floors.length > 0) {
      setRouteContext(null);
      setShowDirections(false);
      setHighlightedStep(null);
    }
  };

  const handleClosePopup = () => {
    setSelectedRoom(null);
    setHighlightedRoomId(null);
  };

  const handleViewReset = () => {
    setViewState((prev) => ({
      ...prev,
      zoom: 17,
      pitch: 45,
      bearing: 0,
    }));
  };

  const handleZoomIn = () => {
    setViewState((prev) => ({
      ...prev,
      zoom: prev.zoom + 1,
    }));
  };

  const handleZoomOut = () => {
    setViewState((prev) => ({
      ...prev,
      zoom: prev.zoom - 1,
    }));
  };

  const handleRotate = (direction) => {
    const rotateAmount = 30;
    const pitchAmount = 15;

    switch (direction) {
      case "left":
        setViewState((prev) => ({
          ...prev,
          bearing: prev.bearing - rotateAmount,
        }));
        break;
      case "right":
        setViewState((prev) => ({
          ...prev,
          bearing: prev.bearing + rotateAmount,
        }));
        break;
      case "up":
        setViewState((prev) => ({
          ...prev,
          pitch: Math.min(prev.pitch + pitchAmount, 85),
        }));
        break;
      case "down":
        setViewState((prev) => ({
          ...prev,
          pitch: Math.max(prev.pitch - pitchAmount, 0),
        }));
        break;
      default:
        break;
    }
  };

  const clearRouteState = () => {
    setRouteContext(null);
    setShowDirections(false);
    setHighlightedStep(null);
  };

  const visibleRouteContext =
    routeContext && selectedFloors.length === 0
      ? routeContext.type === "multi-floor"
        ? selectedFloor === "all" ||
          routeContext.route.info.floors.includes(Number(selectedFloor))
          ? routeContext
          : null
        : selectedFloor !== "all" && Number(selectedFloor) === routeContext.floorId
          ? routeContext
          : null
      : null;

  const handleSameFloorRouteCalculate = (
    startRoom,
    endRoom,
    targetFloor = null,
    routeOptions = {},
  ) => {
    // Guard: if either room is missing, treat as a clear request
    if (!startRoom || !endRoom) {
      clearRouteState();
      return;
    }

    const startFloor = getRoomFloor(startRoom);
    const endFloor = getRoomFloor(endRoom);
    const activeFloor =
      typeof selectedFloor === "number" ? selectedFloor : null;

    // Single-floor routing: prefer the explicit planner floor, otherwise infer
    // the only valid floor from the selected rooms or the currently active floor.
    let floorForRouting = null;

    if (typeof targetFloor === "number") {
      floorForRouting = targetFloor;
    } else if (startFloor !== null && endFloor !== null) {
      if (startFloor !== endFloor) {
        alert(
          "Routing currently supports same-floor routes only. Please choose rooms on the same floor.",
        );
        clearRouteState();
        return;
      }

      floorForRouting = startFloor;
    } else {
      floorForRouting = startFloor ?? endFloor ?? activeFloor;
    }

    if (floorForRouting === null) {
      alert(
        "Unable to determine which floor to route on. Please pick a floor in the planner and try again.",
      );
      clearRouteState();
      return;
    }

    if (
      (startFloor !== null && startFloor !== floorForRouting) ||
      (endFloor !== null && endFloor !== floorForRouting)
    ) {
      alert(
        `Start and end locations must both belong to Floor ${floorForRouting}.`,
      );
      clearRouteState();
      return;
    }

    // Get the appropriate router for the target floor
    const floorRouter = routers[floorForRouting];

    if (!startRoom || !endRoom || !floorRouter) {
      if (!floorRouter) {
        alert(
          `Routing is not available for Floor ${floorForRouting}. Please try another floor.`,
        );
      }
      clearRouteState();
      return;
    }

    try {
      const floorHasRoomAnchors =
        (roomAnchorIndexes[floorForRouting]?.size ?? 0) > 0;
      const startTarget = resolveRoomRoutingTarget({
        room: startRoom,
        floorId: floorForRouting,
        router: floorRouter,
        roomAnchorIndex: roomAnchorIndexes[floorForRouting],
        role: "start",
      });
      const endTarget = resolveRoomRoutingTarget({
        room: endRoom,
        floorId: floorForRouting,
        router: floorRouter,
        roomAnchorIndex: roomAnchorIndexes[floorForRouting],
        role: "destination",
      });
      const startCoords = startTarget?.coordinates;
      const endCoords = endTarget?.coordinates;

      if (!startCoords) {
        throw new Error(
          floorHasRoomAnchors
            ? `Unable to resolve a valid route start anchor for ${getRoomName(startRoom)}.`
            : "Unable to determine room centers for routing.",
        );
      }

      if (!endCoords) {
        throw new Error(
          floorHasRoomAnchors
            ? `Unable to resolve a valid centerline access anchor for ${getRoomName(endRoom)}.`
            : "Unable to determine room centers for routing.",
        );
      }

      // Use graph-based router for the selected floor
      const result = floorRouter.computeRoute(startCoords, endCoords);

      if (result.success) {
        const renderedSegments = result.debug?.renderedSegments ?? [];
        const hasInvalidRenderedSegment = renderedSegments.some(
          (segment) => segment.intersectsObstacle || !segment.valid,
        );

        if (floorHasRoomAnchors && hasInvalidRenderedSegment) {
          console.error("[Route] Rejected invalid rendered route", {
            start: startTarget?.debug,
            destination: endTarget?.debug,
            routerDebug: result.debug,
          });
          throw new Error(
            `Computed route for ${getRoomName(endRoom)} leaves the valid centerline graph on Floor ${floorForRouting}.`,
          );
        }

        console.log("[Route] Computing route for floor", floorForRouting, {
          startCoords,
          endCoords,
          startTarget: startTarget?.debug,
          endTarget: endTarget?.debug,
        });
        console.log("[Route] Router result:", result);

        if (floorForRouting === 1) {
          console.log("[Route][Level1 Debug]", {
            selectedDestinationName: getRoomName(endRoom),
            destinationGeometryType: endTarget?.debug?.geometryType ?? null,
            destinationCentroid:
              endTarget?.debug?.centroid ?? getRoomCentroid(endRoom),
            snappedGraphNodeOrEdge:
              result.debug?.endSnap ?? endTarget?.debug?.snappedTarget ?? null,
            finalGraphEndpoint: result.debug?.finalGraphEnd ?? null,
            postExtensionAdded: false,
            renderedSegmentIntersectsObstacle: renderedSegments.some(
              (segment) => segment.intersectsObstacle,
            ),
            renderedSegments,
          });
        }

        // Convert result to path format for visualization
        const path = result.coordinates.map((coord, idx) => ({
          coords: [coord.lng, coord.lat],
          name:
            idx === 0
              ? getRoomName(startRoom)
              : idx === result.coordinates.length - 1
                ? getRoomName(endRoom)
                : `Waypoint ${idx}`,
          floor: floorForRouting,
          features:
            idx === 0
              ? [startRoom]
              : idx === result.coordinates.length - 1
                ? [endRoom]
              : [],
        }));
        const renderPath = (
          result.renderCoordinates?.length
            ? result.renderCoordinates
            : result.debug?.graphCoordinates?.length
              ? result.debug.graphCoordinates
              : result.coordinates
        ).map((coord) => ({
          coords: [coord.lng, coord.lat],
          floor: floorForRouting,
        }));
        const directions = generateRouteInstructions({
          routeResult: result,
          floorId: floorForRouting,
          graph: floorRouter.getGraph(),
          startName: getRoomName(startRoom),
          destinationName: getRoomName(endRoom),
          options: {
            userPreference:
              routeOptions.accessibility === "wheelchair"
                ? "accessible"
                : routeOptions.preferences,
          },
        });

        console.log("[Route] Path array created:", path);

        const info = {
          start: getRoomName(startRoom),
          end: getRoomName(endRoom),
          distance: result.distance.toFixed(1),
          floors: [floorForRouting],
          targetFloor: floorForRouting,
          waypointCount: result.waypointCount,
          directions,
          routeType: "same-floor",
        };

        setSelectedFloors([]);
        setSelectedFloor(floorForRouting);
        setRouteContext({
          floorId: floorForRouting,
          graph: floorRouter.getGraph(),
          route: {
            path,
            renderPath,
            info,
            result,
          },
        });
        setShowRoutePlanner(false);
        setShowDirections(true);
        console.log(
          `✓ Route found on Floor ${floorForRouting}: ${result.distance.toFixed(1)}m, ${result.waypointCount} waypoints`,
        );
      } else {
        alert(`No route found: ${result.error}`);
        clearRouteState();
      }
    } catch (error) {
      console.error("Error calculating route:", error);
      alert(`Routing error: ${error.message}`);
      clearRouteState();
    }
  };

  const handleRouteCalculate = (
    startRoom,
    endRoom,
    targetFloor = null,
    routeOptions = {},
  ) => {
    if (!startRoom || !endRoom) {
      clearRouteState();
      return;
    }

    const startFloor = getRoomFloor(startRoom);
    const endFloor = getRoomFloor(endRoom);

    if (startFloor === null || endFloor === null) {
      alert(
        "Unable to determine start or destination floor. Please choose rooms with floor metadata.",
      );
      clearRouteState();
      return;
    }

    if (startFloor === endFloor || typeof targetFloor === "number") {
      handleSameFloorRouteCalculate(startRoom, endRoom, targetFloor, routeOptions);
      return;
    }

    const resolveTarget = (room, floorId, role) => {
      const router = routers[floorId];
      if (!router) {
        throw new Error(
          `Routing is not available for Floor ${floorId}. Please try another floor.`,
        );
      }

      const floorHasRoomAnchors = (roomAnchorIndexes[floorId]?.size ?? 0) > 0;
      const target = resolveRoomRoutingTarget({
        room,
        floorId,
        router,
        roomAnchorIndex: roomAnchorIndexes[floorId],
        role,
      });

      if (!target?.coordinates) {
        throw new Error(
          floorHasRoomAnchors
            ? `Unable to resolve a valid centerline access anchor for ${getRoomName(room)}.`
            : "Unable to determine room centers for routing.",
        );
      }

      return { target, router, floorHasRoomAnchors };
    };

    const toPath = (result, floorId, startName, endName, startFeature, endFeature) =>
      result.coordinates.map((coord, idx) => ({
        coords: [coord.lng, coord.lat],
        name:
          idx === 0
            ? startName
            : idx === result.coordinates.length - 1
              ? endName
              : `Waypoint ${idx}`,
        floor: floorId,
        features:
          idx === 0 && startFeature
            ? [startFeature]
            : idx === result.coordinates.length - 1 && endFeature
              ? [endFeature]
              : [],
      }));

    try {
      const { target: startTarget } = resolveTarget(startRoom, startFloor, "start");
      const { target: endTarget } = resolveTarget(
        endRoom,
        endFloor,
        "destination",
      );
      const multiFloorResult = computeMultiFloorRoute({
        start: startTarget.coordinates,
        startFloor,
        destination: endTarget.coordinates,
        destinationFloor: endFloor,
        routers,
        roomsByFloor: routeRoomsByFloor,
        userPreference:
          routeOptions.accessibility === "wheelchair"
            ? "accessible"
            : routeOptions.preferences,
      });

      if (!multiFloorResult.success) {
        alert(`No route found: ${multiFloorResult.error}`);
        clearRouteState();
        return;
      }

      const horizontalSegments = multiFloorResult.segments.filter(
        (segment) => segment.type === "horizontal",
      );
      const transitionSegments = multiFloorResult.segments.filter(
        (segment) => segment.type === "vertical-transition",
      );

      const routeSegments = horizontalSegments.map((segment) => ({
        floorId: Number(segment.floorId),
        type: "horizontal",
        path: segment.renderCoordinates.map((coord) => ({
          coords: [coord.lng, coord.lat],
          floor: Number(segment.floorId),
        })),
      }));
      const transitionMarkers = transitionSegments.flatMap((segment) => [
        {
          floor: Number(segment.fromFloor),
          coords: [segment.fromAccessPoint.lng, segment.fromAccessPoint.lat],
          instruction: segment.instruction,
          connectorType: segment.connectorType,
          role: "from",
        },
        {
          floor: Number(segment.toFloor),
          coords: [segment.toAccessPoint.lng, segment.toAccessPoint.lat],
          instruction: segment.instruction,
          connectorType: segment.connectorType,
          role: "to",
        },
      ]);
      const startPath = toPath(
        horizontalSegments[0].route,
        startFloor,
        getRoomName(startRoom),
        "Staircase",
        startRoom,
        null,
      );
      const destinationPath = toPath(
        horizontalSegments[horizontalSegments.length - 1].route,
        endFloor,
        "Staircase",
        getRoomName(endRoom),
        null,
        endRoom,
      );
      const path = [...startPath, ...destinationPath];
      const renderPath = routeSegments.flatMap((segment) => segment.path);
      const directionSteps = generateMultiFloorRouteInstructions({
        segments: multiFloorResult.segments,
        graphsByFloor: Object.entries(routers).reduce((graphs, [floor, router]) => {
          graphs[floor] = router.getGraph();
          graphs[String(floor).startsWith("F") ? String(floor) : `F${floor}`] =
            router.getGraph();
          return graphs;
        }, {}),
        startName: getRoomName(startRoom),
        destinationName: getRoomName(endRoom),
        options: {
          userPreference:
            routeOptions.accessibility === "wheelchair"
              ? "accessible"
              : routeOptions.preferences,
        },
      });
      const floors = [startFloor, endFloor].sort((a, b) => a - b);
      const info = {
        start: getRoomName(startRoom),
        end: getRoomName(endRoom),
        distance: multiFloorResult.totalDistance.toFixed(1),
        totalDistance: multiFloorResult.totalDistance,
        floors,
        targetFloor: endFloor,
        waypointCount: path.length,
        directions: directionSteps,
        routeType: "multi-floor",
      };

      setSelectedFloors([]);
      setSelectedFloor("all");
      setRouteContext({
        type: "multi-floor",
        floorId: null,
        route: {
          path,
          renderPath,
          routeSegments,
          transitionMarkers,
          info,
          result: multiFloorResult,
        },
      });
      setShowRoutePlanner(false);
      setShowDirections(true);
      console.log("[Route] Multi-floor route found", multiFloorResult);
    } catch (error) {
      console.error("Error calculating route:", error);
      alert(`Routing error: ${error.message}`);
      clearRouteState();
    }
  };

  const handleStepClick = (step) => {
    // Highlight the step location on the map
    setHighlightedStep(step);

    // Animate camera to step location
    if (step && step.coords) {
      setViewState((prev) => ({
        ...prev,
        longitude: step.coords[0],
        latitude: step.coords[1],
        zoom: 19.5,
        pitch: 50,
        transitionDuration: 800,
        transitionInterpolator: new FlyToInterpolator(),
      }));
    }
  };

  // Show loading screen while data is loading
  if (isLoading) {
    return <LoadingSpinner message="Loading 3D building model..." />;
  }

  const currentFloorLabel =
    selectedFloor === "all"
      ? "All Floors"
      : selectedFloor === -1 || selectedFloor === 0
        ? "F0 Basement"
        : `F${selectedFloor}`;
  const activeRouteInfo = visibleRouteContext?.route?.info ?? null;

  return (
    <div className="App">
      {/* Help Overlay */}
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}

      {/* Floating Action Buttons */}
      <button
        className="help-button"
        onClick={() => setShowHelp(true)}
        title="Keyboard Shortcuts (Press ?)"
      >
        ?
      </button>

      <div className="app-container">
        {/* Header */}
        <header className="app-header">
          <div className="app-header-content">
            <div className="app-header-copy">
              <span className="app-kicker">Indoor navigation workspace</span>
              <h1>3D Indoor Map Viewer</h1>
              <p>Interactive 3D building floor navigation and room explorer</p>
            </div>
            <div className="app-header-meta">
              <div className="header-chip">
                <span className="header-chip-label">Current floor</span>
                <strong>{currentFloorLabel}</strong>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <div
          className={`main-content ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
          style={{ "--sidebar-width": `${sidebarWidth}px` }}
        >
          {/* Left Panel */}
          <aside
            id="app-sidebar"
            className="left-panel"
            aria-hidden={sidebarCollapsed}
            inert={sidebarCollapsed ? "" : undefined}
          >
            <div className="panel-section panel-card">
              <div className="panel-heading">
                <span className="panel-kicker">Explore</span>
                <h2 className="panel-title">Search rooms</h2>
                <p className="panel-description">
                  Find rooms by name, type, or room number.
                </p>
              </div>
              <SearchBar
                rooms={allRooms}
                onSearch={handleSearch}
                onRoomSelect={handleRoomSelect}
              />
            </div>

            <div className="panel-section panel-card">
              <FloorSwitcher
                currentFloor={selectedFloor}
                onFloorChange={handleFloorChange}
                availableFloors={availableFloors}
              />
            </div>

            <div className="panel-section panel-card">
              <div className="panel-heading">
                <span className="panel-kicker">Routing</span>
                <h2 className="panel-title">Planner</h2>
                <p className="panel-description">
                  Build floor-aware routes and keep directions visible while you
                  navigate.
                </p>
              </div>
              <button
                className="btn-filter"
                onClick={() => setShowRoutePlanner(!showRoutePlanner)}
              >
                Plan Route
              </button>
              {activeRouteInfo && (
                <div className="route-status">
                  <div className="route-status-header">
                    <strong>Active Route</strong>
                    <span className="route-status-chip">
                      Floor {activeRouteInfo.floors.join(", ")}
                    </span>
                  </div>
                  <div className="route-status-grid">
                    <div className="route-status-item">
                      <span>From</span>
                      <strong>{activeRouteInfo.start}</strong>
                    </div>
                    <div className="route-status-item">
                      <span>To</span>
                      <strong>{activeRouteInfo.end}</strong>
                    </div>
                    <div className="route-status-item">
                      <span>Distance</span>
                      <strong>~{activeRouteInfo.distance}m</strong>
                    </div>
                  </div>
                  <div className="route-status-actions">
                    <button
                      className="btn-secondary route-status-button"
                      onClick={() => setShowDirections(!showDirections)}
                    >
                      {showDirections ? "Hide" : "Show"} Directions
                    </button>
                    <button
                      className="btn-secondary route-status-button"
                      onClick={clearRouteState}
                    >
                      Clear Route
                    </button>
                  </div>
                </div>
              )}
            </div>

            {showFilterPanel && (
              <FilterPanel
                rooms={allRooms}
                onFilter={handleFilter}
                onClose={() => setShowFilterPanel(false)}
              />
            )}

            <div className="panel-info panel-card legend-sidebar-card">
              <Legend
                selectedFloor={selectedFloor}
                selectedFloors={selectedFloors}
                translucency={translucency}
              />
            </div>
          </aside>

          <button
            type="button"
            className="sidebar-toggle"
            onClick={handleSidebarToggleClick}
            onPointerDown={handleSidebarDragStart}
            onPointerMove={handleSidebarDragMove}
            onPointerUp={handleSidebarDragEnd}
            onPointerCancel={handleSidebarDragEnd}
            aria-controls="app-sidebar"
            aria-expanded={!sidebarCollapsed}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={
              sidebarCollapsed
                ? "Expand sidebar or drag right"
                : "Collapse sidebar or drag to resize"
            }
          >
            <span aria-hidden="true" className="sidebar-toggle-icon">
              {sidebarCollapsed ? ">" : "<"}
            </span>
          </button>

          {/* Map Container */}
          <div className="map-container">
            <Map3D
              selectedFloor={selectedFloor}
              selectedFloors={selectedFloors}
              onRoomSelect={handleRoomSelect}
              filteredRooms={filteredRooms}
              highlightedRoomId={highlightedRoomId}
              hoveredRoomId={hoveredRoomId}
              onRoomHover={setHoveredRoomId}
              colorScheme="default"
              viewState={viewState}
              onViewStateChange={setViewState}
              lightingEnabled={lightingEnabled}
              translucency={translucency}
              heightExaggeration={1}
              basemapStyle={basemapStyle}
              routePath={visibleRouteContext?.route?.path || null}
              routeRenderPath={visibleRouteContext?.route?.renderPath || null}
              routeSegments={visibleRouteContext?.route?.routeSegments || null}
              routeTransitionMarkers={
                visibleRouteContext?.route?.transitionMarkers || null
              }
              routeFloorId={visibleRouteContext?.floorId ?? null}
              roomsData={allRooms}
              centerlinesData={centerlinesData}
              activeFloor={selectedFloor}
            />

            <VisualControls
              lightingEnabled={lightingEnabled}
              setLightingEnabled={setLightingEnabled}
              translucency={translucency}
              setTranslucency={setTranslucency}
              basemapStyle={basemapStyle}
              setBasemapStyle={setBasemapStyle}
            />

            {/* Room Info Popup */}
            {selectedRoom && (
              <RoomInfoPopup
                room={selectedRoom}
                onClose={handleClosePopup}
                position={popupPosition}
              />
            )}

            {/* Route Planner */}
            {showRoutePlanner && (
              <RoutePlanner
                rooms={
                  allFloorRouteRooms.length > 0 ? allFloorRouteRooms : allRooms
                }
                onRouteCalculate={handleRouteCalculate}
                onClearRoute={clearRouteState}
                onClose={() => setShowRoutePlanner(false)}
                selectedFloors={selectedFloors}
                activeFloor={selectedFloor}
              />
            )}

            {/* Directions Panel */}
            {showDirections && visibleRouteContext?.route?.path && (
              <DirectionsPanel
                routePath={visibleRouteContext.route.path}
                routeInfo={visibleRouteContext.route.info}
                onClose={clearRouteState}
                onStepClick={handleStepClick}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <footer className="app-footer">
          <p>Built with React, Deck.gl & GeoJSON WGS84 Coordinate System</p>
        </footer>
      </div>
    </div>
  );
}

export default App;
