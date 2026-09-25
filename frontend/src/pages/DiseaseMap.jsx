import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import L from "leaflet";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import { useAuth } from "../contexts/AuthContext";
import HeatLayer from "../components/ui/HeatLayer";
import api from "../services/api";

const DEFAULT_CENTER = {
  lat: 20.5937,
  lng: 78.9629,
};

const ALL_FIELD_EVIDENCE = "image_screening,pest_observation,environmental_risk";

// Module scope, so these are translation keys rather than text: `t` is not
// available out here. `evidenceLabel` takes `t` at the call site instead.
const EVIDENCE_LABEL_KEYS = {
  image_screening: "map.diseaseScreening",
  pest_observation: "map.pestObservation",
  environmental_risk: "map.environmentalRiskLabel",
  farm_risk: "map.farmRiskHotspot",
};

const EVIDENCE_STYLES = {
  image_screening: {
    color: "#DC2626",
    heat: 0.95,
  },
  pest_observation: {
    color: "#9333EA",
    heat: 0.85,
  },
  environmental_risk: {
    color: "#EFA02A",
    heat: 0.55,
  },
  farm_risk: {
    color: "#1D9F76",
    heat: 0.65,
  },
};

const RISK_INTENSITY = {
  LOW: 0.25,
  MODERATE: 0.55,
  HIGH: 0.8,
  CRITICAL: 1,
};

function isValidCoordinate(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);

  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function evidenceLabel(type, t) {
  return t(EVIDENCE_LABEL_KEYS[type]) || type?.replace(/_/g, " ") || t("map.observationFallback");
}

function getFeatureIntensity(feature) {
  if (feature.evidence_type === "farm_risk") {
    const intensity = Number(feature.risk_intensity);
    return Number.isFinite(intensity) ? Math.min(Math.max(intensity, 0.2), 1) : 0.45;
  }

  if (feature.evidence_type === "environmental_risk") {
    return RISK_INTENSITY[String(feature.label || "").toUpperCase()] || 0.55;
  }

  return EVIDENCE_STYLES[feature.evidence_type]?.heat || 0.75;
}

function formatDistance(metres) {
  const value = Number(metres);

  if (!Number.isFinite(value)) return "N/A";
  if (value >= 1000) return `${(value / 1000).toFixed(2)} km`;
  return `${Math.round(value)} m`;
}

function FitMapBounds({ bounds }) {
  const map = useMap();

  useEffect(() => {
    if (!bounds) return;

    if (bounds.getNorth() === bounds.getSouth() && bounds.getEast() === bounds.getWest()) {
      map.setView(bounds.getCenter(), 13);
    } else {
      map.fitBounds(bounds, { padding: [32, 32] });
    }
  }, [bounds, map]);

  return null;
}

