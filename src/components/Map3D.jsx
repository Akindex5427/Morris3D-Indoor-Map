import React, { useState, useEffect, useRef, useMemo } from "react";
import DeckGL from "@deck.gl/react";
import Map from "react-map-gl";
import {
  PathLayer,
  ScatterplotLayer,
  TextLayer,
  IconLayer,
} from "@deck.gl/layers";
import { useIndoorBuilding } from "./IndoorBuilding";
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

// Floor base elevation mapping (in meters) - must match IndoorBuilding.js
const FLOOR_BASE_ELEVATIONS = {
  0: 4.5, // Basement
  1: 13.5, // Level 1
  2: 22.5, // Level 2
  3: 31.5, // Level 3
  4: 40.5, // Level 4
  5: 49.5, // Level 5
  6: 58.5, // Level 6
  7: 67.5, // Level 7
};

// Marker elevation offset (in meters) - to ensure markers appear above floor surface
const MARKER_ELEVATION_OFFSET = 2.0; // Raise markers 2m above floor

// Helper function to get elevation for a coordinate at a specific floor
const getFloorElevation = (floor) => {
  return FLOOR_BASE_ELEVATIONS[floor] ?? floor * 9; // Default to 9m per floor
};

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
  roomsData = [],
  basemapStyle = "satellite", // default to satellite view
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
      selectedFloor !== "all"
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
    if (selectedFloor === "all") {
      return allAvailableFloors;
    }
    // If a single floor is selected
    if (selectedFloor !== undefined && selectedFloor !== null) {
      return [selectedFloor];
    }
    // Default: empty array
    return [];
  }, [selectedFloors, selectedFloor, allAvailableFloors]);

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
    floorSpacing: 4.5, // 4.5m vertical spacing between floors (matches provided stack)
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

  console.log("[Map3D] Indoor layers:", indoorLayers?.length || 0);

  const layers = [...indoorLayers];

  // Add route visualization layers if route exists
  console.log("[Map3D] routePath prop:", routePath);
  if (routePath && routePath.length > 1) {
    console.log("[Map3D] Rendering route with", routePath.length, "waypoints");

    // Create path coordinates using actual room base elevations
    const PATH_ELEVATION_OFFSET = 0.5; // Just above floor for clear visibility
    const pathCoords = routePath.map((point) => {
      // Try to get base elevation from room features
      let baseElevation = getFloorElevation(point.floor);

      if (point.features?.[0]?.properties?.base_height !== undefined) {
        baseElevation = parseFloat(point.features[0].properties.base_height);
      } else if (point.features?.[0]?.properties?.base_heigh !== undefined) {
        baseElevation = parseFloat(point.features[0].properties.base_heigh);
      }

      const totalElevation = baseElevation + PATH_ELEVATION_OFFSET;
      console.log(
        `[Map3D] Path point: floor=${point.floor}, baseElev=${baseElevation}, totalElev=${totalElevation}, room=${point.name}`,
      );
      return [...point.coords, totalElevation]; // [lon, lat, elevation]
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

    // Narrower blue route path like Google Maps (outer border)
    layers.push(
      new PathLayer({
        id: "route-path-border",
        data: [{ path: pathCoords }],
        getPath: (d) => d.path,
        getColor: [30, 80, 180, 180],
        getWidth: 10,
        widthMinPixels: 7,
        widthMaxPixels: 14,
        widthScale: 1,
        rounded: true,
        billboard: false,
        pickable: false,
        opacity: 0.7,
      }),
    );

    // Main bold blue path (like Google Maps) - narrower
    layers.push(
      new PathLayer({
        id: "route-path-main",
        data: [{ path: pathCoords }],
        getPath: (d) => d.path,
        getColor: [66, 133, 244, 255], // Google Maps blue
        getWidth: 7,
        widthMinPixels: 5,
        widthMaxPixels: 10,
        widthScale: 1,
        rounded: true,
        billboard: false,
        pickable: true,
        opacity: 1.0,
      }),
    );

    // Inner highlight for 3D effect - narrower
    layers.push(
      new PathLayer({
        id: "route-path-highlight",
        data: [
          {
            path: pathCoords.map((c) => [c[0], c[1], c[2] + 0.1]),
          },
        ],
        getPath: (d) => d.path,
        getColor: [130, 180, 255, 150],
        getWidth: 3,
        widthMinPixels: 2,
        widthMaxPixels: 5,
        widthScale: 1,
        rounded: true,
        billboard: false,
        pickable: false,
        opacity: 0.6,
      }),
    );

    // Start and end point markers - place ON the floor surface using room's actual base elevation
    // Get the actual room features to read their base_height property
    const startRoom = routePath[0].features?.[0];
    const endRoom = routePath[routePath.length - 1].features?.[0];

    // Calculate base elevation from room properties
    const getBaseElevation = (room, floor) => {
      if (room?.properties?.base_height !== undefined) {
        return parseFloat(room.properties.base_height);
      }
      if (room?.properties?.base_heigh !== undefined) {
        return parseFloat(room.properties.base_heigh);
      }
      // Fallback to floor-based elevation
      return getFloorElevation(floor);
    };

    const MARKER_FLOOR_OFFSET = 2.0; // Raised above floor to prevent any sinking
    const markerData = [
      {
        position: [
          ...routePath[0].coords,
          getBaseElevation(startRoom, routePath[0].floor) + MARKER_FLOOR_OFFSET,
        ],
        type: "start",
        floor: routePath[0].floor,
        roomName: routePath[0].name || "Start",
      },
      {
        position: [
          ...routePath[routePath.length - 1].coords,
          getBaseElevation(endRoom, routePath[routePath.length - 1].floor) +
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

    // Waypoint markers with enhanced creative styling
    if (routePath.length > 2) {
      const WAYPOINT_ELEVATION_OFFSET = 2.0;
      const waypoints = routePath.slice(1, -1);

      // Glow for waypoints
      layers.push(
        new ScatterplotLayer({
          id: "route-waypoints-glow",
          data: waypoints,
          getPosition: (d) => {
            let baseElevation = getFloorElevation(d.floor);
            if (d.features?.[0]?.properties?.base_height !== undefined) {
              baseElevation = parseFloat(d.features[0].properties.base_height);
            } else if (d.features?.[0]?.properties?.base_heigh !== undefined) {
              baseElevation = parseFloat(d.features[0].properties.base_heigh);
            }
            return [
              ...d.coords,
              baseElevation + WAYPOINT_ELEVATION_OFFSET - 0.05,
            ];
          },
          getFillColor: [255, 180, 80, 150],
          getRadius: 14,
          radiusUnits: "pixels",
          pickable: false,
          opacity: 0.6,
        }),
      );

      // Thin blue line connecting waypoints
      const waypointCoords = waypoints.map((d) => {
        let baseElevation = getFloorElevation(d.floor);
        if (d.features?.[0]?.properties?.base_height !== undefined) {
          baseElevation = parseFloat(d.features[0].properties.base_height);
        } else if (d.features?.[0]?.properties?.base_heigh !== undefined) {
          baseElevation = parseFloat(d.features[0].properties.base_heigh);
        }
        return [...d.coords, baseElevation + WAYPOINT_ELEVATION_OFFSET];
      });

      layers.push(
        new PathLayer({
          id: "waypoint-connector-line",
          data: [{ path: waypointCoords }],
          getPath: (d) => d.path,
          getColor: [66, 133, 244, 200], // Blue
          getWidth: 2,
          widthMinPixels: 1,
          widthMaxPixels: 3,
          rounded: false,
          billboard: false,
          pickable: false,
          opacity: 0.6,
        }),
      );

      // Main waypoint markers - smaller dots
      layers.push(
        new ScatterplotLayer({
          id: "route-waypoints-main",
          data: waypoints,
          getPosition: (d) => {
            let baseElevation = getFloorElevation(d.floor);
            if (d.features?.[0]?.properties?.base_height !== undefined) {
              baseElevation = parseFloat(d.features[0].properties.base_height);
            } else if (d.features?.[0]?.properties?.base_heigh !== undefined) {
              baseElevation = parseFloat(d.features[0].properties.base_heigh);
            }
            return [...d.coords, baseElevation + WAYPOINT_ELEVATION_OFFSET];
          },
          getFillColor: [255, 255, 255, 255], // White
          getRadius: 5,
          radiusUnits: "pixels",
          pickable: false,
          stroked: true,
          lineWidthMinPixels: 1,
          getLineColor: [100, 150, 255, 255], // Light blue stroke
        }),
      );

      // Waypoint labels using TextLayer - smaller with black text
      layers.push(
        new TextLayer({
          id: "route-waypoint-labels",
          data: waypoints,
          getPosition: (d) => {
            let baseElevation = getFloorElevation(d.floor);
            if (d.features?.[0]?.properties?.base_height !== undefined) {
              baseElevation = parseFloat(d.features[0].properties.base_height);
            } else if (d.features?.[0]?.properties?.base_heigh !== undefined) {
              baseElevation = parseFloat(d.features[0].properties.base_heigh);
            }
            return [...d.coords, baseElevation + WAYPOINT_ELEVATION_OFFSET + 2];
          },
          getText: (d) => d.name || "Waypoint",
          getSize: 9,
          getColor: [0, 0, 0, 255], // Black text
          getTextAnchor: "middle",
          getAlignmentBaseline: "center",
          sizeUnits: "pixels",
          pickable: false,
          billboard: true,
          fontSettings: {
            fontSize: 9,
            fontFamily: "Arial, sans-serif",
            fontWeight: "normal",
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
        className="map-3d-container"
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
      <div
        ref={containerRef}
        className="map-3d-container"
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#1a1a1a",
          color: "#ffffff",
        }}
      >
        Loading map data...
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="map-3d-container"
      style={{ width: "100%", height: "100%", position: "relative" }}
    >
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
