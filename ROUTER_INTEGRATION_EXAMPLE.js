/**
 * Complete Integration Example
 * ===========================
 * Shows how to integrate the graph-based routing system into your React application
 */

// ============================================================================
// 1. INITIALIZE ROUTER IN YOUR APP
// ============================================================================

import { IndoorRouter, NavigationGraph } from './routing';

// In your App.jsx or main component initialization:

async function initializeRouter() {
  try {
    // Load GeoJSON files
    const centerlinesResponse = await fetch('/basemment_centerlines.geojson');
    const centerlinesData = await centerlinesResponse.json();

    const walkableResponse = await fetch('/room_basement_walkable.geojson');
    const walkableData = await walkableResponse.json();

    const obstaclesResponse = await fetch('/room_basement_obstacle_buffered.geojson');
    const obstaclesData = await obstaclesResponse.json();

    // Create router instance
    const router = new IndoorRouter(
      centerlinesData,
      walkableData,
      obstaclesData,
      {
        maxSnapDistanceMeters: 50,         // Allow snapping up to 50m away
        nodeToleranceMeters: 0.05,         // Cluster nearby nodes (5cm)
        validationSampleStepMeters: 0.5,   // Check walkability every 50cm
        simplifyCollinearPoints: true      // Smooth out unnecessary waypoints
      }
    );

    // Get the underlying graph for debug visualization
    const graph = router.getGraph();
    console.log(`Graph loaded: ${graph.nodes.size} nodes, ${graph.edges.size} edges`);

    return router;
  } catch (error) {
    console.error('Failed to initialize router:', error);
    throw error;
  }
}

// ============================================================================
// 2. ROUTE COMPUTATION
// ============================================================================

interface NavigationRequest {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
}

function computeIndoorRoute(
  router: IndoorRouter,
  request: NavigationRequest
) {
  const result = router.computeRoute(
    { lat: request.startLat, lng: request.startLng },
    { lat: request.endLat, lng: request.endLng }
  );

  if (result.success) {
    return {
      success: true,
      waypoints: result.coordinates,
      distanceMeters: result.distance,
      waypointCount: result.waypointCount,
      // Convert to format your map library expects
      lngLatPoints: result.coordinates.map(({ lat, lng }) => [lng, lat])
    };
  } else {
    return {
      success: false,
      error: result.error,
      waypoints: [],
      distanceMeters: 0,
      waypointCount: 0
    };
  }
}

// ============================================================================
// 3. REACT INTEGRATION EXAMPLE
// ============================================================================

// In your RoutePlanner.jsx component:

import React, { useState, useEffect } from 'react';

