import { useEffect, useRef, useState } from "react";
import { ROOM_FLOORS, adjacentRoomFloors, roomCatalogStore } from "../utils/roomCatalog";
import { correspondenceFloor } from "../utils/roomCorrespondenceIdentity";

const relevantFloors = feature => {
  const floor = correspondenceFloor(feature), adjacent = adjacentRoomFloors(floor);
  return [floor, adjacent.above, adjacent.below].filter(value => value !== null);
};

export function useRoomCorrespondence(catalog) {
  const [request, setRequest] = useState(null), [result, setResult] = useState(null);
  const [candidateKey, setCandidateKey] = useState(null);
  const worker = useRef(null), versions = useRef(null), sequence = useRef(0), submitted = useRef(null);
  useEffect(() => () => {
    sequence.current++; worker.current?.terminate();
    worker.current = null; versions.current = null; submitted.current = null;
  }, []);
  useEffect(() => {
    if (!request) return;
    let floors;
    try { floors = relevantFloors(request.feature); }
    catch (error) { setResult({ status: "error", message: error.message }); return; }
    const next = floors.map(floor => catalog.datasets[floor]);
    if (floors.some(floor => catalog.loadingFloors.includes(floor))) {
      sequence.current++; submitted.current = null;
      setResult(previous => previous?.status === "loading" ? previous : { status: "loading" });
      return;
    }
    if (submitted.current?.request === request && next.every((data, i) => data === submitted.current.data[i])) return;
    const id = ++sequence.current;
    setResult({ status: "loading" });
    try {
      if (!worker.current) {
        worker.current = new Worker(new URL("../workers/roomCorrespondence.worker.js", import.meta.url), { type: "module" });
        worker.current.onmessage = event => {
          if (event.data.id !== sequence.current) return;
          if (event.data.result.status === "error") versions.current = null;
          setResult(event.data.result);
        };
      }
      const currentWorker = worker.current;
      currentWorker.onerror = () => {
        if (id === sequence.current) setResult({ status: "error", message: "The overlap analysis worker could not run. Please retry." });
        currentWorker.terminate();
        if (worker.current === currentWorker) { worker.current = null; versions.current = null; submitted.current = null; }
      };
      const allVersions = ROOM_FLOORS.map(floor => catalog.datasets[floor]);
      const changed = !versions.current || allVersions.some((data, i) => data !== versions.current[i]);
      currentWorker.postMessage({ id, feature: request.feature, ...(changed ? { datasets: catalog.datasets } : {}) });
      versions.current = allVersions;
      submitted.current = { request, data: next };
    } catch (error) { setResult({ status: "error", message: error.message }); }
  }, [request, catalog.datasets, catalog.loadingFloors]);
  const start = feature => {
    sequence.current++; submitted.current = null;
    setCandidateKey(null); setResult({ status: "loading" }); setRequest({ feature });
    try { void Promise.allSettled(relevantFloors(feature).map(floor => roomCatalogStore.loadFloor(floor))); }
    catch (error) { setResult({ status: "error", message: error.message }); }
  };
  const close = () => { sequence.current++; submitted.current = null; setRequest(null); setResult(null); setCandidateKey(null); };
  return { request, result, candidateKey, setCandidateKey, start, close };
}
