import { createCorrespondenceIndex, resolveAndAnalyze } from "../utils/roomCorrespondence";

let index;
self.onmessage = ({ data: { id, datasets, feature } }) => {
  try {
    if (datasets) index = createCorrespondenceIndex(datasets);
    if (!index) throw new Error("Floor geometries are not ready");
    self.postMessage({ id, result: resolveAndAnalyze(index, feature) });
  } catch (error) {
    self.postMessage({ id, result: { status: "error", message: error.message } });
  }
};