export function RoutePlannerWithGraphRouting() {
  const [router, setRouter] = useState(null);
  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Initialize router on component mount
  useEffect(() => {
    initializeRouter()
      .then(r => setRouter(r))
      .catch(err => setError(err.message));
  }, []);

  // Compute route when start/end change
  useEffect(() => {
    if (!router || !start || !end) {
      setRoute(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = computeIndoorRoute(router, {
        startLat: start.lat,
        startLng: start.lng,
        endLat: end.lat,
        endLng: end.lng
      });

      if (result.success) {
        setRoute(result);
      } else {
        setError(result.error);
        setRoute(null);
      }
    } catch (err) {
      setError(err.message);
      setRoute(null);
    } finally {
      setLoading(false);
    }
  }, [router, start, end]);

  // Render your UI
  return (
    <div className="route-planner">
      <div className="planner-section">
        <label>Start Location</label>
        <input
          type="text"
          placeholder="Latitude"
          value={start?.lat || ''}
          onChange={(e) => setStart(s => ({ ...s, lat: parseFloat(e.target.value) }))}
        />
        <input
          type="text"
          placeholder="Longitude"
          value={start?.lng || ''}
          onChange={(e) => setStart(s => ({ ...s, lng: parseFloat(e.target.value) }))}
        />
      </div>

      <div className="planner-section">
        <label>End Location</label>
        <input
          type="text"
          placeholder="Latitude"
          value={end?.lat || ''}
          onChange={(e) => setEnd(s => ({ ...s, lat: parseFloat(e.target.value) }))}
        />
        <input
          type="text"
          placeholder="Longitude"
          value={end?.lng || ''}
          onChange={(e) => setEnd(s => ({ ...s, lng: parseFloat(e.target.value) }))}
        />
      </div>

      {loading && <div className="loading">Computing route...</div>}

      {error && <div className="error">{error}</div>}

      {route && (
        <div className="route-info">
          <p>Distance: {route.distanceMeters.toFixed(1)} meters</p>
          <p>Waypoints: {route.waypointCount}</p>
          <details>
            <summary>Route Coordinates</summary>
            <pre>{JSON.stringify(route.waypoints, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 4. MAP VISUALIZATION
// ============================================================================

// If using Mapbox GL JS:

function addRouteToMap(map, route) {
  if (!route || route.lngLatPoints.length === 0) return;

  const source = map.getSource('route');
  if (source) {
    source.setData({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: route.lngLatPoints
      }
    });
  } else {
    map.addSource('route', {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: route.lngLatPoints
        }
      }
    });

    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      paint: {
        'line-color': '#2667ff',
        'line-width': 4,
        'line-opacity': 0.8
      }
    });
  }

  // Add waypoint markers
  route.waypoints.forEach((point, index) => {
    const element = document.createElement('div');
    element.className = 'waypoint-marker';
    element.textContent = index + 1;

    new mapboxgl.Marker(element)
      .setLngLat([point.lng, point.lat])
      .addTo(map);
  });
}

// ============================================================================
// 5. DEBUGGING & VISUALIZATION
// ============================================================================

// Export graph nodes/edges for visualization

function debugVisualize(router) {
  const graph = router.getGraph();

  // Get all nodes
  console.log('Graph Nodes:');
  for (const [nodeId, node] of graph.nodes) {
    console.log(`  ${nodeId}: (${node.point.x.toFixed(2)}, ${node.point.y.toFixed(2)}) - component ${node.componentId}`);
  }

  // Get all edges
  console.log('Graph Edges:');
  for (const [edgeId, edge] of graph.edges) {
    console.log(`  ${edgeId}: ${edge.from} → ${edge.to} (${edge.weight.toFixed(2)}m)`);
  }

  // Component analysis
  const componentMap = new Map();
  for (const [nodeId, node] of graph.nodes) {
    if (!componentMap.has(node.componentId)) {
      componentMap.set(node.componentId, []);
    }
    componentMap.get(node.componentId).push(nodeId);
  }

  console.log('Connected Components:');
  for (const [componentId, nodeIds] of componentMap) {
    console.log(`  Component ${componentId}: ${nodeIds.length} nodes`);
  }

  // Return data for external visualization
  return {
    nodes: Array.from(graph.nodes.entries()).map(([id, node]) => ({
      id,
      x: node.point.x,
      y: node.point.y,
      component: node.componentId
    })),
    edges: Array.from(graph.edges.entries()).map(([id, edge]) => ({
      id,
      from: edge.from,
      to: edge.to,
      weight: edge.weight
    })),
    components: graph.componentCount
  };
}

// ============================================================================
// 6. ERROR HANDLING & FALLBACK
// ============================================================================

function handleRoutingError(error, fallbackAction) {
  console.error('Routing failed:', error);

  // Categorize errors
  if (error.includes('snap')) {
    // Point is too far from graph
    console.warn('Location too far from indoor map');
    fallbackAction?.showMessage('Your location is outside the navigable area');
  } else if (error.includes('disconnected')) {
    // Start/end in different components
    console.warn('Start and end are not connected');
    fallbackAction?.showMessage('Cannot route between these locations (disconnected areas)');
  } else if (error.includes('no path')) {
    // A* found no path
    console.warn('No path exists');
    fallbackAction?.showMessage('No route found between these points');
  } else {
    // Generic error
    fallbackAction?.showMessage('Navigation unavailable: ' + error);
  }

  // Optionally show user a suggestion
  if (fallbackAction?.showSuggestion) {
    fallbackAction.showSuggestion('Try selecting points closer to the corridor centerlines');
  }
}

// ============================================================================
// 7. PERFORMANCE OPTIMIZATION
// ============================================================================

// Cache router instance at module level
let cachedRouter = null;

async function getRouter() {
  if (!cachedRouter) {
    cachedRouter = await initializeRouter();
  }
  return cachedRouter;
}

// Debounce route computation
function debounce(fn, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

const debouncedComputeRoute = debounce((router, start, end, onResult) => {
  const result = computeIndoorRoute(router, {
    startLat: start.lat,
    startLng: start.lng,
    endLat: end.lat,
    endLng: end.lng
  });
  onResult(result);
}, 500); // Wait 500ms after user stops moving

// ============================================================================
// 8. EXPORT FOR USE IN COMPONENTS
// ============================================================================

export {
  initializeRouter,
  computeIndoorRoute,
  getRouter,
  debugVisualize,
  handleRoutingError,
  addRouteToMap,
  debouncedComputeRoute
};
