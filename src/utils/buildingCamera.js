import { WebMercatorViewport } from "@deck.gl/core";

export const MIN_MAP_ZOOM = 14;
export const MAX_MAP_ZOOM = 22;
export const DEFAULT_BUILDING_ORIENTATION = { pitch: 45, bearing: 0 };
export const clampMapZoom = (zoom) => Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, zoom));

// A hull at each occupied height retains actual silhouette extremes without
// projecting every room vertex on each fitting iteration. A single 3D box
// would include empty corners and leave the real building unnecessarily small.
function silhouettePoints(points) {
  const heights = new Map();
  for (const point of points) {
    if (!point.every(Number.isFinite)) continue;
    if (!heights.has(point[2])) heights.set(point[2], []);
    heights.get(point[2]).push(point);
  }
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return [...heights.values()].flatMap(plane => {
    plane.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const half = values => {
      const hull = [];
      for (const point of values) {
        while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) hull.pop();
        hull.push(point);
      }
      return hull;
    };
    return [...half(plane), ...half([...plane].reverse())];
  });
}

// Use the renderer's fully revealed data and extrusion accessor, retaining its
// current Z convention and all source XY coordinates.
export function getBuildingFitPoints(features, getElevation) {
  const points = [];
  for (const feature of features) {
    const geometry = feature.geometry;
    const coordinates = geometry?.type === "Polygon" ? geometry.coordinates.flat()
      : geometry?.type === "MultiPolygon" ? geometry.coordinates.flat(2) : [];
    const elevation = getElevation(feature);
    for (const [x, y, z = 0] of coordinates) {
      if (![x, y, z, elevation].every(Number.isFinite)) continue;
      points.push([x, y, z], [x, y, z + elevation]);
    }
  }
  return silhouettePoints(points);
}

// The shell can extend above the rooms. Read its final (not animated) height
// and local mesh XY without fetching or modifying any additional source data.
export function getWallFitPoints(layers) {
  return silhouettePoints(layers.flatMap(layer => (layer.props.data || []).flatMap(wall => {
    const positions = wall.mesh?.attributes?.positions?.value;
    if (!positions || !wall.origin) return [];
    const [lng, lat] = wall.origin;
    const radians = lat * Math.PI / 180;
    const metersLat = 111132.92 - 559.82 * Math.cos(2 * radians) + 1.175 * Math.cos(4 * radians);
    const metersLng = 111412.84 * Math.cos(radians) - 93.5 * Math.cos(3 * radians) + 0.118 * Math.cos(5 * radians);
    const points = [];
    for (let i = 0; i < positions.length; i += 3) {
      const x = lng + positions[i] / metersLng;
      const y = lat + positions[i + 1] / metersLat;
      points.push([x, y, wall.bottom], [x, y, wall.top]);
    }
    return points;
  })));
}

export function projectFitBounds(viewport, points) {
  const projected = points.map(point => viewport.project(point));
  if (projected.some(point => !point.every(Number.isFinite) || point[2] < -1 || point[2] > 1)) return null;
  return projected.reduce((box, [x, y]) => ({
    left: Math.min(box.left, x), right: Math.max(box.right, x),
    top: Math.min(box.top, y), bottom: Math.max(box.bottom, y),
  }), { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
}

// Find the largest zoom whose projected 3D volume fits within 85% of the usable
// rectangle. Recenter in screen space at every step; planar fitBounds alone
// cannot account for the upper floors of a pitched, stacked building.
export function fitBuildingCamera({ points, width, height, insets = {}, orientation = DEFAULT_BUILDING_ORIENTATION, maxZoom = MAX_MAP_ZOOM, contextPoints = [] }) {
  if (!points.length || width < 100 || height < 100) return null;
  const left = insets.left || 0, right = width - (insets.right || 0);
  const top = insets.top || 0, bottom = height - (insets.bottom || 0);
  if (right - left < 60 || bottom - top < 60) return null;
  const target = [(left + right) / 2, (top + bottom) / 2];
  const allowedWidth = (right - left) * 0.85;
  const allowedHeight = (bottom - top) * 0.85;
  const longitude = (Math.min(...points.map(p => p[0])) + Math.max(...points.map(p => p[0]))) / 2;
  const latitude = (Math.min(...points.map(p => p[1])) + Math.max(...points.map(p => p[1]))) / 2;
  const candidate = (zoom) => {
    let view = { longitude, latitude, zoom, pitch: orientation.pitch, bearing: orientation.bearing };
    let bounds;
    for (let i = 0; i < 12; i++) {
      const viewport = new WebMercatorViewport({ ...view, width, height });
      bounds = projectFitBounds(viewport, points);
      if (!bounds) return null;
      const dx = (bounds.left + bounds.right) / 2 - target[0];
      const dy = (bounds.top + bounds.bottom) / 2 - target[1];
      if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) break;
      const center = viewport.unproject([width / 2 + dx, height / 2 + dy]);
      view = { ...view, longitude: center[0], latitude: center[1] };
    }
    bounds = projectFitBounds(new WebMercatorViewport({ ...view, width, height }), points);
    // Search may center a room near an outside edge. Keep the surrounding floor
    // in the viewport rather than magnifying the room until the building vanishes.
    if (contextPoints.length) {
      const context = projectFitBounds(new WebMercatorViewport({ ...view, width, height }), contextPoints);
      if (!context || context.left < left || context.right > right || context.top < top || context.bottom > bottom) return null;
    }
    return bounds && bounds.right - bounds.left <= allowedWidth && bounds.bottom - bounds.top <= allowedHeight
      && bounds.left >= left && bounds.right <= right && bounds.top >= top && bounds.bottom <= bottom ? view : null;
  };
  let low = MIN_MAP_ZOOM, high = clampMapZoom(maxZoom);
  let best = candidate(low);
  if (!best) return null;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    const fitted = candidate(mid);
    if (fitted) { best = fitted; low = mid; } else high = mid;
  }
  return { ...best, transitionDuration: 0 };
}