const DiseaseMap = () => {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();

  const [observations, setObservations] = useState({
    features: [],
    farms: [],
    counts: {},
    mapped_total: 0,
  });
  const [farmMap, setFarmMap] = useState({
    items: [],
    summary: {
      farmers: 0,
      farms: 0,
      mapped_farms: 0,
    },
  });
  const [clusters, setClusters] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [evidenceFilter, setEvidenceFilter] = useState(ALL_FIELD_EVIDENCE);
  const [days, setDays] = useState(30);
  const [selectedFarmId, setSelectedFarmId] = useState("all");

  useEffect(() => {
    fetchMapData();
  }, [evidenceFilter, days, profile?.role]);

  const fetchMapData = async () => {
    try {
      setLoading(true);
      setError("");

      const params = {
        evidence: evidenceFilter,
        days,
      };

      const requests = [
        api.get("/geo/observations", { params }),
        api.get("/geo/clusters", { params }),
      ];

      if (profile?.role === "extension_officer") {
        requests.push(api.get("/extension/farmers"));
      }

      const [obsResponse, clusterResponse, farmMapResponse] = await Promise.all(requests);

      setObservations({
        features: obsResponse.data.features || [],
        farms: obsResponse.data.farms || [],
        counts: obsResponse.data.counts || {},
        mapped_total: obsResponse.data.mapped_total || 0,
        accounting: obsResponse.data.accounting || {},
      });
      setClusters(clusterResponse.data);
      setFarmMap({
        items: farmMapResponse?.data?.items || [],
        summary: farmMapResponse?.data?.summary || {
          farmers: 0,
          farms: 0,
          mapped_farms: 0,
        },
      });
    } catch (mapError) {
      console.error("Failed to fetch map data:", mapError);
      setError(
        mapError.response?.data?.detail ||
          "Could not load the hotspot map. Please try again.",
      );
      setObservations({
        features: [],
        farms: [],
        counts: {},
        mapped_total: 0,
      });
      setFarmMap({
        items: [],
        summary: {
          farmers: 0,
          farms: 0,
          mapped_farms: 0,
        },
      });
      setClusters(null);
    } finally {
      setLoading(false);
    }
  };

  const fieldFeatures = useMemo(
    () =>
      (observations.features || [])
        .map((feature) => ({
          ...feature,
          latitude: Number(feature.latitude),
          longitude: Number(feature.longitude),
        }))
        .filter((feature) => isValidCoordinate(feature.latitude, feature.longitude)),
    [observations.features],
  );

  const farmFeatures = useMemo(
    () =>
      (farmMap.items || [])
        .map((farm) => ({
          evidence_type: "farm_risk",
          id: farm.farm_id,
          farm_id: farm.farm_id,
          farm_name: farm.farm_name,
          farmer_name: farm.farmer_name,
          crop_name: farm.current_crop?.crop_name,
          label: farm.health?.risk_level || t("map.farmMapped"),
          detail: farm.health?.latest_status || t("map.noRecentStatus"),
          latitude: Number(farm.location?.latitude),
          longitude: Number(farm.location?.longitude),
          risk_intensity: farm.health?.risk_intensity,
          observed_at: farm.last_activity || new Date().toISOString(),
        }))
        .filter((feature) => isValidCoordinate(feature.latitude, feature.longitude)),
    [farmMap.items, t],
  );

  const farmOptions = useMemo(
    () =>
      (farmMap.items || [])
        .filter((farm) => isValidCoordinate(farm.location?.latitude, farm.location?.longitude))
        .map((farm) => ({
          id: String(farm.farm_id),
          label: `${farm.farmer_name || t("map.farmerLabel")} — ${farm.farm_name || t("map.farmLabel")}`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [farmMap.items, t],
  );

  const selectedFarmFeatures =
    selectedFarmId === "all"
      ? farmFeatures
      : farmFeatures.filter((feature) => String(feature.farm_id) === selectedFarmId);

  const selectedFieldFeatures =
    selectedFarmId === "all"
      ? fieldFeatures
      : fieldFeatures.filter((feature) => String(feature.farm_id) === selectedFarmId);

  const selectedFarmLabel =
    selectedFarmId === "all"
      ? t("map.allFarmers")
      : farmOptions.find((farm) => farm.id === selectedFarmId)?.label ||
        t("map.selectedFarmer");

  const showingFarmLayer = selectedFieldFeatures.length === 0 && selectedFarmFeatures.length > 0;
  const validFeatures = selectedFieldFeatures.length ? selectedFieldFeatures : selectedFarmFeatures;

  const validClusters = useMemo(
    () =>
      (clusters?.clusters || [])
        .map((cluster) => ({
          ...cluster,
          latitude: Number(cluster.centroid?.latitude),
          longitude: Number(cluster.centroid?.longitude),
          radiusMetres: Number(cluster.radius_metres),
        }))
        .filter((cluster) => isValidCoordinate(cluster.latitude, cluster.longitude)),
    [clusters],
  );

  const heatPoints = useMemo(
    () =>
      validFeatures.map((feature) => [
        feature.latitude,
        feature.longitude,
        getFeatureIntensity(feature),
      ]),
    [validFeatures],
  );

  const visibleClusters = useMemo(
    () => (selectedFarmId === "all" && !showingFarmLayer ? validClusters : []),
    [selectedFarmId, showingFarmLayer, validClusters],
  );

  const mapBounds = useMemo(() => {
    const points = [
      ...validFeatures.map((feature) => [feature.latitude, feature.longitude]),
      ...visibleClusters.map((cluster) => [cluster.latitude, cluster.longitude]),
    ];

    return points.length ? L.latLngBounds(points) : null;
  }, [validFeatures, visibleClusters]);

  const mapCenter = mapBounds
    ? {
        lat: mapBounds.getCenter().lat,
        lng: mapBounds.getCenter().lng,
      }
    : DEFAULT_CENTER;

  const renderMap = () => {
    if (error) {
      return (
        <div className="rounded-md border border-destructive/25 bg-destructive/10 p-5">
          <p className="text-sm font-semibold text-destructive">
            {t("map.dataUnavailable")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
      );
    }

    if (!validFeatures.length) {
      return (
        <div className="rounded-md border border-border bg-card p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted/50">
            <svg
              className="h-6 w-6 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>

          <p className="text-sm font-semibold text-foreground">
            {t("map.noData")}
          </p>

          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            {t("map.noDataHelp")}
          </p>
        </div>
      );
    }

    return (
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="relative h-[520px] bg-muted/50">
          <div className="absolute left-4 top-4 z-[400] max-w-xs rounded-md border border-border bg-card/95 p-4 shadow-sm backdrop-blur-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("map.surveillance")}
            </p>

            <h3 className="mt-1 text-sm font-semibold text-foreground">
              {showingFarmLayer ? t("map.farmHotspots") : t("map.observationsFound")}
            </h3>

            <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-primary">
              {showingFarmLayer ? farmFeatures.length : observations.mapped_total || validFeatures.length}
            </p>

            <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              {showingFarmLayer ? (
                <>
                  <div className="flex justify-between gap-4">
                    <span>{t("map.farmLocations")}</span>
                    <span className="font-medium tabular-nums text-foreground">
                      {farmMap.summary.mapped_farms || farmFeatures.length}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span>{t("map.selection")}</span>
                    <span className="max-w-32 truncate font-medium text-foreground">
                      {selectedFarmLabel}
                    </span>
                  </div>
                </>
              ) : (
                Object.entries(observations.counts || {}).map(([type, count]) => (
                  <div key={type} className="flex justify-between gap-4">
                    <span>{evidenceLabel(type, t)}:</span>
                    <span className="font-medium tabular-nums text-foreground">
                      {count}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {showingFarmLayer && (
            <div className="absolute right-4 top-4 z-[400] max-w-xs rounded-md border border-primary/25 bg-card/95 p-4 shadow-sm backdrop-blur-sm">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-primary">
                <span
                  className="h-2 w-2 rounded-full bg-primary"
                  aria-hidden="true"
                />
                {t("map.farmRiskLayer")}
              </h3>

              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t("map.farmRiskLayerHelp")}
              </p>
            </div>
          )}

          {visibleClusters.length > 0 && (
            <div className="absolute right-4 top-4 z-[400] max-w-xs rounded-md border border-destructive/25 bg-card/95 p-4 shadow-sm backdrop-blur-sm">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-destructive">
                <span
                  className="h-2 w-2 rounded-full bg-destructive"
                  aria-hidden="true"
                />
                {t("map.clustersDetected")}
              </h3>

              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {visibleClusters.length} {t("map.potentialHotspots")}
              </p>
            </div>
          )}

          <MapContainer
            center={[mapCenter.lat, mapCenter.lng]}
            zoom={7}
            scrollWheelZoom
            style={{ height: "100%", width: "100%" }}
          >
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {heatPoints.length > 0 && <HeatLayer points={heatPoints} />}
            <FitMapBounds bounds={mapBounds} />

            {visibleClusters.map((cluster) => (
              <Circle
                key={cluster.cluster_id}
                center={[cluster.latitude, cluster.longitude]}
                radius={Math.max(cluster.radiusMetres || 50, 50)}
                pathOptions={{
                  color: "#DC2626",
                  fillColor: "#DC2626",
                  fillOpacity: 0.16,
                  weight: 2,
                }}
              >
                <Popup>
                  <div className="space-y-1 text-sm">
                    <p className="font-semibold text-destructive">
                      {cluster.cluster_label || t("map.potentialHotspot")}
                    </p>
                    <p>{cluster.subject}</p>
                    <p>
                      {t("map.observationsLabel")}: {cluster.observation_count || 0}
                    </p>
                    <p>{t("map.radiusLabel")}: {formatDistance(cluster.radiusMetres)}</p>
                  </div>
                </Popup>
              </Circle>
            ))}

            {validFeatures.map((feature) => {
              const style = EVIDENCE_STYLES[feature.evidence_type] || EVIDENCE_STYLES.image_screening;

              return (
                <CircleMarker
                  key={`${feature.evidence_type}-${feature.id}`}
                  center={[feature.latitude, feature.longitude]}
                  radius={7}
                  weight={2}
                  color={style.color}
                  fillColor={style.color}
                  fillOpacity={0.7}
                >
                  <Popup>
                    <div className="space-y-1 text-sm">
                      <p className="font-semibold">{feature.label}</p>
                      <p>{evidenceLabel(feature.evidence_type, t)}</p>
                      {feature.detail && <p>{feature.detail}</p>}
                      {feature.farmer_name && (
                        <p>
                          {t("map.farmerLabel")}: {feature.farmer_name}
                        </p>
                      )}
                      {feature.farm_name && (
                        <p>
                          {t("map.farmLabel")}: {feature.farm_name}
                        </p>
                      )}
                      {feature.crop_name && (
                        <p>
                          {t("map.cropLabel")}: {feature.crop_name}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {feature.observed_at
                          ? new Date(feature.observed_at).toLocaleString(i18n.language)
                          : t("map.noRecentActivity")}
                      </p>
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}
          </MapContainer>

          <div className="absolute bottom-4 left-4 z-[400] rounded-md border border-border bg-card/95 p-3 text-xs shadow-sm backdrop-blur-sm">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("map.legend")}
            </p>
            <div className="space-y-1.5">
              {Object.entries(EVIDENCE_STYLES)
                .filter(([type]) => (showingFarmLayer ? type === "farm_risk" : type !== "farm_risk"))
                .map(([type, style]) => (
                  <div key={type} className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: style.color }}
                      aria-hidden="true"
                    />
                    <span className="text-foreground">{evidenceLabel(type, t)}</span>
                  </div>
                ))}
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full border border-destructive bg-destructive/20"
                  aria-hidden="true"
                />
                <span className="text-foreground">
                  {t("map.potentialHotspot")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex min-h-[16rem] items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary"
            aria-hidden="true"
          />
          {t("common.loading")}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
          {t("map.geospatialSurveillance")}
        </p>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          {t("map.title")}
        </h1>

        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground md:text-base">
          {profile?.role === "farmer"
            ? t("map.farmerSubtitle") ||
              "View disease and pest observations on your farms"
            : t("map.extensionSubtitle") ||
              "Monitor disease and pest distribution across your region"}
        </p>
      </div>

      <div className="rounded-md border border-border bg-card p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div>
            <label
              htmlFor="evidence-type"
              className="mb-2 block text-sm font-medium text-foreground"
            >
              {t("map.evidenceType")}
            </label>

            <select
              id="evidence-type"
              value={evidenceFilter}
              onChange={(e) => setEvidenceFilter(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground transition-colors duration-150 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
            >
              <option value={ALL_FIELD_EVIDENCE}>
                {t("map.allEvidence")}
              </option>

              <option value="image_screening">
                {t("map.diseaseOnly")}
              </option>

              <option value="pest_observation">{t("map.pestOnly")}</option>

              <option value="environmental_risk">
                {t("map.environmentalRisk")}
              </option>
            </select>
          </div>

          <div>
            <label
              htmlFor="time-window"
              className="mb-2 block text-sm font-medium text-foreground"
            >
              {t("map.timeWindow")}
            </label>

            <select
              id="time-window"
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value))}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground transition-colors duration-150 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
            >
              <option value="7">{t("map.last7Days")}</option>

              <option value="30">
                {t("map.last30Days")}
              </option>

              <option value="90">
                {t("map.last90Days")}
              </option>
            </select>
          </div>

          {profile?.role === "extension_officer" && (
            <div>
              <label
                htmlFor="farm-select"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                Farmer / Farm
              </label>

              <select
                id="farm-select"
                value={selectedFarmId}
                onChange={(event) => setSelectedFarmId(event.target.value)}
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground transition-colors duration-150 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
              >
                <option value="all">{t("map.allFarmers")}</option>
                {farmOptions.map((farm) => (
                  <option key={farm.id} value={farm.id}>
                    {farm.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-end">
            <button
              type="button"
              onClick={fetchMapData}
              className="h-10 w-full rounded-md bg-primary px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            >
              {t("map.updateMap")}
            </button>
          </div>
        </div>
      </div>

      {renderMap()}

      {clusters && (
        <section className="rounded-md border border-border bg-card p-5 md:p-6">
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("map.spatialIntelligence")}
            </p>

            <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground md:text-xl">
              {t("map.clusterAnalysis")}
            </h2>
          </div>

          {clusters.status === "INSUFFICIENT_DATA" && (
            <div className="rounded-md border border-accent/25 bg-accent/10 p-4">
              <p className="text-sm font-medium text-accent-foreground">
                {showingFarmLayer
                  ? t("map.farmRiskMapShown")
                  : t("map.insufficientData")}
              </p>

              <p className="mt-1 text-sm text-muted-foreground">
                {showingFarmLayer
                  ? t("map.farmRiskFallback")
                  : clusters.explanation || clusters.message}
              </p>
            </div>
          )}

          {clusters.status === "NO_CLUSTER_DETECTED" && (
            <div className="rounded-md border border-primary/25 bg-primary/10 p-4">
              <p className="text-sm font-medium text-primary">
                {t("map.noClusters")}
              </p>

              <p className="mt-1 text-sm text-muted-foreground">
                {clusters.explanation ||
                  t("map.noClustersDetail") ||
                  "Observations are well distributed with no concerning hotspots"}
              </p>
            </div>
          )}

          {clusters.status === "POTENTIAL_CLUSTERS_IDENTIFIED" && (
            <div className="space-y-3">
              <div className="rounded-md border border-destructive/25 bg-destructive/10 p-4">
                <p className="text-sm font-medium text-destructive">
                  {validClusters.length} {t("map.potentialClusters")}
                </p>
              </div>

              {validClusters.map((cluster, idx) => (
                <div
                  key={cluster.cluster_id || idx}
                  className="rounded-md border border-border bg-background/30 p-4 transition-colors duration-150 hover:border-muted-foreground/30"
                >
                  <h3 className="mb-3 text-sm font-semibold text-foreground">
                    {t("map.cluster")} #{idx + 1}: {cluster.subject}
                  </h3>

                  <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                    <div>
                      <span className="text-muted-foreground">
                        {t("map.observations")}:
                      </span>

                      <span className="ml-2 font-medium tabular-nums text-foreground">
                        {cluster.observation_count || 0}
                      </span>
                    </div>

                    <div>
                      <span className="text-muted-foreground">
                        {t("map.radius")}:
                      </span>

                      <span className="ml-2 font-medium tabular-nums text-foreground">
                        {formatDistance(cluster.radiusMetres)}
                      </span>
                    </div>

                    <div>
                      <span className="text-muted-foreground">
                        {t("map.distinctLocations")}:
                      </span>

                      <span className="ml-2 font-medium tabular-nums text-foreground">
                        {cluster.distinct_locations || 0}
                      </span>
                    </div>
                  </div>

                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("map.center")}: {cluster.latitude.toFixed(4)}, {cluster.longitude.toFixed(4)}
                  </p>

                  {cluster.interpretation && (
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {cluster.interpretation}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {observations.farms && observations.farms.length > 0 && (
        <section className="rounded-md border border-border bg-card p-5 md:p-6">
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("map.coverage")}
            </p>

            <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground md:text-xl">
              {t("map.farmsSummary")}
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {observations.farms.map((farm) => (
              <div
                key={farm.farm_id}
                className="rounded-md border border-border bg-background/30 p-4 transition-colors duration-150 hover:border-muted-foreground/30"
              >
                <h3 className="font-semibold text-foreground">
                  {farm.farm_name}
                </h3>

                <p className="mt-1 text-sm text-muted-foreground">
                  {[farm.district, farm.state].filter(Boolean).join(", ") ||
                    t("map.locationUnavailable")}
                </p>

                <div
                  className={`mt-3 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                    farm.has_location
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {farm.has_location
                    ? t("map.mapped")
                    : t("map.noLocation")}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default DiseaseMap;
