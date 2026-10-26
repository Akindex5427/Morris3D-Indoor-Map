import { parseFeatureColor } from "./featureColors";
import { ROOM_FUNCTION_CONFIG } from "./roomColorConfig";

export const UNIFORM_ROOM_COLOR = Object.freeze([174, 181, 187]);
export const UNCLASSIFIED_ROOM_COLOR = Object.freeze([174, 181, 187]);

export function getRoomFunction(properties = {}, config = ROOM_FUNCTION_CONFIG) {
  if (!config?.field || !config.provenance?.trim()) return null;
  const value = properties[config.field];
  if (value == null || !["string", "number"].includes(typeof value)) return null;
  if (!Object.prototype.hasOwnProperty.call(config.values || {}, String(value))) return null;
  const id = config.values[String(value)];
  const category = config.categories?.find(item => item.id === id);
  if (!category?.label?.trim() || !Array.isArray(category.color) || category.color.length !== 3 ||
      !category.color.every(channel => Number.isInteger(channel) && channel >= 0 && channel <= 255)) return null;
  return category;
}

export function resolveRoomColor(properties, mode = "original", config = ROOM_FUNCTION_CONFIG) {
  if (mode === "uniform") return [...UNIFORM_ROOM_COLOR];
  if (mode === "function") return [...(getRoomFunction(properties, config)?.color || UNCLASSIFIED_ROOM_COLOR)];
  return parseFeatureColor(properties?.color);
}

// Call with the current view's features, never the entire catalog for a map legend.
export function summarizeRoomFunctions(features = [], config = ROOM_FUNCTION_CONFIG) {
  const categories = new Map();
  let unclassified = 0;
  for (const feature of features) {
    const category = getRoomFunction(feature.properties, config);
    if (!category) { unclassified++; continue; }
    const row = categories.get(category.id) || { ...category, count: 0 };
    row.count++;
    categories.set(category.id, row);
  }
  return { categories: [...categories.values()].sort((a, b) => a.label.localeCompare(b.label)),
    unclassified, classified: features.length - unclassified };
}
