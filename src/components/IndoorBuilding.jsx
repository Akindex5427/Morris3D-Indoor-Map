/**
 * IndoorBuilding.jsx - ArcGIS Indoors-Style 3D Dollhouse Visualization
 *
 * A production-ready React component for rendering multi-floor indoor maps
 * with transparent walls, vertical stacking, and configurable lighting.
 *
 * Features:
 * - Multi-floor dollhouse mode with vertical stacking
 * - Semi-transparent outer walls for interior visibility
 * - Per-floor translucency controls
 * - Enhanced lighting for architectural visualization
 * - Smooth floor slicing effect
 *
 * @example
 * <IndoorBuilding
 *   dataUrl="/rooms-all-WGS.geojson"
 *   selectedFloors={[0,1,2,3,4,5,6,7]}
 *   translucency={0.6}
 *   heightExaggeration={1.0}
 *   floorSpacing={3.0}
 *   onRoomClick={(room) => console.log(room)}
 * />
 */

import React, { useState, useEffect, useMemo } from "react";
import DeckGL from "@deck.gl/react";
import { GeoJsonLayer, PathLayer } from "@deck.gl/layers";
import {
  LightingEffect,
  AmbientLight,
  DirectionalLight,
  PointLight,
} from "@deck.gl/core";

// ============================================================================
// LIGHTING CONFIGURATION
// ============================================================================

/**
 * Creates lighting effect for indoor visualization
 * @param {boolean} isDollhouseMode - Whether multiple floors are visible
 * @returns {LightingEffect} Configured lighting effect
 */
function createIndoorLighting(isDollhouseMode = false) {
  // Reduced ambient light to preserve colors
  const ambientLight = new AmbientLight({
    color: [255, 255, 255],
    intensity: isDollhouseMode ? 0.5 : 0.3,
  });

  // Primary directional light from above (reduced)
  const directionalLight1 = new DirectionalLight({
    color: [255, 255, 255],
    intensity: isDollhouseMode ? 0.4 : 0.5,
    direction: [-1, -1, -2],
  });

  // Secondary directional light for side illumination (reduced)
  const directionalLight2 = new DirectionalLight({
    color: [255, 255, 255],
    intensity: 0.2,
    direction: [1, 1, -1],
  });

  // Point light for interior highlighting (reduced)
  const pointLight = new PointLight({
    color: [255, 255, 255],
    intensity: isDollhouseMode ? 0.3 : 0.2,
    position: [0, 0, 1000],
  });

  return new LightingEffect({
    ambientLight,
    directionalLight1,
    directionalLight2,
    pointLight,
  });
}

// ============================================================================
// COLOR PARSING UTILITIES
// ============================================================================

/**
 * Parse color from various formats (hex, rgb, named)
 * @param {string|Array} colorValue - Color in any format
 * @returns {Array<number>} RGB array [r, g, b]
 */
function parseColor(colorValue) {
  const namedColors = {
    grey: [100, 100, 100],
    gray: [100, 100, 100],
    lightgrey: [150, 150, 150],
    white: [220, 220, 220],
    black: [50, 50, 50],
    lightpink: [255, 182, 193],
    pink: [255, 192, 203],
    red: [255, 0, 0],
    salmon: [250, 128, 114],
    brown: [165, 42, 42],
    orange: [255, 165, 0],
    yellow: [255, 255, 0],
    gold: [255, 215, 0],
    green: [0, 128, 0],
    lightgreen: [144, 238, 144],
    blue: [0, 0, 255],
    lightblue: [173, 216, 230],
    navy: [0, 0, 128],
    purple: [128, 0, 128],
    cyan: [0, 255, 255],
  };

  if (!colorValue) return [100, 150, 200];

  const colorLower =
    typeof colorValue === "string" ? colorValue.toLowerCase() : "";

  // Named color
  if (namedColors[colorLower]) {
    return namedColors[colorLower];
  }

  // Hex color
  if (typeof colorValue === "string" && colorValue.startsWith("#")) {
    const hex = colorValue.replace("#", "");
    return [
      parseInt(hex.substring(0, 2), 16),
      parseInt(hex.substring(2, 4), 16),
      parseInt(hex.substring(4, 6), 16),
    ];
  }

  // RGB array
  if (Array.isArray(colorValue) && colorValue.length >= 3) {
    return colorValue.slice(0, 3);
  }

  // Default
  return [100, 150, 200];
}

