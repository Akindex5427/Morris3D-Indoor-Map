import { useEffect, useRef, useState } from "react";
import { roomCatalogStore } from "../utils/roomCatalog";

export function useRoomCorrespondence(catalog) {
  const [request, setRequest] = useState(null), [result, setResult] = useState(null);
  const [candidateKey, setCandidateKey] = useState(null);
  const worker = useRef(null), versions = useRef(null), sequence = useRef(0);
  useEffect(() => () => worker.current?.terminate(), []);
  useEffect(() => {
    if (!request || catalog.loadingFloors.length) return;
    const id = ++sequence.current;
    setResult({ status: "loading" });
    try {
      if (!worker.current) {
        worker.current = new Worker(new URL("../workers/roomCorrespondence.worker.js", import.meta.url), { type: "module" });
        worker.current.onmessage = event => { if (event.data.id === sequence.current) setResult(event.data.result); };
        worker.current.onerror = () => {
          setResult({ status: "error", message: "The overlap analysis worker could not run. Please retry." });
          worker.current?.terminate(); worker.current = null; versions.current = null;
        };
      }
      const next = Array.from({ length: 8 }, (_, floor) => catalog.datasets[floor]);
      const changed = !versions.current || next.some((data, floor) => data !== versions.current[floor]);
      worker.current.postMessage({ id, feature: request.feature, ...(changed ? { datasets: catalog.datasets } : {}) });
      versions.current = next;
    } catch (error) { setResult({ status: "error", message: error.message }); }
    return () => { sequence.current++; };
  }, [request, catalog.datasets, catalog.loadingFloors.length]);
  const start = feature => {
    sequence.current++;
    setCandidateKey(null); setResult({ status: "loading" }); setRequest({ feature });
    roomCatalogStore.loadAll();
  };
  const close = () => { sequence.current++; setRequest(null); setResult(null); setCandidateKey(null); };
  return { request, result, candidateKey, setCandidateKey, start, close };
}
