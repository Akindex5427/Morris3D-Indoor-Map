# Quick Start Guide - Graph-Based Indoor Routing

## 🚀 Get Started in 5 Minutes

### Step 1: Import the Router

```typescript
import { IndoorRouter } from "./routing";
```

### Step 2: Load Your GeoJSON Files

```javascript
// Load the three required GeoJSON files
const centerlines = await fetch("/basemment_centerlines.geojson").then((r) =>
  r.json(),
);
const walkable = await fetch("/room_basement_walkable.geojson").then((r) =>
  r.json(),
);
const obstacles = await fetch("/room_basement_obstacle_buffered.geojson").then(
  (r) => r.json(),
);
```

### Step 3: Create Router Instance

```typescript
const router = new IndoorRouter(centerlines, walkable, obstacles);
```

### Step 4: Compute a Route

```typescript
const result = router.computeRoute(
  { lat: 42.2622, lng: -83.7395 }, // Start
  { lat: 42.2625, lng: -83.739 }, // End
);

if (result.success) {
  console.log(
    `Route found! ${result.distance}m in ${result.waypointCount} steps`,
  );
  // Use result.coordinates for polyline
} else {
  console.error(result.error);
}
```

## 📊 What You Get

```typescript
interface RouteResult {
  success: boolean;                    // Was a path found?
  coordinates: [{lat, lng}, ...];      // Ordered waypoints
  distance: number;                    // Meters
  waypointCount: number;               // Number of waypoints
  error?: string;                      // Error message if failed
}
```

## 🎯 Common Use Cases

### Use Case 1: Basic Routing

```typescript
async function findRoute(startLat, startLng, endLat, endLng) {
  const router = new IndoorRouter(
    await fetch("/basemment_centerlines.geojson").then((r) => r.json()),
    await fetch("/room_basement_walkable.geojson").then((r) => r.json()),
    await fetch("/room_basement_obstacle_buffered.geojson").then((r) =>
      r.json(),
    ),
  );

  return router.computeRoute(
    { lat: startLat, lng: startLng },
    { lat: endLat, lng: endLng },
  );
}
```

### Use Case 2: With Error Handling

```typescript
function computeRoute(router, start, end) {
  const result = router.computeRoute(start, end);

  if (!result.success) {
    // Handle different error types
    if (result.error.includes("snap")) {
      alert("Location too far from corridors");
    } else if (result.error.includes("disconnected")) {
      alert("No path between these areas");
    } else {
      alert("Navigation failed: " + result.error);
    }
    return null;
  }

  return result;
}
```

### Use Case 3: Custom Configuration

```typescript
const router = new IndoorRouter(centerlines, walkable, obstacles, {
  // Allow snapping up to 100m away from corridor
  maxSnapDistanceMeters: 100,

  // More precise node snapping (1cm instead of 5cm)
  nodeToleranceMeters: 0.01,

  // Sample walkability more frequently
  validationSampleStepMeters: 0.25,

  // Don't remove collinear points (keep all waypoints)
  simplifyCollinearPoints: false,
});
```

### Use Case 4: Batch Routing

```typescript
async function findMultipleRoutes() {
  const router = new IndoorRouter(centerlines, walkable, obstacles);

  const routePairs = [
    [
      { lat: 42.26, lng: -83.74 },
      { lat: 42.27, lng: -83.73 },
    ],
    [
      { lat: 42.27, lng: -83.73 },
      { lat: 42.26, lng: -83.73 },
    ],
    [
      { lat: 42.26, lng: -83.73 },
      { lat: 42.27, lng: -83.74 },
    ],
  ];

  const routes = routePairs.map(([start, end]) =>
    router.computeRoute(start, end),
  );

  return routes;
}
```

## 🔧 Configuration Options

| Option                       | Default | Range      | Purpose                      |
| ---------------------------- | ------- | ---------- | ---------------------------- |
| `maxSnapDistanceMeters`      | ∞       | 1-1000     | Max distance to snap points  |
| `nodeToleranceMeters`        | 0.05    | 0.01-1     | Node clustering threshold    |
| `validationSampleStepMeters` | 0.5     | 0.1-5      | Walkability check frequency  |
| `simplifyCollinearPoints`    | true    | true/false | Remove unnecessary waypoints |

**Recommended Settings**:

- **Indoor mall**: `nodeToleranceMeters: 0.1, maxSnapDistanceMeters: 30`
- **Office building**: `nodeToleranceMeters: 0.05, maxSnapDistanceMeters: 50`
- **Large campus**: `nodeToleranceMeters: 0.1, maxSnapDistanceMeters: 100`
- **Precision required**: `simplifyCollinearPoints: false, nodeToleranceMeters: 0.01`

## 📱 React Integration

```jsx
import { useState, useEffect } from "react";
import { IndoorRouter } from "./routing";

export function RouteViewer() {
  const [router, setRouter] = useState(null);
  const [route, setRoute] = useState(null);

  // Initialize
  useEffect(() => {
    Promise.all([
      fetch("/basemment_centerlines.geojson").then((r) => r.json()),
      fetch("/room_basement_walkable.geojson").then((r) => r.json()),
      fetch("/room_basement_obstacle_buffered.geojson").then((r) => r.json()),
    ]).then(([centerlines, walkable, obstacles]) => {
      setRouter(new IndoorRouter(centerlines, walkable, obstacles));
    });
  }, []);

  const handleStartLocation = (lat, lng) => {
    const endLat = 42.26,
      endLng = -83.74;
    const result = router.computeRoute(
      { lat, lng },
      { lat: endLat, lng: endLng },
    );
    setRoute(result);
  };

  if (!route) return <div>Select a location</div>;
  if (!route.success) return <div>Error: {route.error}</div>;

  return (
    <div>
      <h2>Route: {route.distance.toFixed(1)}m</h2>
      <ol>
        {route.coordinates.map((coord, i) => (
          <li key={i}>
            {coord.lat.toFixed(6)}, {coord.lng.toFixed(6)}
          </li>
        ))}
      </ol>
    </div>
  );
}
```

## 🗺️ Map Integration (Mapbox)

```javascript
// Add route to Mapbox GL JS
function showRouteOnMap(map, route) {
  if (!route.success) return;

  const coordinates = route.coordinates.map((c) => [c.lng, c.lat]);

  map.getSource("route")?.setData({
    type: "Feature",
    geometry: { type: "LineString", coordinates },
  }) ||
    map.addSource("route", {
      type: "geojson",
      data: { type: "Feature", geometry: { type: "LineString", coordinates } },
    });

  map.getLayer("route-line") ||
    map.addLayer({
      id: "route-line",
      type: "line",
      source: "route",
      paint: {
        "line-color": "#2667ff",
        "line-width": 4,
        "line-opacity": 0.75,
      },
    });
}
```

## 🐛 Troubleshooting

### "Unable to snap the start point"

- **Cause**: Starting point is too far from centerlines
- **Fix**: Increase `maxSnapDistanceMeters` or pick a location closer to corridors

### "Start and end are in disconnected parts"

- **Cause**: No route exists between the two areas
- **Fix**: Choose a different destination, or check if centerline data has gaps

### "No centerline path found"

- **Cause**: A\* algorithm found no path after snapping (rare)
- **Fix**: Check if centerline GeoJSON is valid; verify walkable/obstacle areas

### Route is slow to compute

- **Cause**: Large graph or complex walkability checks
- **Fix**: Increase `validationSampleStepMeters` or reduce graph complexity

### Waypoints look strange

- **Cause**: Too many intermediate points
- **Fix**: Enable `simplifyCollinearPoints: true`

## 📚 Learn More

- [Complete Architecture Guide](./GRAPH_ROUTING_COMPLETE.md)
- [Integration Examples](./ROUTER_INTEGRATION_EXAMPLE.js)
- [Testing Guide](./TESTING_GUIDE.md)
- [Source Code](./routing/)

## 🎓 Under the Hood

Your router uses:

- **A\* Algorithm**: Optimal pathfinding with heuristic search
- **Priority Queue**: O(log n) open set operations
- **Local Projection**: Accurate distance in meters
- **Connected Components**: Handles disconnected graphs gracefully
- **Walkability Validation**: Ensures paths stay within valid areas

## 💡 Pro Tips

1. **Preload the router** at app startup to avoid startup latency
2. **Cache routes** if you have common destinations
3. **Use reasonable snap distance** (30-50m works well for most buildings)
4. **Monitor console** for warnings about disconnected areas
5. **Test edge cases** like routes along long corridors

## ✅ Next Steps

1. ✨ Initialize router in your app
2. 🎯 Connect to your UI components
3. 🗺️ Display routes on your map
4. 🚀 Deploy to production!

---

**Happy routing!** 🧭