// Identify floor surface polygons by name or type metadata
function isFloorSurface(props = {}) {
  const nameLower =
    typeof props.name === "string" ? props.name.toLowerCase() : "";
  const typeLower =
    typeof props.type === "string" ? props.type.toLowerCase() : "";

  return (
    nameLower === "floor" ||
    nameLower.includes("floor_part") ||
    nameLower.includes("floor_inner") ||
    nameLower.includes("floor ") ||
    nameLower === "floor_part" ||
    nameLower.includes("floor") ||
    typeLower === "floor"
  );
}

// Provide transparent color for floor surfaces
function getFloorSurfaceColor(floorNum, isDollhouseMode) {
  const baseColor = [255, 255, 255]; // white
  const alpha = 0; // fully transparent
  return [...baseColor, alpha];
}

// ============================================================================
// FLOOR STACKING ALGORITHM
// ============================================================================

/**
 * Compute extrusion height for a feature.
 * Base elevation is applied directly on geometry; this returns only the height.
 *
 * @param {Object} feature - GeoJSON feature
 * @param {number} floorSpacing - Vertical spacing between floors (meters)
 * @param {number} heightExaggeration - Height multiplier
 * @param {boolean} isStacked - Whether floors are being stacked (F-ALL)
 * @returns {number} Extrusion height in meters
 */
function computeElevation(
  feature,
  floorSpacing,
  heightExaggeration,
  isStacked = true
) {
  const height = getFeatureHeight(feature.properties || {});
  // Always use the actual height from GeoJSON for proper room extrusion
  return height * heightExaggeration;
}

// ============================================================================
// GEOMETRY HELPERS
// ============================================================================

// Unified floor accessor
function getFloorNumber(props = {}) {
  return props.level ?? props.floor ?? props.nivel ?? 0;
}

// Base height (used for stairs/ramps) with typo tolerance
function getBaseHeight(props = {}) {
  const raw =
    props.base_height ??
    props.base_heigh ??
    props.baseHeight ??
    props.baseheight ??
    props.z_values;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Structure height with fallback
function getFeatureHeight(props = {}) {
  const raw = props.height ?? props.altura;
  const parsed = parseFloat(raw);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 3.0;
}

// Apply base offset to Polygon / MultiPolygon coordinates
function applyBaseToGeometry(geometry, baseZ = 0) {
  if (!geometry) return geometry;

  const applyBase = (coords) =>
    coords.map((coord) => {
      if (Array.isArray(coord[0])) {
        // Nested ring or polygon
        return applyBase(coord);
      }
      const [lng, lat, z = 0] = coord;
      return [lng, lat, z + baseZ];
    });

  if (geometry.type === "Polygon") {
    return {
      ...geometry,
      coordinates: applyBase(geometry.coordinates),
    };
  }

  if (geometry.type === "MultiPolygon") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((polygon) => applyBase(polygon)),
    };
  }

  return geometry;
}

// ============================================================================
// MAIN INDOOR BUILDING COMPONENT
// ============================================================================

