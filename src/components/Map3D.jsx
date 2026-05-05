import React, { useState, useEffect, useRef, useMemo } from "react";
import DeckGL from "@deck.gl/react";
import Map from "react-map-gl";
import { PathLayer, TextLayer, IconLayer } from "@deck.gl/layers";
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
  satellite: {
    url: "mapbox://styles/mapbox/satellite-streets-v12",
    name: "Satellite",
    description: "Satellite imagery with street labels",
  },
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
  routeFloorId = null,
  roomsData = [],
  centerlinesData = {},
  activeFloor = "all",
  basemapStyle = "satellite", // default to satellite view
  showPerimeterWall = true,
  perimeterWallUrl = "/wall.geojson",
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
  const deckRef = useRef(null);
  const containerRef = useRef(null);
  const isAllFloorsSelected =
    selectedFloor === "all" || selectedFloor === "F-ALL";

  // Wait for component to mount before initializing DeckGL
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsMounted(true);
    }, 100);
    return () => clearTimeout(timer);
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
  });

  const stackedWallLayers = useStackedWallLayer({
    activeFloor: selectedFloor,
    selectedFloor,
    selectedFloors,
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

    // Start and end point markers - same mode-aware elevation as path line
    const MARKER_FLOOR_OFFSET = 0.1; // pin base sits on floor surface
    const floorElev = (floor) => {
      const n = typeof floor === "number" ? floor : 0;
      return isDollhouse ? n * BUILDING_FLOOR_SPACING : 0;
    };

    const markerData = [
      {
        position: [
          ...routePath[0].coords,
          floorElev(routePath[0].floor) + MARKER_FLOOR_OFFSET,
        ],
        type: "start",
        floor: routePath[0].floor,
        roomName: routePath[0].name || "Start",
      },
      {
        position: [
          ...routePath[routePath.length - 1].coords,
          floorElev(routePath[routePath.length - 1].floor) +
            MARKER_FLOOR_OFFSET,
        ],
        type: "end",
        floor: routePath[routePath.length - 1].floor,
        roomName: routePath[routePath.length - 1].name || "End",
      },
    ];

    console.log(
      "[Map3D] Route Start - Floor:",
      routePath[0].floor,
      "Coords:",
      routePath[0].coords,
      "Elevation:",
      markerData[0].position[2],
    );
    console.log(
      "[Map3D] Route End - Floor:",
      routePath[routePath.length - 1].floor,
      "Coords:",
      routePath[routePath.length - 1].coords,
      "Elevation:",
      markerData[1].position[2],
    );

    // Google Maps-style location pin markers using IconLayer
    // Create SVG data URLs for green and red pins
    const createPinSVG = (color) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 48 48">
        <defs>
          <filter id="shadow">
            <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.3"/>
          </filter>
        </defs>
        <path d="M24 2C15.2 2 8 9.2 8 18c0 10.5 14 26 16 28 2-2 16-17.5 16-28 0-8.8-7.2-16-16-16zm0 22c-3.3 0-6-2.7-6-6s2.7-6 6-6 6 2.7 6 6-2.7 6-6 6z" 
              fill="${color}" filter="url(#shadow)"/>
        <circle cx="24" cy="18" r="5" fill="white" opacity="0.9"/>
      </svg>`;
      return `data:image/svg+xml;base64,${btoa(svg)}`;
    };

    // Calculate marker size based on zoom level to maintain consistent screen size
    // Fixed pixel sizes - markers appear at constant screen size regardless of zoom
    const markerScreenSize = 40;
    const waypointScreenSize = 14;
    const waypointGlowSize = 16;

    const pinMapping = {
      start: {
        url: createPinSVG("#34A853"), // Google green
        width: 36,
        height: 36,
        anchorY: 36,
      },
      end: {
        url: createPinSVG("#EA4335"), // Google red
        width: 36,
        height: 36,
        anchorY: 36,
      },
    };

    layers.push(
      new IconLayer({
        id: "route-pin-markers",
        data: markerData,
        getPosition: (d) => d.position,
        getIcon: (d) => pinMapping[d.type],
        getSize: 36,
        sizeUnits: "pixels",
        sizeScale: 1,
        pickable: true,
        billboard: true,
        opacity: 1.0,
      }),
    );

    // Waypoint labels only - clean visualization
    if (routePath.length > 2) {
      const WAYPOINT_ELEVATION_OFFSET = 0.1; // label sits on floor surface
      const waypoints = routePath.slice(1, -1);

      // Waypoint labels using TextLayer - bold black text
      layers.push(
        new TextLayer({
          id: "route-waypoint-labels",
          data: waypoints,
          getPosition: (d) => {
            const baseElevation = floorElev(d.floor);
            return [...d.coords, baseElevation + WAYPOINT_ELEVATION_OFFSET];
          },
          getText: (d) => d.name || "Waypoint",
          getSize: 9.5,
          getColor: [0, 0, 0, 255], // Deep black text with full opacity
          getTextAnchor: "middle",
          getAlignmentBaseline: "center",
          sizeUnits: "pixels",
          pickable: false,
          billboard: true,
          fontSettings: {
            fontSize: 10,
            fontFamily: "Arial, sans-serif",
            fontWeight: "800",
          },
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
        initialViewState={externalViewState || internalViewState}
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
                BASEMAP_STYLES.satellite.url
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
