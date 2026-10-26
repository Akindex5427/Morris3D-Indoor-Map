# Morris 3D Indoor Map

An interactive 3D indoor map viewer for exploring a multi-floor building, searching rooms, switching floors, and generating indoor routes.

## ELI5 Overview

Think of this app like Google Maps, but for the inside of one building.

Instead of roads and highways, it uses room shapes, hallway lines, stairs, elevators, and floor data stored in local GeoJSON files. The app draws those files as a 3D building, lets you pick floors, search for rooms, and calculate routes from one room to another.

Mapbox provides the outside map background. The indoor rooms, floors, walls, and routing data come from this project.

## Goals

- Show a building as an interactive 3D indoor map.
- Let users switch between individual floors or view all floors together.
- Let users search for rooms by name, type, or number.
- Let users plan routes between rooms.
- Support same-floor and multi-floor routing using stairs or elevators.
- Display turn-by-turn directions and route preview animations.
- Package the app so it can be hosted as a static site on Apache or another web server.

## Tech Stack

### React

React is the UI framework. It controls the app screens, buttons, search box, route planner, popups, and state changes.

### Vite

Vite is the build tool and local development server. It runs the app during development and creates the production files in `dist/`.

Common commands:

```bash
npm run dev
npm run build
npm run preview
npm run test
```

### Deck.gl

Deck.gl renders the custom 3D map layers. It draws the indoor building, room shapes, walls, route paths, labels, markers, and visual effects.

### Mapbox

Mapbox provides the basemap behind the indoor model. The app uses a Mapbox token from:

```text
VITE_MAPBOX_TOKEN
```

The Mapbox token is used for the background map style. The indoor room and floor data are not pulled from Mapbox.

### GeoJSON

GeoJSON files store the building data. These files live in `public/` during development and are copied into `dist/` during production builds.

Examples:

```text
rooms-level-01-WGS.geojson
rooms-level-7-WGS.geojson
rooms-all-WGS-v6.geojson
room_level_1_centerlines.geojson
wall.geojson
```

### Custom Indoor Routing

The `routing/` folder contains the routing logic. It builds graph-based routes from centerline GeoJSON data and supports both same-floor and multi-floor navigation.

## Project Structure

```text
Morris3D-IndoorMap/
  public/              Static GeoJSON and public assets
  routing/             Indoor routing engine and graph logic
  src/
    components/        React UI and map components
    hooks/             React hooks
    layers/            Deck.gl layer helpers
    utils/             Route, color, wall, and direction utilities
    App.jsx            Main application
    index.jsx          React entry point
  dist/                Production build output
  .env                 Local environment variables
  package.json         Scripts and dependencies
  vite.config.js       Vite configuration
```

## Getting Started

Install dependencies:

```bash
npm install
```

Create a `.env` file with a Mapbox token:

```text
VITE_MAPBOX_TOKEN=your_mapbox_token_here
```

Start the development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

The production-ready files will be created in:

```text
dist/
```

## Apache Deployment

To host this app on Apache, upload the contents of `dist/` to your web root.

Example:

```text
/var/www/html/
```

You do not need to upload:

```text
src/
node_modules/
.env
package.json
vite.config.js
```

You do need all files generated inside `dist/`, including:

```text
index.html
assets/
*.geojson
manifest.json
robots.txt
favicon.ico
```

If hosting in a subfolder, such as:

```text
https://example.com/indoor-map/
```

set the Vite base path before building:

```js
export default defineConfig({
  base: "/indoor-map/",
  // existing config...
});
```

Then run:

```bash
npm run build
```

## Notes

### Night lighting

Enable **Night mode** in Visual settings (or use the existing dark-mode keyboard
shortcut). Day mode restores the selected daytime basemap, room materials, and
opaque exterior walls. Night mode uses a dark basemap, a dark 35%-opacity envelope,
and warm room illumination derived from nearby lights on the same floor.

`public/interior_lights.geojson` is the runtime light source. It combines the 138
supplied F0–F6 points; the original per-floor files are preserved. Radii in this
combined file are tuned to 6–14 m using 85% of the nearest same-floor light spacing,
clamped to that range. The duplicate F5 identifier on an F6 source point is corrected
to `F6-light-19`. No F7 points were supplied; F7 supports the same schema and shows
no fixtures until its light features are added.

Each Point uses `light_id`, `floor_id` (numeric or `F` prefix), `enabled`, `intensity`,
`radius_m`, `color`, `light_type`, `base_height`, and `height`. Heights are local
floor elevations. Placement derives each floor's datum from the most common room
base elevation, then applies the existing stacking offset or single-floor base
subtraction. This also supports the absolute heights in the F-ALL room export.
Disabled or invalid points do not render. `radius_m` is used directly,
with smooth falloff reaching zero outside the radius (a 100 m defensive maximum).

Room illumination uses distance to the polygon footprint and its center, with
hole-aware boundaries, same-floor spatial indexing, cached geometry results, and
bounded accumulation from overlapping lights. It retains the original room hue
and adds a modest warm contribution using unlit night materials. This is an
art-directed emissive approximation rather than shadow-casting or global illumination.
Three instanced draw calls render light pools, soft additive halos, and bright
fixtures; there are no additional dynamic PointLights. The sprite budget is 256,
distributed across visible floors. Room influence is independent of that sprite cap.
Camera movement and route animation reuse cached distances. Lighting appears after
the initial building reveal, and does not participate in picking, routing, or search.

If lights cannot load, the map shows a retry message. Toggle Night mode off/on to
retry. Edit the combined light asset and reload the page to update light positions,
radii, intensities, colors, or enabled flags.

- The app is currently a frontend-only static application.
- The indoor map data is loaded from local GeoJSON files.
- The Mapbox token is only used for the map background.
- Production deployment should use the `dist/` folder.