const IndoorBuilding = ({
  dataUrl = "/rooms-all-WGS-v6.geojson",
  selectedFloors = [0, 1, 2, 3, 4, 5, 6, 7],
  translucency = 0.6,
  heightExaggeration = 1.0,
  floorSpacing = 4.5,
  highlightedRoomId = null,
  onRoomClick = null,
  initialViewState = null,
}) => {
  const [geojsonData, setGeojsonData] = useState(null);
  const [viewState, setViewState] = useState(
    initialViewState || {
      longitude: 0,
      latitude: 0,
      zoom: 17,
      pitch: 45,
      bearing: 0,
    }
  );

  // ============================================================================
  // DATA LOADING
  // ============================================================================

  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await fetch(dataUrl);
        const data = await response.json();
        setGeojsonData(data);

        // Calculate center from data bounds
        if (data.features && data.features.length > 0 && !initialViewState) {
          const coords = data.features.flatMap((f) => {
            if (f.geometry.type === "Polygon") {
              return f.geometry.coordinates[0];
            } else if (f.geometry.type === "MultiPolygon") {
              return f.geometry.coordinates.flatMap((p) => p[0]);
            }
            return [];
          });

          if (coords.length > 0) {
            const lngs = coords.map((c) => c[0]);
            const lats = coords.map((c) => c[1]);
            const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
            const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;

            setViewState({
              longitude: centerLng,
              latitude: centerLat,
              zoom: 17,
              pitch: 45,
              bearing: 0,
            });
          }
        }
      } catch (error) {
        console.error("Error loading GeoJSON:", error);
      }
    };

    loadData();
  }, [dataUrl, initialViewState]);

  // ============================================================================
  // DATA FILTERING
  // ============================================================================

  const filteredData = useMemo(() => {
    if (!geojsonData || !geojsonData.features) {
      return { type: "FeatureCollection", features: [] };
    }

    // Filter to selected floors and polygonal geometries only, then apply base Z
    const isDollhouseMode = selectedFloors.length > 1;

    const features = geojsonData.features
      .filter((feature) => {
        const floor = getFloorNumber(feature.properties || {});
        const geomType = feature.geometry?.type;
        const isPolygon = geomType === "Polygon" || geomType === "MultiPolygon";
        return selectedFloors.includes(floor) && isPolygon;
      })
      .map((feature) => {
        const props = feature.properties || {};
        const floorNum = getFloorNumber(props);
        const featureBase = getBaseHeight(props);

        // For single floor view: display at ground level (ignore base_height from GeoJSON)
        // For dollhouse mode: apply both base_height and floor stacking
        const baseZ = isDollhouseMode
          ? featureBase + floorNum * floorSpacing
          : 0; // Single floor always starts at ground level

        return {
          ...feature,
          geometry: applyBaseToGeometry(feature.geometry, baseZ),
        };
      });

    return {
      type: "FeatureCollection",
      features: features,
    };
  }, [geojsonData, selectedFloors, floorSpacing]);

  // ============================================================================
  // LAYER CREATION
  // ============================================================================

  const { layers, lightingEffect } = useMemo(() => {
    if (!filteredData.features || filteredData.features.length === 0) {
      return { layers: [], lightingEffect: createIndoorLighting(false) };
    }

    const isDollhouseMode = selectedFloors.length > 1;
    const isSingleFloorMode = selectedFloors.length === 1;

    // Create GeoJSON layer
    const layer = new GeoJsonLayer({
      id: "indoor-building-layer",
      data: filteredData,
      pickable: true,
      stroked: true,
      filled: true,
      extruded: true,
      wireframe: false, // Disabled to remove vertical edge lines
      lineWidthMinPixels: isSingleFloorMode ? 1.2 : isDollhouseMode ? 1 : 0.8,
      lineWidthMaxPixels: isSingleFloorMode ? 2 : isDollhouseMode ? 1.6 : 1.2,

      // Material properties - reduced to preserve colors
      material: {
        ambient: 0.3,
        diffuse: 0.55,
        shininess: 1.5,
        specularColor: [90, 90, 90],
      },

      // Get fill color with transparency
      getFillColor: (feature) => {
        const props = feature.properties || {};
        const roomId = props.id || props.name || "";
        const floorNum = props.level ?? props.floor ?? props.nivel ?? 0;

        // Highlight selected room
        if (highlightedRoomId === roomId) {
          return [255, 200, 0, 255]; // Gold highlight
        }

        // Floors: neutral translucent white/black surfaces
        if (isFloorSurface(props)) {
          return getFloorSurfaceColor(floorNum, isDollhouseMode);
        }

        // Parse base color from GeoJSON
        const baseColor = parseColor(props.color);

        // Check if this is a special compartment that should preserve exact colors
        const nameLower =
          typeof props.name === "string" ? props.name.toLowerCase() : "";
        const isSpecialCompartment =
          nameLower.includes("stair") ||
          nameLower.includes("structure") ||
          nameLower.includes("mechanical") ||
          nameLower.includes("elevator") ||
          nameLower.includes("shaft");

        // For special compartments, use exact color; for rooms, apply subtle floor-based shading
        let shadedColor;
        if (isSpecialCompartment) {
          // Preserve EXACT color from GeoJSON for stairs, structures, etc. - NO modifications
          shadedColor = [baseColor[0], baseColor[1], baseColor[2]];
        } else {
          // Apply very subtle floor-based shading for regular rooms only
          const shadeFactor = Math.max(
            0.9,
            Math.min(1.1, 0.98 + floorNum * 0.02)
          );
          shadedColor = [
            Math.min(255, Math.round(baseColor[0] * shadeFactor)),
            Math.min(255, Math.round(baseColor[1] * shadeFactor)),
            Math.min(255, Math.round(baseColor[2] * shadeFactor)),
          ];
        }

        // Calculate alpha based on mode
        let alpha = 255;
        const isFacade =
          nameLower.includes("floor") ||
          nameLower.includes("exterior") ||
          nameLower.includes("facade");

        if (isDollhouseMode) {
          if (selectedFloors.includes(floorNum)) {
            // Selected floors: semi-transparent for dollhouse effect
            alpha = isFacade
              ? Math.round(255 * 0.2)
              : Math.round(255 * translucency);
          } else {
            // Non-selected floors: very transparent (context)
            const maxFloor = Math.max(...selectedFloors);
            const minFloor = Math.min(...selectedFloors);

            if (floorNum > maxFloor) {
              alpha = Math.round(255 * translucency * 0.15); // Ghost view above
            } else if (floorNum < minFloor) {
              alpha = Math.round(255 * translucency * 0.4); // Context below
            } else {
              alpha = Math.round(255 * translucency * 0.3); // Between
            }
          }
        } else if (isSingleFloorMode) {
          // Single floor: use translucency to show room structure
          if (selectedFloors.includes(floorNum)) {
            alpha = Math.round(255 * Math.max(0.85, translucency));
          } else {
            alpha = 255;
          }
        } else {
          alpha = 255;
        }

        return [...shadedColor, alpha];
      },

      // Get line color (edges)
      getLineColor: (feature) => {
        const props = feature.properties || {};
        const floorNum = props.level ?? props.floor ?? props.nivel ?? 0;

        let alpha = 140;

        if (isDollhouseMode) {
          if (selectedFloors.includes(floorNum)) {
            alpha = 180; // Softer edges even when selected
          } else {
            const maxFloor = Math.max(...selectedFloors);
            const minFloor = Math.min(...selectedFloors);

            if (floorNum > maxFloor) {
              alpha = 25;
            } else if (floorNum < minFloor) {
              alpha = 70;
            } else {
              alpha = 60;
            }
          }
        } else if (isSingleFloorMode) {
          alpha = selectedFloors.includes(floorNum) ? 170 : 130;
        }

        // Slightly lighter edge color to avoid heavy outlines
        const edgeColor = isDollhouseMode || isSingleFloorMode ? 45 : 60;
        return [edgeColor, edgeColor, edgeColor, alpha];
      },

      // Get elevation with floor stacking
      getElevation: (feature) =>
        computeElevation(
          feature,
          floorSpacing,
          heightExaggeration,
          isDollhouseMode
        ),

      // Update triggers
      updateTriggers: {
        getFillColor: [
          selectedFloors,
          translucency,
          highlightedRoomId,
          isDollhouseMode,
          isSingleFloorMode,
        ],
        getLineColor: [
          selectedFloors,
          translucency,
          isDollhouseMode,
          isSingleFloorMode,
        ],
        getElevation: [heightExaggeration, floorSpacing, isDollhouseMode],
      },

      // Click handler
      onClick: (info) => {
        if (info.object && onRoomClick) {
          onRoomClick(info.object.properties);
        }
      },
    });

    const lighting = createIndoorLighting(isDollhouseMode);

    return { layers: [layer], lightingEffect: lighting };
  }, [
    filteredData,
    selectedFloors,
    translucency,
    heightExaggeration,
    floorSpacing,
    highlightedRoomId,
    onRoomClick,
  ]);

  // ============================================================================
  // RENDER
  // ============================================================================

  if (!geojsonData) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1a1a1a",
          color: "#ffffff",
        }}
      >
        Loading indoor map data...
      </div>
    );
  }

  return (
    <DeckGL
      initialViewState={viewState}
      controller={true}
      layers={layers}
      effects={[lightingEffect]}
      getCursor={() => "grab"}
      style={{ width: "100%", height: "100%" }}
    />
  );
};

