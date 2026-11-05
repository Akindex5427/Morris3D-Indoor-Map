import { GeoJsonLayer, PathLayer } from "@deck.gl/layers";
import { buildFilteredIndoorFeatureCollection, computeElevation } from "../components/IndoorBuilding";

export const CORRESPONDENCE_COLORS = Object.freeze({ reference: [255, 200, 0], above: [13, 148, 136], below: [119, 117, 220], candidate: [13, 148, 136] });
const ANALYTICAL_PARAMETERS = Object.freeze({ depthTest: false, depthMask: false, blend: true, blendFunc: [770, 771, 1, 771] });
const transformedCache = new WeakMap();
function surfaceContext(features, floors, spacing) {
  let cache = transformedCache.get(features);
  if (!cache) { cache = new Map(); transformedCache.set(features, cache); }
  const key = `${[...floors].sort((a,b)=>a-b).join(",")}:${spacing}`;
  if (!cache.has(key)) {
    const data = buildFilteredIndoorFeatureCollection({type:"FeatureCollection", features}, floors, spacing);
    if (cache.size >= 16) cache.delete(cache.keys().next().value);
    cache.set(key, new Map(data.features.map(feature => [feature.properties.__roomSearchKey, feature])));
  }
  return cache.get(key);
}
const ringsOf = geometry => geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
const atHeight = (geometry, z) => ({ ...geometry, coordinates: geometry.coordinates.map(function lift(coordinates) {
  return typeof coordinates[0] === "number" ? [coordinates[0], coordinates[1], z] : coordinates.map(lift);
}) });
const floorOf = feature => Number(feature.properties.floor ?? feature.properties.level ?? feature.properties.nivel);
const empty = () => ({features:[], paths:[], intersections:[], intersectionPaths:[], focusPoints:[], projection:null});

export function correspondenceOverlayData(features, authoritativeFeatures, floors, spacing = 4.5, heightExaggeration = 1, overlap = null) {
  if (!features?.length || !floors?.length) return empty();
  const reference = features.find(f => f.properties.__correspondenceRole === "reference");
  if (!reference) return empty();
  const referenceKey = reference.properties.__roomSearchKey;
  const candidate = overlap?.referenceKey === referenceKey && features.find(f => f.properties.__roomSearchKey === overlap.key);
  const selected = candidate ? [reference,candidate] : [reference];
  const context = surfaceContext(authoritativeFeatures, floors, spacing);
  const stacked = floors.length > 1;
  const roofZ = feature => {
    const transformed = context.get(feature.properties.__roomSearchKey);
    if (!transformed) return null;
    const base = ringsOf(transformed.geometry)[0][0][2] || 0;
    return base + computeElevation(transformed, spacing, heightExaggeration, stacked);
  };
  const visible = selected.filter(feature => floors.includes(floorOf(feature)));
  if (!visible.length) return empty();
  // Single-floor mode projects only onto a visible member of the pair. Unrelated
  // floor views get no overlay; actual stack positions are used in F-ALL.
  const plane = stacked ? null : roofZ(visible[0]);
  if (!stacked && plane === null) return empty();
  const direction = overlap?.direction || "above";
  const roofs = (stacked ? visible : selected).flatMap(feature => {
    const z = stacked ? roofZ(feature) : plane;
    if (z === null) return [];
    return [{...feature, properties:{...feature.properties,
      __correspondenceRole: feature === reference ? "reference" : "candidate",
      __analysisDirection: direction, __displayFloor: stacked ? floorOf(feature) : floors[0],
      __projected: !stacked && floorOf(feature) !== floors[0]}, geometry:atHeight(feature.geometry,z)}];
  });
  const intersections = candidate && overlap.intersectionGeometry ? visible.flatMap(feature => {
    const z = stacked ? roofZ(feature) : plane;
    if (z === null) return [];
    return [{type:"Feature", properties:{ referenceKey, candidateKey:overlap.key, floor:floorOf(feature),
      direction, intersectionArea:overlap.intersectionArea, referencePercent:overlap.referencePercent },
      geometry:atHeight(overlap.intersectionGeometry,z)}];
  }) : [];
  const paths = roofs.flatMap(feature => ringsOf(feature.geometry).map(path => ({path,
    key:feature.properties.__roomSearchKey, role:feature.properties.__correspondenceRole,
    color:feature.properties.__correspondenceRole === "reference" ? CORRESPONDENCE_COLORS.reference : CORRESPONDENCE_COLORS[direction],
    projected:feature.properties.__projected, floor:feature.properties.__displayFloor})));
  return {features:roofs, paths, intersections,
    intersectionPaths:intersections.flatMap(feature => ringsOf(feature.geometry).map(path => ({path,floor:feature.properties.floor}))),
    focusPoints:roofs.flatMap(feature => ringsOf(feature.geometry).flat()),
    projection:!stacked && candidate ? {displayFloor:floors[0],sourceFloor:floorOf(selected.find(f=>floorOf(f)!==floors[0]))} : null};
}

export function createCorrespondenceLayers(options) {
  const data = options.data || correspondenceOverlayData(options.features, options.authoritativeFeatures, options.floors, options.spacing, options.heightExaggeration, options.overlap);
  if (!data.features.length) return [];
  const layers = [];
  if (data.intersections.length) layers.push(new GeoJsonLayer({id:"room-overlap-intersection-fill",
    data:{type:"FeatureCollection",features:data.intersections}, pickable:false, stroked:false, filled:true, extruded:false, material:false,
    getFillColor:feature=>[...CORRESPONDENCE_COLORS[feature.properties.direction],110], parameters:ANALYTICAL_PARAMETERS}));
  layers.push(new PathLayer({id:"room-correspondence-casing",data:data.paths,pickable:false,
    getPath:row=>row.path,getColor:[20,28,38,210],widthUnits:"pixels",getWidth:5,parameters:ANALYTICAL_PARAMETERS}));
  layers.push(new PathLayer({id:"room-correspondence-outline",data:data.paths,pickable:false,
    getPath:row=>row.path,getColor:row=>[...row.color,255],widthUnits:"pixels",getWidth:3,parameters:ANALYTICAL_PARAMETERS}));
  if(data.intersectionPaths.length) layers.push(new PathLayer({id:"room-overlap-intersection-outline",data:data.intersectionPaths,pickable:false,
    getPath:row=>row.path,getColor:[250,252,255,255],widthUnits:"pixels",getWidth:1.5,parameters:ANALYTICAL_PARAMETERS}));
  return layers;
}
