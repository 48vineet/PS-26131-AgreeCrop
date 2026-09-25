import { Search } from "lucide-react";
import {
  AlertCircle,
  Bug,
  Calendar,
  Clock,
  Leaf,
  MapPin,
  TrendingUp,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import L from "leaflet";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import Button from "../components/ui/Button";
import DataTable from "../components/ui/DataTable";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import HeatLayer from "../components/ui/HeatLayer";
import LoadingState from "../components/ui/LoadingState";
import Select from "../components/ui/Select";
import PageHeader from "../components/ui/PageHeader";
import SectionHeader from "../components/ui/SectionHeader";
import Stat from "../components/ui/Stat";
import StatusBadge from "../components/ui/StatusBadge";
import { useAuth } from "../contexts/AuthContext";
import api from "../services/api";

const ExtensionDashboard = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [stats, setStats] = useState({
    pending_validations: 0,
    scheduled_visits: 0,
    active_traps: 0,
    farmers_served: 0,
  });

  const [pendingValidations, setPendingValidations] = useState([]);
  const [farmers, setFarmers] = useState([]);
  const [farmSummary, setFarmSummary] = useState({
    farmers: 0,
    farms: 0,
    mapped_farms: 0,
  });
  const [farmersError, setFarmersError] = useState(false);
  const [farmersLoading, setFarmersLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [cropFilter, setCropFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [followUpFilter, setFollowUpFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    loadDashboard();
    loadFarmers();
  }, []);

  const loadDashboard = async () => {
    setLoading(true);
    setError(false);

    try {
      const [validationsRes, pestRes, monitoringRes] = await Promise.all([
        api.get("/validation/observations?status=PENDING&limit=5"),

        api.get("/pest/observations?limit=1").catch(() => ({
          data: {
            total: 0,
            observations: [],
          },
        })),

        api.get("/monitoring?limit=1").catch(() => ({
          data: {
            total_matching: 0,
          },
        })),
      ]);

      setPendingValidations(validationsRes.data.items || []);


      setStats({
        pending_validations: validationsRes.data.total_matching || 0,
        scheduled_visits: monitoringRes.data.total_matching || 0,
        active_traps: pestRes.data.total || 0,
        farmers_served: 0,
      });
    } catch (err) {
      console.error("Dashboard load error:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };


  const loadFarmers = async () => {
    setFarmersLoading(true);
    setFarmersError(false);

    try {
      const response = await api.get("/extension/farmers");
      setFarmers(response.data.items || []);
      setFarmSummary(
        response.data.summary || {
          farmers: response.data.total || 0,
          farms: response.data.total || 0,
          mapped_farms: 0,
        },
      );
      setStats((previous) => ({
        ...previous,
        farmers_served: response.data.total || 0,
      }));
    } catch (loadError) {
      console.error("Farmer directory load error:", loadError);
      setFarmersError(true);
    } finally {
      setFarmersLoading(false);
    }
  };
  const formatDate = (dateString) => {
    if (!dateString) return t("dashboards.extension.recent");

    try {
      return new Date(dateString).toLocaleDateString(i18n.language, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return t("dashboards.extension.recent");
    }
  };

  const extractDiseaseName = (predictedClass) => {
    if (!predictedClass) return t("dashboards.extension.disease");

    if (predictedClass.includes("___")) {
      return predictedClass.split("___")[1].replace(/_/g, " ");
    }

    return predictedClass.replace(/_/g, " ");
  };

  const extractCropName = (predictedClass, contextCrop) => {
    if (contextCrop) return contextCrop;

    if (!predictedClass) return null;

    if (predictedClass.includes("___")) {
      return predictedClass.split("___")[0].replace(/_/g, " ");
    }

    return null;
  };

  const getConfidenceTier = (confidence) => {
    if (!confidence) {
      return {
        status: "pending",
        label: t("dashboards.extension.notRecorded"),
      };
    }

    const pct = Math.round(confidence * 100);
    const label = t("dashboards.extension.confidencePct", { pct });

    if (pct >= 70) {
      return {
        status: "healthy",
        label,
      };
    }

    if (pct >= 40) {
      return {
        status: "warning",
        label,
      };
    }

    return {
      status: "danger",
      label,
    };
  };

  const handleValidate = (observationId) => {
    navigate(`/extension/validation?observation=${observationId}`);
  };

  const getLocationLabel = (location) => {
    if (!location) return t("dashboards.extension.locationNotSet");

    return (
      [location.village, location.district, location.state].filter(Boolean).join(", ") ||
      location.address ||
      (location.latitude && location.longitude
        ? `${Number(location.latitude).toFixed(6)}, ${Number(location.longitude).toFixed(6)}`
        : t("dashboards.extension.locationNotSet"))
    );
  };

  const isValidCoordinate = (location) => {
    const latitude = Number(location?.latitude);
    const longitude = Number(location?.longitude);

    return (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180
    );
  };

  const getRiskIntensity = (farm) => {
    const providedIntensity = Number(farm.health?.risk_intensity);

    if (Number.isFinite(providedIntensity)) {
      return Math.min(Math.max(providedIntensity, 0), 1);
    }

    const intensities = {
      LOW: 0.2,
      MODERATE: 0.5,
      HIGH: 0.8,
      CRITICAL: 1,
    };

    return intensities[farm.health?.risk_level] || 0.2;
  };

  const riskOptions = ["all", ...new Set(
    farmers.map((row) => row.health?.risk_level).filter(Boolean),
  )];

  const cropOptions = ["all", ...new Set(
    farmers
      .flatMap((row) => row.crops?.map((crop) => crop.crop_name) || [])
      .filter(Boolean),
  )];

  const followUpOptions = ["all", "required", "none"];

  const filteredFarmers = farmers.filter((row) => {
    const query = search.trim().toLowerCase();
    const matchesSearch =
      !query ||
      row.farmer_name?.toLowerCase().includes(query) ||
      row.farm_name?.toLowerCase().includes(query);
    const risk = row.health?.risk_level || t("dashboards.extension.notRecorded");
    const matchesRisk = riskFilter === "all" || risk === riskFilter;
    const cropNames = row.crops?.map((crop) => crop.crop_name) || [];
    const matchesCrop =
      cropFilter === "all" || cropNames.includes(cropFilter);
    const requiresFollowUp = row.monitoring?.follow_up || false;
    const matchesFollowUp =
      followUpFilter === "all" ||
      (followUpFilter === "required" ? requiresFollowUp : !requiresFollowUp);

    return matchesSearch && matchesRisk && matchesCrop && matchesFollowUp;
  });

  const mappedFarms = filteredFarmers.filter((farm) =>
    isValidCoordinate(farm.location),
  );

  const heatPoints = mappedFarms.map((farm) => [
    Number(farm.location.latitude),
    Number(farm.location.longitude),
    getRiskIntensity(farm),
  ]);

  const heatBounds = mappedFarms.length
    ? L.latLngBounds(heatPoints.map(([latitude, longitude]) => [latitude, longitude]))
    : null;

  const today = new Date().toLocaleDateString(i18n.language, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const subtitle =
    stats.pending_validations > 0
      ? t("dashboards.extension.screeningsWaiting", {
          count: stats.pending_validations,
          date: today,
        })
      : t("dashboards.extension.allCaughtUpValidations", { date: today });

  function FitMapBounds({ bounds }) {
    const map = useMap();

    useEffect(() => {
      if (!bounds) return;

      if (bounds.getNorth() === bounds.getSouth() && bounds.getEast() === bounds.getWest()) {
        map.setView(bounds.getCenter(), 15);
      } else {
        map.fitBounds(bounds, { padding: [24, 24] });
      }
    }, [map, bounds]);

    return null;
  }

  const farmerColumns = [
    {
      key: "farmer",
      header: t("dashboards.extension.farmerLabel"),
      render: (row) => (
        <div>
          <p className="font-medium text-foreground">{row.farmer_name}</p>
          <p className="text-xs text-muted-foreground">
            {row.phone || t("dashboards.extension.contactNotProvided")}
          </p>
        </div>
      ),
    },
    {
      key: "farm",
      header: t("dashboards.extension.farmLabel"),
      render: (row) => (
        <div>
          <p className="text-foreground">{row.farm_name}</p>
          <p className="text-xs text-muted-foreground">
            {getLocationLabel(row.location)}
          </p>
        </div>
      ),
    },
    {
      key: "crop",
      header: t("dashboards.extension.cropLabel"),
      render: (row) =>
        row.current_crop?.crop_name || t("dashboards.extension.noActiveCrop"),
    },
    {
      key: "risk",
      header: t("dashboards.extension.riskLabel"),
      render: (row) =>
        row.health?.risk_level || t("dashboards.extension.notRecorded"),
    },
    {
      key: "activity",
      header: t("dashboards.extension.lastActivity"),
      render: (row) => formatDate(row.last_activity),
    },
  ];

  const columns = [
    {
      key: "screening",
      header: t("dashboards.extension.screeningLabel"),

      render: (row) => {
        const screening = row.screening || {};
        const context = row.context || {};

        const diseaseName = extractDiseaseName(screening.predicted_class);

        const cropName = extractCropName(
          screening.predicted_class,
          context.crop_name,
        );

        return (
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10">
              <Leaf className="h-4 w-4 text-primary" aria-hidden="true" />
            </div>

            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {diseaseName}
              </p>

              <p
                className={`mt-0.5 text-xs ${
                  !cropName ? "italic text-muted-foreground" : "text-muted-foreground"
                }`}
              >
                {cropName || t("dashboards.extension.cropNotRecorded")}

                {cropName && context.crop_variety
                  ? ` · ${context.crop_variety}`
                  : ""}
              </p>
            </div>
          </div>
        );
      },
    },

    {
      key: "confidence",
      header: t("dashboards.extension.confidenceLabel"),

      render: (row) => {
        const tier = getConfidenceTier(row.screening?.confidence || 0);

        return <StatusBadge status={tier.status}>{tier.label}</StatusBadge>;
      },
    },

    {
      key: "location",
      header: t("dashboards.extension.locationStageLabel"),

      render: (row) => {
        const context = row.context || {};

        return (
          <div className="space-y-1 text-xs text-muted-foreground">
            {context.district ? (
              <div className="flex items-center gap-1.5">
                <MapPin
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />

                <span>{context.district}</span>
              </div>
            ) : (
              <p className="italic text-muted-foreground">
                {t("dashboards.extension.locationNotRecorded")}
              </p>
            )}

            {context.crop_stage && (
              <p>
                {t("dashboards.extension.growthStage")}{" "}
                <span className="text-foreground">{context.crop_stage}</span>
              </p>
            )}
          </div>
        );
      },
    },

    {
      key: "screened_at",
      header: t("dashboards.extension.screenedLabel"),

      render: (row) => (
        <div className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />

          {formatDate(row.screening?.screened_at)}
        </div>
      ),
    },

    {
      key: "action",
      header: "",
      align: "right",

      render: (row) => (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => handleValidate(row.observation_id)}
        >
          {t("dashboards.extension.review")}
        </Button>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <LoadingState variant="page" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <ErrorState
          title={t("dashboards.extension.dashboardLoadTitle")}
          description={t("dashboards.extension.dashboardLoadDesc")}
          onRetry={loadFarmers}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {/* Header */}
      <PageHeader
        title={`${t("dashboard.welcome")}, ${
          profile?.name || t("dashboards.extension.extensionOfficer")
        }`}
        subtitle={subtitle}
      />

      {/* Operational Summary */}
      <section>
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("dashboards.extension.fieldOperations")}
          </p>

          <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
            {t("dashboards.extension.todaysWorkload")}
          </h2>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat
            label={t("dashboard.pendingValidations")}
            value={stats.pending_validations}
            icon={AlertCircle}
            accent="primary"
          />

          <Stat
            label={t("dashboards.extension.scheduledVisits")}
            value={stats.scheduled_visits}
            icon={Calendar}
            accent="neutral"
          />

          <Stat
            label={t("dashboards.extension.activePestTraps")}
            value={stats.active_traps}
            icon={Bug}
            accent="accent"
          />

          <Stat
            label={t("dashboards.extension.farmersServed")}
            value={stats.farmers_served}
            icon={Users}
            accent="neutral"
          />
        </div>
      </section>

      {/* Farmers & Farms */}
      <section>
        <SectionHeader
          title={t("dashboards.extension.farmersAndFarms")}
          subtitle={t("dashboards.extension.authorizedFarmers")}
        />

        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative flex-1">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("dashboards.extension.searchFarmers")}
              aria-label={t("dashboards.extension.searchFarmers")}
              className="h-10 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm text-foreground transition-colors placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Select
              label={t("dashboards.extension.cropLabel")}
              value={cropFilter}
              onChange={(event) => setCropFilter(event.target.value)}
            >
              {cropOptions.map((crop) => (
                <option key={crop} value={crop}>
                  {crop === "all" ? t("dashboards.extension.allCrops") : crop}
                </option>
              ))}
            </Select>

            <Select
              label={t("dashboards.extension.riskLabel")}
              value={riskFilter}
              onChange={(event) => setRiskFilter(event.target.value)}
            >
              {riskOptions.map((risk) => (
                <option key={risk} value={risk}>
                  {risk === "all" ? t("dashboards.extension.allRisks") : risk}
                </option>
              ))}
            </Select>

            <Select
              label={t("dashboards.extension.followUpLabel")}
              value={followUpFilter}
              onChange={(event) => setFollowUpFilter(event.target.value)}
            >
              {followUpOptions.map((option) => (
                <option key={option} value={option}>
                  {option === "all"
                    ? t("dashboards.extension.allFollowUps")
                    : option === "required"
                      ? t("dashboards.extension.followUpRequired")
                      : t("dashboards.extension.noFollowUpRequired")}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {farmersError ? (
          <div className="rounded-md border border-border bg-card">
            <ErrorState
              title={t("dashboards.extension.unableLoadFarmersTitle")}
              description={t("dashboards.extension.unableLoadFarmersDesc")}
              onRetry={loadFarmers}
            />
          </div>
        ) : (
          <DataTable
            loading={farmersLoading}
            columns={farmerColumns}
            data={farmersLoading ? [] : filteredFarmers}
            keyField="farm_id"
            onRowClick={(row) => navigate(`/extension/farmers/${row.farm_id}`)}
            emptyState={
              <EmptyState
                icon={Users}
                title={t("dashboards.extension.noFarmersTitle")}
                description={t("dashboards.extension.noFarmersDesc")}
              />
            }
          />
        )}
      </section>

      {!farmersLoading && !farmersError && (
        <section>
          <SectionHeader
            title={t("dashboards.extension.heatmapTitle")}
            subtitle={t("dashboards.extension.heatmapSubtitle")}
          />

          <p className="mb-4 text-sm text-muted-foreground">
            {t("dashboards.extension.farmSummary", {
              farmers: farmSummary.farmers,
              farms: farmSummary.farms,
              mapped: farmSummary.mapped_farms,
            })}
          </p>

          {mappedFarms.length ? (
            <div className="h-[520px] overflow-hidden rounded-md border border-border">
              <MapContainer
                center={[
                  Number(mappedFarms[0].location.latitude),
                  Number(mappedFarms[0].location.longitude),
                ]}
                zoom={6}
                style={{ height: "100%", width: "100%" }}
                scrollWheelZoom
              >
                <TileLayer
                  attribution="OpenStreetMap"
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <HeatLayer points={heatPoints} />
                <FitMapBounds bounds={heatBounds} />
                {mappedFarms.map((farm) => (
                  <CircleMarker
                    key={farm.farm_id}
                    center={[
                      Number(farm.location.latitude),
                      Number(farm.location.longitude),
                    ]}
                    radius={8}
                    weight={2}
                    color="#1D9F76"
                    fillColor="#1D9F76"
                    fillOpacity={0.65}
                  >
                    <Popup>
                      <div className="agrecrop-map-popup">
                        <p className="font-semibold">{farm.farmer_name}</p>
                        <p>{farm.farm_name}</p>
                        <p>
                          {t("dashboards.extension.cropLabel")}:{" "}
                          {farm.current_crop?.crop_name ||
                            t("dashboards.extension.noActiveCrop")}
                        </p>
                        <p>
                          {t("dashboards.extension.riskLabel")}:{" "}
                          {farm.health?.risk_level ||
                            t("dashboards.extension.notRecorded")}
                        </p>
                        <p>
                          {t("dashboards.extension.latestStatus")}:{" "}
                          {farm.health?.latest_status ||
                            t("dashboards.extension.notRecorded")}
                        </p>
                        <button
                          type="button"
                          onClick={() => navigate(`/extension/farmers/${farm.farm_id}`)}
                        >
                          {t("dashboards.extension.viewFarmer")}
                        </button>
                      </div>
                    </Popup>
                  </CircleMarker>
                ))}
              </MapContainer>
            </div>
          ) : (
            <div className="rounded-md border border-border bg-card">
              <EmptyState
                icon={MapPin}
                title={t("dashboards.extension.noFarmLocationsTitle")}
                description={t("dashboards.extension.noFarmLocationsDesc")}
              />
            </div>
          )}
        </section>
      )}

      {/* Pending Validations */}
      <section>
        <SectionHeader
          title={t("dashboard.pendingValidations")}
          subtitle={t("dashboards.extension.pendingValidationsSubtitle")}
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/extension/validation")}
            >
              {t("dashboards.extension.seeAllValidations")}
            </Button>
          }
        />

        <DataTable
          columns={columns}
          data={pendingValidations}
          keyField="observation_id"
          emptyState={
            <EmptyState
              icon={Leaf}
              title={t("dashboards.extension.caughtUpTitle")}
              description={t("dashboards.extension.caughtUpDesc")}
            />
          }
        />
      </section>

      {/* Quick Actions */}
      <section>
        <SectionHeader
          title={t("dashboard.quickActions")}
          subtitle={t("dashboards.extension.quickActionsSub")}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* Pest Monitoring */}
          <button
            type="button"
            onClick={() => navigate("/extension/pest-monitoring")}
            className="group flex items-center gap-3 rounded-md border border-border bg-card p-4 text-left transition-colors duration-150 hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10">
              <Bug className="h-4 w-4 text-primary" aria-hidden="true" />
            </div>

            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {t("dashboards.extension.logPestTrap")}
              </p>

              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("dashboards.extension.recordTrapCounts")}
              </p>
            </div>
          </button>

          {/* Monitoring */}
          <button
            type="button"
            onClick={() => navigate("/extension/monitoring")}
            className="group flex items-center gap-3 rounded-md border border-border bg-card p-4 text-left transition-colors duration-150 hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10">
              <TrendingUp className="h-4 w-4 text-primary" aria-hidden="true" />
            </div>

            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {t("dashboards.extension.trackProgress")}
              </p>

              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("dashboards.extension.monitorFollowUps")}
              </p>
            </div>
          </button>

          {/* Map */}
          <button
            type="button"
            onClick={() => navigate("/extension/map")}
            className="group flex items-center gap-3 rounded-md border border-border bg-card p-4 text-left transition-colors duration-150 hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10">
              <MapPin className="h-4 w-4 text-primary" aria-hidden="true" />
            </div>

            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {t("dashboards.extension.hotspotMap")}
              </p>

              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("dashboards.extension.trackDiseaseSpread")}
              </p>
            </div>
          </button>
        </div>
      </section>
    </div>
  );
};

export default ExtensionDashboard;