// ============================================================================
// HOOK VERSION - For use with external Map components
// ============================================================================

/**
 * Hook version of IndoorBuilding for integration with Map3D
 * @param {Object} options - Configuration options
 * @param {Object} options.data - GeoJSON data object
 * @param {Array<number>} options.selectedFloors - Array of floor numbers to display
 * @param {number} options.translucency - Opacity value (0-1)
 * @param {number} options.heightExaggeration - Height multiplier
 * @param {number} options.floorSpacing - Vertical spacing between floors in meters
 * @param {string} options.highlightedRoomId - ID of room to highlight
 * @param {Function} options.onRoomClick - Callback when room is clicked
 * @returns {Object} { layers, lightingEffect }
 */
export const useIndoorBuilding = ({
  data,
  selectedFloors = [0, 1, 2, 3, 4, 5, 6, 7],
  translucency = 0.6,
  heightExaggeration = 1.0,
  floorSpacing = 4.5,
  highlightedRoomId = null,
  onRoomClick = null,
}) => {
  // Filter data by selected floors
  const filteredData = useMemo(() => {
    if (!data || !data.features) {
      return { type: "FeatureCollection", features: [] };
    }

    const isDollhouseMode = selectedFloors.length > 1;

    const features = data.features
      .filter((feature) => {
        const floor =
          feature.properties?.level ||
          feature.properties?.floor ||
          feature.properties?.nivel ||
          0;
        return selectedFloors.includes(floor);
      })
      .filter((feature) => {
        const geomType = feature.geometry?.type;
        return geomType === "Polygon" || geomType === "MultiPolygon";
      })
      .map((feature, index) => {
        const props = feature.properties || {};
        const floorNum =
          props.level ?? props.floor ?? props.nivel ?? props.floorNumber ?? 0;
        const featureBase = getBaseHeight(props);
        // Single floor: no floor-level offset (display at ground level)
        // Multi-floor: apply floor-level stacking offset
        const baseZ = isDollhouseMode
          ? featureBase + floorNum * floorSpacing
          : 0;

        // DEBUG LOGGING (only log first 3 features to avoid console spam)
        if (index < 3) {
          console.log(`🐛 Floor Elevation Debug [Feature ${index}]:`, {
            selectedFloors,
            isDollhouseMode,
            floorNum,
            featureBase,
            floorSpacing,
            baseZ,
            featureName: props.name || props.type || "unknown",
          });
        }

        return {
          ...feature,
          geometry: applyBaseToGeometry(feature.geometry, baseZ),
        };
      });

    return {
      type: "FeatureCollection",
      features: features,
    };
  }, [data, selectedFloors, floorSpacing]);

  // Create layers and lighting
  const { layers, lightingEffect } = useMemo(() => {
    if (!filteredData.features || filteredData.features.length === 0) {
      return { layers: [], lightingEffect: createIndoorLighting(false) };
    }

    const isDollhouseMode = selectedFloors.length > 1;
    const isSingleFloorMode = selectedFloors.length === 1;

    try {
      // Create GeoJSON layer
      const layer = new GeoJsonLayer({
        id: "indoor-building-layer",
        data: filteredData,
        pickable: true,
        stroked: true,
        filled: true,
        extruded: true,
        wireframe: false,
        lineWidthMinPixels: isSingleFloorMode ? 2 : isDollhouseMode ? 1.5 : 1,
        lineWidthMaxPixels: isSingleFloorMode ? 3 : isDollhouseMode ? 2.5 : 2,

        material: (feature) => {
          const props = feature?.properties || {};
          // Floor surfaces need high ambient/diffuse to appear bright white/transparent
          if (isFloorSurface(props)) {
            return {
              ambient: 0.95,
              diffuse: 0.95,
              shininess: 0,
              specularColor: [0, 0, 0],
            };
          }
          // Regular compartments use standard material
          return {
            ambient: 0.4,
            diffuse: 0.8,
            shininess: 0,
            specularColor: [0, 0, 0],
          };
        },

        getFillColor: (feature) => {
          const props = feature.properties || {};
          const roomId = props.id || props.name || "";
          const floorNum = props.level ?? props.floor ?? props.nivel ?? 0;

          if (highlightedRoomId === roomId) {
            return [255, 200, 0, 255];
          }

          if (isFloorSurface(props)) {
            return getFloorSurfaceColor(floorNum, isDollhouseMode);
          }

          const baseColor = parseColor(props.color);

          const nameLower =
            typeof props.name === "string" ? props.name.toLowerCase() : "";
          const isSpecialCompartment =
            nameLower.includes("stair") ||
            nameLower.includes("structure") ||
            nameLower.includes("mechanical") ||
            nameLower.includes("elevator") ||
            nameLower.includes("shaft");

          let shadedColor;
          if (isSpecialCompartment) {
            // Preserve EXACT color from GeoJSON - NO modifications
            shadedColor = [baseColor[0], baseColor[1], baseColor[2]];
          } else {
            // Apply very subtle floor-based shading for regular rooms only
            const shadeFactor = Math.max(
              0.9,
              Math.min(1.1, 0.98 + floorNum * 0.02)
            );
            shadedColor = [
              Math.min(255, Math.round(baseColor[0] * shadeFactor)),
              Math.min(255, Math.round(baseColor[1] * shadeFactor)),
              Math.min(255, Math.round(baseColor[2] * shadeFactor)),
            ];
          }

          let alpha = 255;
          const isFacade =
            nameLower.includes("exterior") || nameLower.includes("facade");
          const isOuterWall =
            nameLower.includes("floor") && !nameLower.includes("floor_");

          if (isDollhouseMode) {
            if (selectedFloors.includes(floorNum)) {
              alpha = isFacade
                ? 0
                : isOuterWall
                ? Math.round(255 * 0.15)
                : Math.round(255 * translucency);
            } else {
              const maxFloor = Math.max(...selectedFloors);
              const minFloor = Math.min(...selectedFloors);
              if (floorNum > maxFloor) {
                alpha = Math.round(255 * translucency * 0.15);
              } else if (floorNum < minFloor) {
                alpha = Math.round(255 * translucency * 0.4);
              } else {
                alpha = Math.round(255 * translucency * 0.3);
              }
            }
          } else if (isSingleFloorMode) {
            if (selectedFloors.includes(floorNum)) {
              alpha = Math.round(255 * Math.max(0.85, translucency));
            } else {
              alpha = 255;
            }
          } else {
            alpha = 255;
          }

          return [...shadedColor, alpha];
        },

        getLineColor: (feature) => {
          const props = feature.properties || {};
          const floorNum = props.level ?? props.floor ?? props.nivel ?? 0;
          let alpha = 220;

          if (isDollhouseMode) {
            if (selectedFloors.includes(floorNum)) {
              alpha = 255;
            } else {
              const maxFloor = Math.max(...selectedFloors);
              const minFloor = Math.min(...selectedFloors);
              if (floorNum > maxFloor) {
                alpha = 30;
              } else if (floorNum < minFloor) {
                alpha = 100;
              } else {
                alpha = 80;
              }
            }
          } else if (isSingleFloorMode) {
            alpha = selectedFloors.includes(floorNum) ? 255 : 220;
          }

          const edgeColor = isDollhouseMode || isSingleFloorMode ? 25 : 40;
          return [edgeColor, edgeColor, edgeColor, alpha];
        },

        getElevation: (feature) =>
          computeElevation(
            feature,
            floorSpacing,
            heightExaggeration,
            isDollhouseMode
          ),

        onClick: (info) => {
          if (info.object && onRoomClick) {
            onRoomClick(info.object.properties);
          }
        },

        updateTriggers: {
          getFillColor: [highlightedRoomId, translucency, selectedFloors],
          getLineColor: [selectedFloors, translucency],
          getElevation: [floorSpacing, heightExaggeration],
        },
      });

      return {
        layers: [layer],
        lightingEffect: createIndoorLighting(isDollhouseMode),
      };
    } catch (error) {
      console.error("Error creating indoor building layers:", error);
      return { layers: [], lightingEffect: createIndoorLighting(false) };
    }
  }, [
    filteredData,
    selectedFloors,
    translucency,
    heightExaggeration,
    floorSpacing,
    highlightedRoomId,
    onRoomClick,
  ]);

  return { layers, lightingEffect };
};

export default IndoorBuilding;

// ============================================================================
// HELPER EXPORTS
// ============================================================================

export { createIndoorLighting, parseColor, computeElevation };
