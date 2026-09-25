import { formatDistanceToNowStrict } from "date-fns";
import {
  Bell,
  Bug,
  Camera,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Leaf,
  MapPin,
  Plus,
  Send,
  Sprout,
  Sun,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import LoadingState from "../components/ui/LoadingState";
import PageHeader from "../components/ui/PageHeader";
import SectionHeader from "../components/ui/SectionHeader";
import Skeleton from "../components/ui/Skeleton";
import StatusBadge from "../components/ui/StatusBadge";

import { useAuth } from "../contexts/AuthContext";
import api from "../services/api";

/* ============================================================
   CONSTANTS
   ============================================================ */

const VISIBLE_FARM_LIMIT = 6;
const FETCH_CROPS_FOR_FIRST_N = 3;

const SCREENING_STATUS_BADGE = {
  PENDING: {
    status: "pending",
    labelKey: "dashboards.farmer.statusAwaitingReview",
  },

  VALIDATED: {
    status: "neutral",
    labelKey: "dashboards.farmer.statusReviewed",
  },

  REJECTED: {
    status: "healthy",
    labelKey: "dashboards.farmer.statusNoCondition",
  },

  NEEDS_REVIEW: {
    status: "warning",
    labelKey: "dashboards.farmer.statusNeedsEvidence",
  },
};

const NOTIFICATION_ICON = {
  high_risk: TriangleAlert,
  pest_observation: Bug,
  followup_due: Clock,
  referral_update: Send,
  validation_pending: ClipboardCheck,
};

const NOTIFICATION_ROUTE = {
  high_risk: "/farmer/weather",
  pest_observation: "/farmer/pest-monitoring",
  followup_due: "/farmer/monitoring",
  referral_update: "/farmer/monitoring",
  validation_pending: "/farmer/screening",
};

/* ============================================================
   HELPERS
   ============================================================ */

function getGreeting(t) {
  const hour = new Date().getHours();

  if (hour < 12) return t("dashboards.farmer.goodMorning");
  if (hour < 17) return t("dashboards.farmer.goodAfternoon");

  return t("dashboards.farmer.goodEvening");
}

function relativeTime(iso) {
  if (!iso) return "";

  try {
    return formatDistanceToNowStrict(new Date(iso), {
      addSuffix: true,
    });
  } catch {
    return "";
  }
}

function formatArea(farm, t) {
  if (farm.area === null || farm.area === undefined || farm.area === "") {
    return t("dashboards.farmer.areaNotSet");
  }

  return `${farm.area} ${farm.area_unit || ""}`.trim();
}

function formatDiseaseLabel(predictedClass, t) {
  if (!predictedClass) {
    return t("dashboards.farmer.resultUnavailable");
  }

  const part = predictedClass.includes("___")
    ? predictedClass.split("___")[1]
    : predictedClass;

  const cleaned = part.replace(/_/g, " ").replace(/\s+/g, " ").trim();

  if (/^healthy$/i.test(cleaned)) {
    return t("dashboards.farmer.noDiseaseDetected");
  }

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function weatherCondition(code, t) {
  if (code === 0 || code === 1) {
    return {
      label: t("dashboards.farmer.conditionClear"),
      icon: Sun,
    };
  }

  if (code === 2 || code === 3) {
    return {
      label: t("dashboards.farmer.conditionCloudy"),
      icon: Cloud,
    };
  }

  if (code === 45 || code === 48) {
    return {
      label: t("dashboards.farmer.conditionFoggy"),
      icon: CloudFog,
    };
  }

  if (code >= 51 && code <= 67) {
    return {
      label: t("dashboards.farmer.conditionRainy"),
      icon: CloudRain,
    };
  }

  if (code >= 71 && code <= 77) {
    return {
      label: t("dashboards.farmer.conditionSnowy"),
      icon: CloudSnow,
    };
  }

  if (code >= 80 && code <= 82) {
    return {
      label: t("dashboards.farmer.conditionShowers"),
      icon: CloudRain,
    };
  }

  if (code >= 85 && code <= 86) {
    return {
      label: t("dashboards.farmer.conditionSnowShowers"),
      icon: CloudSnow,
    };
  }

  if (typeof code === "number" && code >= 95) {
    return {
      label: t("dashboards.farmer.conditionThunderstorms"),
      icon: CloudLightning,
    };
  }

  return {
    label: t("dashboards.farmer.conditionCloudy"),
    icon: Cloud,
  };
}

/* ============================================================
   FARMER DASHBOARD
   ============================================================ */

const FarmerDashboard = () => {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const navigate = useNavigate();

  /* ==========================================================
     STATE
     ========================================================== */

  const [farms, setFarms] = useState({
    status: "loading",
    data: [],
  });

  const [weather, setWeather] = useState({
    status: "idle",
    data: null,
  });

  const [screenings, setScreenings] = useState({
    status: "loading",
    data: null,
  });

  const [monitoring, setMonitoring] = useState({
    status: "loading",
    data: null,
  });

  const [notifications, setNotifications] = useState({
    status: "loading",
    data: null,
  });

  const [cropsByFarm, setCropsByFarm] = useState({});

  /* ==========================================================
     LOAD FARMS
     ========================================================== */

  const loadFarms = useCallback(async () => {
    setFarms((s) => ({
      ...s,
      status: "loading",
    }));

    try {
      const res = await api.get("/profile/farms");

      setFarms({
        status: "ready",
        data: res.data || [],
      });
    } catch (error) {
      console.error("Failed to load farms:", error);

      setFarms({
        status: "error",
        data: [],
      });
    }
  }, []);

  /* ==========================================================
     LOAD SCREENINGS
     ========================================================== */

  const loadScreenings = useCallback(async () => {
    setScreenings((s) => ({
      ...s,
      status: "loading",
    }));

    try {
      const res = await api.get("/screenings", {
        params: {
          limit: 5,
        },
      });

      setScreenings({
        status: "ready",
        data: res.data,
      });
    } catch (error) {
      console.error("Failed to load screenings:", error);

      setScreenings({
        status: "error",
        data: null,
      });
    }
  }, []);

  /* ==========================================================
     LOAD MONITORING
     ========================================================== */

  const loadMonitoring = useCallback(async () => {
    setMonitoring((s) => ({
      ...s,
      status: "loading",
    }));

    try {
      const res = await api.get("/monitoring", {
        params: {
          limit: 5,
          status: "FOLLOW_UP_DUE",
        },
      });

      setMonitoring({
        status: "ready",
        data: res.data,
      });
    } catch (error) {
      console.error("Failed to load monitoring:", error);

      setMonitoring({
        status: "error",
        data: null,
      });
    }
  }, []);

  /* ==========================================================
     LOAD NOTIFICATIONS
     ========================================================== */

  const loadNotifications = useCallback(async () => {
    setNotifications((s) => ({
      ...s,
      status: "loading",
    }));

    try {
      const res = await api.get("/notifications");

      setNotifications({
        status: "ready",
        data: res.data,
      });
    } catch (error) {
      console.error("Failed to load notifications:", error);

      setNotifications({
        status: "error",
        data: null,
      });
    }
  }, []);

  /* ==========================================================
     LOAD WEATHER
     ========================================================== */

  const loadWeather = useCallback(async (farmId) => {
    setWeather({
      status: "loading",
      data: null,
    });

    try {
      const res = await api.get(`/weather/farms/${farmId}/current`);

      setWeather({
        status: "ready",
        data: res.data,
      });
    } catch (err) {
      const code = err?.response?.status;

      if (code === 422) {
        setWeather({
          status: "no-location",
          data: null,
        });
      } else if (code === 404) {
        setWeather({
          status: "not-found",
          data: null,
        });
      } else {
        setWeather({
          status: "error",
          data: null,
        });
      }
    }
  }, []);

  /* ==========================================================
     LOAD CROPS
     ========================================================== */

  const loadCropsForFarm = useCallback(async (farmId) => {
    setCropsByFarm((s) => ({
      ...s,
      [farmId]: {
        status: "loading",
        data: [],
      },
    }));

    try {
      const res = await api.get(`/profile/farms/${farmId}/crops`);

      setCropsByFarm((s) => ({
        ...s,
        [farmId]: {
          status: "ready",
          data: res.data || [],
        },
      }));
    } catch (error) {
      console.error("Failed to load crops:", error);

      setCropsByFarm((s) => ({
        ...s,
        [farmId]: {
          status: "error",
          data: [],
        },
      }));
    }
  }, []);

  /* ==========================================================
     INITIAL LOAD
     ========================================================== */

  useEffect(() => {
    loadFarms();
    loadScreenings();
    loadMonitoring();
    loadNotifications();
  }, [loadFarms, loadScreenings, loadMonitoring, loadNotifications]);

  /* ==========================================================
     FARM DEPENDENT LOADS
     ========================================================== */

  useEffect(() => {
    if (farms.status !== "ready") {
      return;
    }

    if (farms.data.length === 0) {
      setWeather({
        status: "none",
        data: null,
      });

      return;
    }

    loadWeather(farms.data[0].id);

    farms.data.slice(0, FETCH_CROPS_FOR_FIRST_N).forEach((farm) => {
      loadCropsForFarm(farm.id);
    });

    // Only re-run when the farms list itself
    // finishes loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farms.status]);

  /* ==========================================================
     DERIVED VALUES
     ========================================================== */

  const primaryFarm = farms.data[0];

  const firstName = profile?.name || t("dashboards.farmer.greetingThere");

  const dueCount = monitoring.data?.total_matching ?? 0;

  const cropsForFarm = (farm) => {
    const fetched = cropsByFarm[farm.id];

    if (fetched && fetched.status === "ready") {
      return fetched.data;
    }

    return farm.crops || [];
  };

  /* ==========================================================
     WEATHER
     ========================================================== */

  const renderWeather = () => {
    if (farms.status === "loading") {
      return (
        <div className="space-y-3">
          <Skeleton className="h-3 w-28" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-11 w-11 rounded-md" />

            <div className="space-y-2">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2">
            <Skeleton className="h-16 rounded-md" />
            <Skeleton className="h-16 rounded-md" />
            <Skeleton className="h-16 rounded-md" />
          </div>
        </div>
      );
    }

    if (farms.status === "error") {
      return (
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("dashboards.farmer.weatherUnavailableFarms")}
        </p>
      );
    }

    if (farms.data.length === 0) {
      return (
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("dashboards.farmer.weatherNoFarmPrompt")}
        </p>
      );
    }

    if (weather.status === "loading" || weather.status === "idle") {
      return (
        <div className="space-y-3">
          <Skeleton className="h-3 w-28" />

          <div className="flex items-center gap-3">
            <Skeleton className="h-11 w-11 rounded-md" />

            <div className="space-y-2">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2">
            <Skeleton className="h-16 rounded-md" />
            <Skeleton className="h-16 rounded-md" />
            <Skeleton className="h-16 rounded-md" />
          </div>
        </div>
      );
    }

    if (weather.status === "no-location") {
      return (
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent/15">
            <MapPin
              className="h-4 w-4 text-accent-foreground"
              aria-hidden="true"
            />
          </div>

          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {t("dashboards.farmer.locationNeeded")}
            </p>

            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {t("dashboards.farmer.addLocationForFarm", {
                farm: primaryFarm.farm_name,
              })}
            </p>

            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              onClick={() => navigate(`/farmer/farms/${primaryFarm.id}`)}
            >
              {t("dashboards.farmer.addLocation")}
            </Button>
          </div>
        </div>
      );
    }

    if (weather.status === "error" || weather.status === "not-found") {
      return (
        <ErrorState
          title={t("dashboards.farmer.weatherLoadFailed")}
          description={t("common.tryAgain")}
          onRetry={() => loadWeather(primaryFarm.id)}
          className="py-4"
        />
      );
    }

    if (weather.status === "ready" && weather.data) {
      const current = weather.data.current || {};

      const condition = weatherCondition(current.weather_code, t);

      const ConditionIcon = condition.icon;

      return (
        <div>
          {/* Weather heading */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("dashboards.farmer.currentWeather")}
              </p>

              <div className="mt-3 flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-accent/15">
                  <ConditionIcon
                    className="h-6 w-6 text-accent-foreground"
                    aria-hidden="true"
                  />
                </div>

                <div>
                  <p className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">
                    {current.temperature_2m != null
                      ? `${Math.round(current.temperature_2m)}°C`
                      : "—"}
                  </p>

                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {condition.label}
                  </p>
                </div>
              </div>
            </div>

            <div className="hidden text-right sm:block">
              <p className="text-xs text-muted-foreground">
                {t("common.location")}
              </p>

              <p className="mt-1 max-w-[140px] truncate text-sm font-medium text-foreground">
                {primaryFarm.farm_name}
              </p>
            </div>
          </div>

          {/* Weather metrics */}
          <div className="mt-6 grid grid-cols-3 gap-2">
            <div className="rounded-md border border-border bg-card px-3 py-3">
              <p className="text-xs text-muted-foreground">
                {t("dashboard.humidity")}
              </p>

              <p className="mt-1 text-sm font-semibold text-foreground tabular-nums">
                {current.relative_humidity_2m != null
                  ? `${Math.round(current.relative_humidity_2m)}%`
                  : "—"}
              </p>
            </div>

            <div className="rounded-md border border-border bg-card px-3 py-3">
              <p className="text-xs text-muted-foreground">
                {t("dashboards.farmer.wind")}
              </p>

              <p className="mt-1 text-sm font-semibold text-foreground tabular-nums">
                {current.wind_speed_10m != null
                  ? `${Math.round(current.wind_speed_10m)} km/h`
                  : "—"}
              </p>
            </div>

            <div className="rounded-md border border-border bg-card px-3 py-3">
              <p className="text-xs text-muted-foreground">
                {t("dashboards.farmer.rain")}
              </p>

              <p className="mt-1 text-sm font-semibold text-foreground tabular-nums">
                {current.precipitation != null
                  ? `${current.precipitation} mm`
                  : "—"}
              </p>
            </div>
          </div>

          {/* Forecast link */}
          <div className="mt-5 flex items-center justify-between gap-4 border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">
              {t("dashboards.farmer.updatedAt", {
                time: current.time
                  ? relativeTime(current.time)
                  : t("dashboards.farmer.recently"),
              })}
            </p>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/farmer/weather")}
            >
              {t("dashboards.farmer.fullForecast")}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      );
    }

    return null;
  };

  /* ==========================================================
     FARMS
     ========================================================== */

  const renderFarms = () => {
    if (farms.status === "loading") {
      return (
        <Card className="overflow-hidden">
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4">
              <Skeleton className="h-11 w-11 rounded-md" />
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-6 w-40 rounded-full" />
            </div>

            <div className="border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="mt-4 h-10 w-24" />
              <Skeleton className="mt-2 h-4 w-32" />

              <div className="mt-5 grid grid-cols-3 gap-2">
                <Skeleton className="h-16 rounded-md" />
                <Skeleton className="h-16 rounded-md" />
                <Skeleton className="h-16 rounded-md" />
              </div>
            </div>
          </div>
        </Card>
      );
    }

    if (farms.status === "error") {
      return (
        <ErrorState
          title={t("dashboards.farmer.farmsLoadFailed")}
          description={t("common.tryAgain")}
          onRetry={loadFarms}
        />
      );
    }

    if (farms.data.length === 0) {
      return (
        <Card>
          <EmptyState
            icon={Sprout}
            title={t("dashboards.farmer.addFirstFarmTitle")}
            description={t("dashboards.farmer.addFirstFarmDesc")}
            action={
              <Button icon={Plus} onClick={() => navigate("/farmer/farms")}>
                {t("dashboards.farmer.addFarm")}
              </Button>
            }
          />
        </Card>
      );
    }

    const visible = farms.data.slice(0, VISIBLE_FARM_LIMIT);

    const primaryCrops = cropsForFarm(primaryFarm);

    return (
      <div className="space-y-4">
        {/* ====================================================
            PRIMARY FARM OVERVIEW
        ===================================================== */}

        <Card className="overflow-hidden p-0">
          <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
            {/* Farm identity */}
            <button
              type="button"
              onClick={() => navigate(`/farmer/farms/${primaryFarm.id}`)}
              className="group p-5 text-left transition-colors hover:bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset sm:p-6"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary/10">
                    <Leaf className="h-5 w-5 text-primary" aria-hidden="true" />
                  </div>

                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {t("dashboards.farmer.primaryFarm")}
                    </p>

                    <h2 className="mt-1 truncate text-xl font-semibold tracking-tight text-foreground">
                      {primaryFarm.farm_name}
                    </h2>
                  </div>
                </div>

                <ChevronRight
                  className="mt-2 h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </div>

              {/* Farm stats */}
              <div className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-5">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {t("dashboards.farmer.farmArea")}
                  </p>

                  <p className="mt-1 text-sm font-semibold text-foreground">
                    {formatArea(primaryFarm, t)}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground">
                    {t("dashboards.farmer.crops")}
                  </p>

                  <p className="mt-1 text-sm font-semibold text-foreground">
                    {primaryCrops.length || 0}
                  </p>
                </div>
              </div>

              {/* Crop badges */}
              <div className="mt-5 flex flex-wrap gap-1.5">
                {primaryCrops.length > 0 ? (
                  primaryCrops.slice(0, 5).map((crop) => (
                    <Badge key={crop.id} variant="primary">
                      {crop.crop_name}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {t("dashboards.farmer.noCropsAdded")}
                  </span>
                )}

                {primaryCrops.length > 5 && (
                  <Badge variant="neutral">+{primaryCrops.length - 5}</Badge>
                )}
              </div>

              <p className="mt-5 text-xs font-medium text-primary">
                {t("dashboards.farmer.viewFarmDetails")} →
              </p>
            </button>

            {/* Weather */}
            <div className="border-t border-border bg-background/35 p-5 sm:p-6 lg:border-l lg:border-t-0">
              {renderWeather()}
            </div>
          </div>
        </Card>

        {/* ====================================================
            OTHER FARMS
        ===================================================== */}

        {visible.length > 1 && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("dashboards.farmer.otherFarms")}
              </p>

              {farms.data.length > VISIBLE_FARM_LIMIT && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate("/farmer/farms")}
                >
                  {t("dashboards.farmer.seeAllCount", {
                    count: farms.data.length,
                  })}
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visible.slice(1).map((farm) => {
                const crops = cropsForFarm(farm);

                return (
                  <button
                    key={farm.id}
                    type="button"
                    onClick={() => navigate(`/farmer/farms/${farm.id}`)}
                    className="group rounded-md border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-background/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
                          <Leaf
                            className="h-4 w-4 text-primary"
                            aria-hidden="true"
                          />
                        </div>

                        <p className="truncate text-sm font-semibold text-foreground">
                          {farm.farm_name}
                        </p>
                      </div>

                      <ChevronRight
                        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </div>

                    <p className="mt-3 text-sm text-muted-foreground">
                      {formatArea(farm, t)}
                    </p>

                    {crops.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {crops.slice(0, 3).map((crop) => (
                          <Badge key={crop.id} variant="primary">
                            {crop.crop_name}
                          </Badge>
                        ))}

                        {crops.length > 3 && (
                          <Badge variant="neutral">+{crops.length - 3}</Badge>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  /* ==========================================================
     SCREENINGS
     ========================================================== */

  const renderScreenings = () => {
    if (screenings.status === "loading") {
      return <LoadingState variant="list" rows={3} />;
    }

    if (screenings.status === "error") {
      return (
        <ErrorState
          title={t("dashboards.farmer.screeningsLoadFailed")}
          description={t("common.tryAgain")}
          onRetry={loadScreenings}
        />
      );
    }

    const items = screenings.data?.items || [];

    if (items.length === 0) {
      return (
        <Card>
          <EmptyState
            icon={Camera}
            title={t("dashboards.farmer.noScreeningsTitle")}
            description={t("dashboards.farmer.noScreeningsDesc")}
            action={
              <Button
                icon={Camera}
                onClick={() => navigate("/farmer/screening")}
              >
                {t("dashboards.farmer.screenACrop")}
              </Button>
            }
          />
        </Card>
      );
    }

    return (
      <Card padding="p-0">
        <ul className="divide-y divide-border">
          {items.map((item) => {
            const badge =
              SCREENING_STATUS_BADGE[item.validation?.status] ||
              SCREENING_STATUS_BADGE.PENDING;

            // Backend stores confidence as a
            // 0-100 value. Only clamp display range.
            const pct =
              item.validation?.status === "VALIDATED" && typeof item.confidence === "number"
                ? Math.round(Math.min(100, Math.max(0, item.confidence)))
                : null;

            return (
              <li
                key={item.observation_id}
                className="flex items-start justify-between gap-4 p-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {item.validation?.status === "VALIDATED" && item.validation?.validated_class
                      ? formatDiseaseLabel(item.validation.validated_class, t)
                      : t("dashboards.farmer.pendingCondition")}
                  </p>

                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {[item.crop_name, item.farm_name]
                      .filter(Boolean)
                      .join(" · ") || t("dashboards.farmer.noFarmLinked")}
                  </p>

                  {pct !== null && (
                    <div className="mt-2 flex max-w-[180px] items-center gap-2">
                      <div
                        className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={t("dashboards.farmer.screeningConfidence", {
                          pct,
                        })}
                      >
                        <div
                          className="h-full rounded-full bg-primary transition-[width] duration-300"
                          style={{
                            width: `${pct}%`,
                          }}
                        />
                      </div>

                      <span className="text-xs text-muted-foreground tabular-nums">
                        {pct}%
                      </span>
                    </div>
                  )}
                </div>

                <div className="shrink-0 text-right">
                  <StatusBadge status={badge.status}>
                    {t(badge.labelKey)}
                  </StatusBadge>

                  <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
                    {relativeTime(item.screened_at)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    );
  };

  /* ==========================================================
     MONITORING
     ========================================================== */

  const renderMonitoring = () => {
    if (monitoring.status === "loading") {
      return <LoadingState variant="list" rows={2} />;
    }

    if (monitoring.status === "error") {
      return (
        <ErrorState
          title={t("dashboards.farmer.monitoringLoadFailed")}
          description={t("common.tryAgain")}
          onRetry={loadMonitoring}
        />
      );
    }

    const items = monitoring.data?.items || [];

    if (items.length === 0) {
      return (
        <Card className="min-h-0">
          <EmptyState
            icon={CheckCircle2}
            title={t("dashboards.farmer.nothingFollowUp")}
            description={t("dashboards.farmer.nothingFollowUpDesc")}
          />
        </Card>
      );
    }

    return (
      <Card padding="p-0">
        <ul className="divide-y divide-border">
          {items.map((c) => (
            <li
              key={c.id}
              className="flex items-start justify-between gap-4 p-4"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {c.summary ||
                    t("dashboards.farmer.caseOn", {
                      date:
                        c.crop_name ||
                        c.farm_name ||
                        t("dashboards.farmer.aFarm"),
                    })}
                </p>

                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {[c.crop_name, c.farm_name].filter(Boolean).join(" · ")}
                </p>

                {c.due_at && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("dashboards.farmer.dueOn", {
                      date: relativeTime(c.due_at),
                    })}
                  </p>
                )}
              </div>

              <div className="shrink-0 text-right">
                <StatusBadge status="warning">
                  {t("dashboards.farmer.followUpDue")}
                </StatusBadge>

                <div className="mt-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => navigate("/farmer/monitoring")}
                  >
                    {t("dashboards.farmer.addFollowUp")}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    );
  };

  /* ==========================================================
     NOTIFICATIONS
     ========================================================== */

  const renderNotifications = () => {
    if (notifications.status === "loading") {
      return <LoadingState variant="list" rows={3} />;
    }

    if (notifications.status === "error") {
      return (
        <ErrorState
          title={t("dashboards.farmer.notificationsLoadFailed")}
          description={t("common.tryAgain")}
          onRetry={loadNotifications}
        />
      );
    }

    const items = notifications.data?.notifications || [];

    if (items.length === 0) {
      return (
        <Card>
          <EmptyState
            icon={Bell}
            title={t("dashboards.farmer.noNotifications")}
            description={t("dashboards.farmer.noNotificationsDesc")}
          />
        </Card>
      );
    }

    return (
      <Card padding="p-0">
        <ul className="divide-y divide-border">
          {items.slice(0, 6).map((n, idx) => {
            const Icon = NOTIFICATION_ICON[n.kind] || Bell;

            const route = NOTIFICATION_ROUTE[n.kind];

            const rowContent = (
              <>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Icon
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">
                      {n.title}
                    </p>

                    {!n.read && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                        aria-label={t("dashboards.farmer.unread")}
                      />
                    )}
                  </div>

                  {n.body && (
                    <p className="mt-0.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                      {n.body}
                    </p>
                  )}

                  <p className="mt-1 text-xs text-muted-foreground">
                    {relativeTime(n.occurred_at)}
                  </p>
                </div>
              </>
            );

            return (
              <li key={`${n.kind}-${n.occurred_at}-${idx}`}>
                {route ? (
                  <button
                    type="button"
                    onClick={() => navigate(route)}
                    className="flex w-full items-start gap-3 p-4 text-left transition-colors duration-150 hover:bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                  >
                    {rowContent}
                  </button>
                ) : (
                  <div className="flex items-start gap-3 p-4">{rowContent}</div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    );
  };

  /* ==========================================================
     PAGE
     ========================================================== */

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6 lg:space-y-10 lg:px-8 lg:py-8">
      {/* ====================================================
          HEADER
      ===================================================== */}

      <PageHeader
        title={`${getGreeting(t)}, ${firstName}`}
        subtitle={t("dashboards.farmer.subtitle")}
      />

      {/* ====================================================
          FARM OVERVIEW
      ===================================================== */}

      <section aria-label={t("dashboards.farmer.farmsLabel")}>
        <SectionHeader
          title={
            farms.data.length === 1
              ? t("dashboards.farmer.farmLabel")
              : t("dashboards.farmer.farmsCount", {
                  count: farms.data.length,
                })
          }
          action={
            <Button
              variant="secondary"
              size="sm"
              icon={Plus}
              onClick={() => navigate("/farmer/farms")}
            >
              {t("dashboards.farmer.addFarm")}
            </Button>
          }
        />

        {renderFarms()}
      </section>

      {/* ====================================================
          SCREENINGS + ATTENTION
      ===================================================== */}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section aria-label={t("dashboards.farmer.recentScreeningsLabel")}>
          <SectionHeader
            title={t("dashboards.farmer.recentScreeningsLabel")}
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/farmer/screening")}
              >
                {t("dashboards.farmer.seeAllScreenings")}
              </Button>
            }
          />

          {renderScreenings()}
        </section>

        <section aria-label={t("dashboards.farmer.needsAttentionLabel")}>
          <SectionHeader
            title={t("dashboards.farmer.needsAttentionLabel")}
            subtitle={
              dueCount > 0
                ? t("dashboards.farmer.casesDue", { count: dueCount })
                : undefined
            }
          />

          {renderMonitoring()}
        </section>
      </div>

      {/* ====================================================
          NOTIFICATIONS
      ===================================================== */}

      <section aria-label={t("dashboards.farmer.notificationsLabel")}>
        <SectionHeader title={t("dashboards.farmer.notificationsLabel")} />

        {renderNotifications()}
      </section>
    </div>
  );
};

export default FarmerDashboard;
