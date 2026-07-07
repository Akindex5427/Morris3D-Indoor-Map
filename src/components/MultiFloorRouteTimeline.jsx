import React, { useEffect, useMemo, useState } from "react";
import Map3D from "./Map3D";
import {
  buildPathMetrics,
  positionAtDistance,
  splitPath,
} from "../hooks/useRoutePreview";

const formatFloorLabel = (floor) => `F${floor}`;

const getConnectorLabel = (type) => {
  if (type === "elevator") return "elevator";
  if (type === "ramp") return "ramp";
  return "stairs";
};

const getConnectorIcon = (type) => {
  if (type === "elevator") return "E";
  if (type === "ramp") return "R";
  return "S";
};

const floorRoleLabel = (panel) => {
  if (panel.role === "start") return `Start floor: ${formatFloorLabel(panel.floorId)}`;
  if (panel.role === "destination") {
    return `Destination floor: ${formatFloorLabel(panel.floorId)}`;
  }
  return `Transfer floor: ${formatFloorLabel(panel.floorId)}`;
};

const MultiFloorRoutePanelMap = ({
  panel,
  roomsData,
  centerlinesData,
  lightingEnabled,
  translucency,
  basemapStyle,
  routeFocus,
  cinematicAnimationsEnabled,
  layoutSignal,
  routePreview,
}) => {
  const [viewState, setViewState] = useState({
    longitude: 0,
    latitude: 0,
    zoom: 18,
    pitch: 0,
    bearing: 0,
  });
  const [cameraKey, setCameraKey] = useState(0);
  const routeSegments = useMemo(
    () => [
      {
        floorId: panel.floorId,
        type: "horizontal",
        path: panel.path,
      },
    ],
    [panel.floorId, panel.path],
  );

  useEffect(() => {
    setCameraKey((key) => key + 1);
  }, [panel.id, layoutSignal]);

  return (
    <Map3D
      selectedFloor={panel.floorId}
      selectedFloors={[]}
      filteredRooms={[]}
      highlightedRoomId={null}
      hoveredRoomId={null}
      colorScheme="default"
      viewState={viewState}
      onViewStateChange={(nextViewState) =>
        setViewState({
          ...nextViewState,
          pitch: 0,
          bearing: 0,
        })
      }
      lightingEnabled={lightingEnabled}
      translucency={translucency}
      heightExaggeration={1}
      basemapStyle={basemapStyle}
      routePath={panel.path}
      routeRenderPath={panel.path}
      routeSegments={routeSegments}
      routeTransitionMarkers={panel.transitionMarkers}
      routeFocus={routeFocus}
      routeFloorId={panel.floorId}
      routeCameraKey={cameraKey}
      roomsData={roomsData}
      centerlinesData={centerlinesData}
      activeFloor={panel.floorId}
      cinematicAnimationsEnabled={cinematicAnimationsEnabled}
      initialRevealReplayKey={0}
      routePreview={routePreview}
      highlightedStep={null}
      layoutSignal={layoutSignal}
      layoutDiagnostics={{
        routeVisualizationMode: "timeline",
        panelId: panel.id,
        panelFloor: panel.floorId,
      }}
    />
  );
};

const MultiFloorRouteTimeline = ({
  route,
  roomsData,
  centerlinesData,
  lightingEnabled,
  translucency,
  basemapStyle,
  cinematicAnimationsEnabled,
  layoutSignal,
  routePreview = null,
}) => {
  const panels = route?.visualizationPanels || [];
  const transitions = route?.visualizationTransitions || [];
  const playbackModels = useMemo(() => {
    let cumulativeMeters = 0;
    return panels.map((panel) => {
      const metrics = buildPathMetrics(panel.path);
      const startMeters = cumulativeMeters;
      const endMeters = cumulativeMeters + metrics.total;
      cumulativeMeters = endMeters;
      const localProgress = Math.max(
        0,
        Math.min(
          metrics.total,
          (routePreview?.progressMeters ?? 0) - startMeters,
        ),
      );
      const cursorPosition = positionAtDistance(
        panel.path,
        metrics.cumulative,
        localProgress,
      );
      const split = splitPath(panel.path, metrics.cumulative, localProgress);

      return {
        panelId: panel.id,
        startMeters,
        endMeters,
        totalMeters: metrics.total,
        localProgress,
        isActive:
          Boolean(routePreview) &&
          routePreview.progressMeters >= startMeters &&
          routePreview.progressMeters <= endMeters,
        routePreview:
          routePreview && cursorPosition
            ? {
                traveledPath: split.traveled,
                remainingPath: split.remaining,
                cursorPosition,
              }
            : null,
      };
    });
  }, [panels, routePreview]);
  const playbackByPanelId = useMemo(
    () =>
      new Map(
        playbackModels.map((model) => [
          model.panelId,
          model,
        ]),
      ),
    [playbackModels],
  );
  const activeTransitionIndex = playbackModels.findIndex(
    (model, index) =>
      index < transitions.length &&
      routePreview &&
      Math.abs((routePreview.progressMeters ?? 0) - model.endMeters) < 0.75,
  );

  if (!route || panels.length === 0) {
    return null;
  }

  return (
    <div className="multi-floor-route-view" aria-label="Multi-floor route timeline">
      <div className="multi-floor-route-scroll">
        {panels.map((panel, index) => {
          const nextTransition = transitions[index] || null;
          const panelPlayback = playbackByPanelId.get(panel.id);
          return (
            <React.Fragment key={panel.id}>
              <section
                className={`route-timeline-card${
                  panelPlayback?.isActive ? " route-timeline-card-active" : ""
                }`}
              >
                <div className="route-timeline-card-header">
                  <div>
                    <span className="route-timeline-kicker">
                      {floorRoleLabel(panel)}
                    </span>
                    <h3>{panel.title}</h3>
                  </div>
                  <span className="route-timeline-distance">
                    {Number.isFinite(panel.distance)
                      ? `${Math.round(panel.distance)} m`
                      : "Route segment"}
                  </span>
                </div>
                <div className="route-timeline-map">
                  <MultiFloorRoutePanelMap
                    panel={panel}
                    roomsData={roomsData}
                    centerlinesData={centerlinesData}
                    lightingEnabled={lightingEnabled}
                    translucency={translucency}
                    basemapStyle={basemapStyle}
                    routeFocus={route.focus}
                    cinematicAnimationsEnabled={cinematicAnimationsEnabled}
                    layoutSignal={layoutSignal}
                    routePreview={panelPlayback?.routePreview ?? null}
                  />
                </div>
              </section>

              {nextTransition && (
                <div
                  className={`route-timeline-transition${
                    activeTransitionIndex === index
                      ? " route-timeline-transition-active"
                      : ""
                  }`}
                >
                  <div className="route-transition-icon" aria-hidden="true">
                    {getConnectorIcon(nextTransition.connectorType)}
                  </div>
                  <div className="route-transition-copy">
                    <span>
                      {getConnectorLabel(nextTransition.connectorType)}
                      {nextTransition.connectorId
                        ? ` | ${nextTransition.connectorId}`
                        : ""}
                    </span>
                    <strong>{nextTransition.instruction}</strong>
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default MultiFloorRouteTimeline;
