import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bug,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Database,
  Eye,
  FileText,
  Filter,
  Flame,
  Layers,
  Leaf,
  LocateFixed,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sprout,
  TrendingUp,
  User,
  X,
} from "lucide-react";

import api from "../services/api";

// Design-system severity color mappings & styles
const SEVERITY_STYLES = {
  critical: {
    color: "#DC2626",
    badgeBg: "bg-destructive/10",
    badgeText: "text-destructive",
    border: "border-destructive/30",
  },
  high: {
    color: "#F26A4B",
    badgeBg: "bg-orange-500/10",
    badgeText: "text-orange-600 dark:text-orange-400",
    border: "border-orange-500/30",
  },
  moderate: {
    color: "#EFA02A",
    badgeBg: "bg-accent/15",
    badgeText: "text-accent-foreground",
    border: "border-accent/40",
  },
  low: {
    color: "#1D9F76",
    badgeBg: "bg-primary/10",
    badgeText: "text-primary",
    border: "border-primary/30",
  },
  info: {
    color: "#5E5A52",
    badgeBg: "bg-muted/40",
    badgeText: "text-muted-foreground",
    border: "border-border",
  },
};

// Labels are i18n keys: these maps are module-scope so they cannot call `t`,
// and the label follows the active language at the render site instead.
const EVIDENCE_CONFIG = {
  image_screening: {
    labelKey: "officialMap.diseaseScreening",
    color: "#DC2626",
    icon: Leaf,
    heat: 0.95,
  },
  pest_observation: {
    labelKey: "officialMap.pestObservation",
    color: "#9333EA",
    icon: Bug,
    heat: 0.85,
  },
  environmental_risk: {
    labelKey: "officialMap.environmentalRisk",
    color: "#EFA02A",
    icon: AlertTriangle,
    heat: 0.70,
  },
  farm_risk: {
    labelKey: "officialMap.farmHolding",
    color: "#1D9F76",
    icon: Sprout,
    heat: 0.50,
  },
};

const KPI_STYLES = {
  primary: {
    border: "border-l-primary",
    icon: "text-primary",
    iconBg: "bg-primary/10",
  },
  danger: {
    border: "border-l-destructive",
    icon: "text-destructive",
    iconBg: "bg-destructive/10",
  },
  accent: {
    border: "border-l-accent",
    icon: "text-accent-foreground",
    iconBg: "bg-accent/10",
  },
  neutral: {
    border: "border-l-muted-foreground",
    icon: "text-muted-foreground",
    iconBg: "bg-muted",
  },
};

const TIME_WINDOWS = [
  { value: 7, labelKey: "officialMap.last7Days" },
  { value: 30, labelKey: "officialMap.last30Days" },
  { value: 90, labelKey: "officialMap.last90Days" },
  { value: 180, labelKey: "officialMap.last180Days" },
  { value: 365, labelKey: "officialMap.pastYear" },
];

const DEFAULT_CENTER = [20.5937, 78.9629];
const DEFAULT_ZOOM = 6;

function isValidCoord(lat, lng) {
  const la = Number(lat);
  const lo = Number(lng);
  return (
    Number.isFinite(la) &&
    Number.isFinite(lo) &&
    la >= -90 &&
    la <= 90 &&
    lo >= -180 &&
    lo <= 180
  );
}

function formatDistance(metres) {
  const value = Number(metres);
  if (!Number.isFinite(value)) return "N/A";
  if (value >= 1000) return `${(value / 1000).toFixed(1)} km`;
  return `${Math.round(value)} m`;
}

/* ============================================================
   MAP HELPER: FIT BOUNDS TO FEATURES OR CLUSTERS
   ============================================================ */
function FitBoundsController({ points, focusPoint }) {
  const map = useMap();

  useEffect(() => {
    if (focusPoint && isValidCoord(focusPoint.latitude, focusPoint.longitude)) {
      map.flyTo([focusPoint.latitude, focusPoint.longitude], 14, { duration: 1.2 });
      return;
    }

    if (!points || points.length === 0) return;
    const validPoints = points.filter((p) => isValidCoord(p[0], p[1]));
    if (validPoints.length === 0) return;

    if (validPoints.length === 1) {
      map.setView(validPoints[0], 11);
      return;
    }

    try {
      map.fitBounds(validPoints, { padding: [48, 48], maxZoom: 12 });
    } catch (e) {
      console.warn("fitBounds failed:", e);
    }
  }, [points, focusPoint, map]);

  return null;
}

/* ============================================================
   MAP HELPER: INVALIDATE SIZE ON MOUNT / RESIZE
   ============================================================ */
function InvalidateSize() {
  const map = useMap();

  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 200);

    const handleResize = () => {
      map.invalidateSize();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", handleResize);
    };
  }, [map]);

  return null;
}

/* ============================================================
   INLINE HEAT LAYER HELPER
   ============================================================ */
function SafeHeatLayer({ points }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!points || points.length === 0) return;

    try {
      layerRef.current = L.heatLayer(points, {
        radius: 28,
        blur: 20,
        maxZoom: 14,
        minOpacity: 0.35,
        gradient: {
          0.2: "#1E88E5",
          0.4: "#26A69A",
          0.6: "#FDD835",
          0.8: "#FB8C00",
          1.0: "#E53935",
        },
      }).addTo(map);
    } catch (err) {
      console.warn("L.heatLayer failed:", err);
    }

    return () => {
      if (layerRef.current && map.hasLayer(layerRef.current)) {
        map.removeLayer(layerRef.current);
      }
      layerRef.current = null;
    };
  }, [map, points]);

  return null;
}

/* ============================================================
   STAT CARD (MATCHES OFFICIAL DASHBOARD DESIGN)
   ============================================================ */
function StatCard({ title, value, subtitle, icon: Icon, variant = "neutral", onClick }) {
  const style = KPI_STYLES[variant] || KPI_STYLES.neutral;

  return (
    <div
      onClick={onClick}
      className={`rounded-md border border-border border-l-2 bg-card p-5 text-left transition-colors duration-150 ${style.border
        } ${onClick ? "cursor-pointer hover:border-primary/40 hover:bg-background" : ""}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </p>

          <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground tabular-nums">
            {typeof value === "number" ? value.toLocaleString(i18n.language) : value || 0}
          </p>

          {subtitle && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>

        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${style.iconBg}`}>
          <Icon className={`h-4 w-4 ${style.icon}`} />
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   MAIN SURVEILLANCE MAP PAGE
   ============================================================ */
export default function OfficialMap() {
  const { t, i18n } = useTranslation();

  // Filters
  const [evidenceFilter, setEvidenceFilter] = useState("");
  const [days, setDays] = useState(90);
  const [selectedState, setSelectedState] = useState("");
  const [selectedDistrict, setSelectedDistrict] = useState("");
  const [selectedFarmerId, setSelectedFarmerId] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Layer toggles
  const [showHeat, setShowHeat] = useState(true);
  const [showMarkers, setShowMarkers] = useState(true);
  const [showClusters, setShowClusters] = useState(true);

  // Data states
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedFeature, setSelectedFeature] = useState(null);
  const [flyTarget, setFlyTarget] = useState(null);

  // Fetch surveillance feed
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.get("/official/surveillance", {
        params: {
          state: selectedState || undefined,
          district: selectedDistrict || undefined,
          days,
          evidence: evidenceFilter || undefined,
          farm_id: selectedFarmerId !== "all" ? selectedFarmerId : undefined,
        },
      });
      setData(response.data);

      if (selectedFeature) {
        const stillExists = (response.data.features || []).find((f) => f.id === selectedFeature.id);
        if (!stillExists) setSelectedFeature(null);
      }
    } catch (err) {
      console.error("Failed to load surveillance data:", err);
      // Graceful fallback to /official/districts if surveillance endpoint fails
      try {
        const fallback = await api.get("/official/districts", {
          params: { state: selectedState || undefined, days, evidence: evidenceFilter || undefined },
        });
        setData({
          features: (fallback.data.districts || []).map((d, i) => ({
            id: `district_${i}`,
            evidence_type: "farm_risk",
            label: t("officialMap.districtAggregate", {
              district: d.district,
            }),
            severity: d.severity,
            latitude: d.centroid.latitude,
            longitude: d.centroid.longitude,
            farmer_name: t("officialMap.districtName", {
              district: d.district,
            }),
            farm_name: t("officialMap.holdingsMapped", {
              count: d.farms,
            }),
            crop_name:
              (d.affected_crops || []).map((c) => c.crop).join(", ") ||
              t("officialMap.fieldCrops"),
            detail: t("officialMap.riskScoreDetail", {
              score: d.risk_score,
              count: d.observations.total,
            }),
            observed_at: new Date().toISOString(),
            district: d.district,
            state: d.state,
          })),
          heat_points: (fallback.data.districts || []).map((d) => [
            d.centroid.latitude,
            d.centroid.longitude,
            Math.max(0.2, (d.risk_score || 0) / 100),
          ]),
          clusters: fallback.data.clusters,
          farmers: [],
          counts: {
            total_issues: fallback.data.counts?.observations || 0,
            screenings: 0,
            pests: 0,
            risks: 0,
            critical_count: fallback.data.districts?.filter((d) => d.severity === "critical").length || 0,
            high_count: fallback.data.districts?.filter((d) => d.severity === "high").length || 0,
            farms_reporting: fallback.data.counts?.farms_with_evidence || 0,
            total_farms: fallback.data.counts?.farms_mapped || 0,
          },
          states: fallback.data.states || [],
          districts: (fallback.data.districts || []).map((d) => d.district),
        });
      } catch (fallbackErr) {
        setError(
          err.response?.data?.detail || t("officialMap.loadFailed"),
        );
      }
    } finally {
      setLoading(false);
    }
  }, [selectedState, selectedDistrict, days, evidenceFilter, selectedFarmerId, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Derived filtered features
  const allFeatures = useMemo(() => data?.features || [], [data]);

  const filteredFeatures = useMemo(() => {
    return allFeatures.filter((item) => {
      if (!isValidCoord(item.latitude, item.longitude)) return false;

      // Farmer filter
      if (selectedFarmerId !== "all" && String(item.farm_id) !== String(selectedFarmerId)) {
        return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const farmerMatch = (item.farmer_name || "").toLowerCase().includes(q);
        const farmMatch = (item.farm_name || "").toLowerCase().includes(q);
        const cropMatch = (item.crop_name || "").toLowerCase().includes(q);
        const labelMatch = (item.label || "").toLowerCase().includes(q);
        const districtMatch = (item.district || "").toLowerCase().includes(q);
        if (!farmerMatch && !farmMatch && !cropMatch && !labelMatch && !districtMatch) {
          return false;
        }
      }

      return true;
    });
  }, [allFeatures, selectedFarmerId, searchQuery]);

  // Heatmap points
  const activeHeatPoints = useMemo(() => {
    return filteredFeatures.map((f) => {
      const defaultIntensity = EVIDENCE_CONFIG[f.evidence_type]?.heat || 0.6;
      const intensity =
        f.severity === "critical"
          ? 1.0
          : f.severity === "high"
            ? 0.8
            : f.severity === "moderate"
              ? 0.55
              : defaultIntensity;
      return [f.latitude, f.longitude, intensity];
    });
  }, [filteredFeatures]);

  // Spatial cluster hotspots
  const activeClusters = useMemo(() => {
    const rawList = data?.clusters?.clusters || [];
    return rawList
      .map((c) => ({
        ...c,
        latitude: Number(c.centroid?.latitude ?? c.latitude),
        longitude: Number(c.centroid?.longitude ?? c.longitude),
        radius: Number(c.radius_metres ?? c.radius ?? 150),
      }))
      .filter((c) => isValidCoord(c.latitude, c.longitude));
  }, [data]);

  // Bounding points for map auto-fit
  const boundingPoints = useMemo(() => {
    const pts = filteredFeatures.map((f) => [f.latitude, f.longitude]);
    activeClusters.forEach((c) => pts.push([c.latitude, c.longitude]));
    return pts;
  }, [filteredFeatures, activeClusters]);

  // Handle marker selection
  const handleSelectFeature = (feat) => {
    setSelectedFeature(feat);
    if (isValidCoord(feat.latitude, feat.longitude)) {
      setFlyTarget({ latitude: feat.latitude, longitude: feat.longitude });
    }
  };

  /* ============================================================
     LOADING / ERROR STATES
     ============================================================ */
  if (loading && !data) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8 space-y-6">
        <div className="space-y-3">
          <div className="h-8 w-72 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-96 max-w-full animate-pulse rounded-md bg-muted" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-md border border-border bg-card" />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-md border border-border bg-card" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-7xl items-center justify-center px-4">
        <div className="rounded-md border border-border bg-card px-8 py-10 text-center max-w-md">
          <Database className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
          <h2 className="text-base font-semibold text-foreground">{t("officialMap.loadFailed")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <button
            type="button"
            onClick={loadData}
            className="mt-5 h-9 rounded-md border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-background"
          >
            {t("common.retry")}
          </button>
        </div>
      </div>
    );
  }

  const counts = data?.counts || {
    total_issues: filteredFeatures.length,
    critical_count: filteredFeatures.filter((f) => f.severity === "critical").length,
    high_count: filteredFeatures.filter((f) => f.severity === "high").length,
    screenings: filteredFeatures.filter((f) => f.evidence_type === "image_screening").length,
    pests: filteredFeatures.filter((f) => f.evidence_type === "pest_observation").length,
    risks: filteredFeatures.filter((f) => f.evidence_type === "environmental_risk").length,
    farms_reporting: new Set(filteredFeatures.map((f) => f.farm_id)).size,
    total_farms: data?.farmers?.length || 0,
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8 space-y-7">
      {/* ── Page Header ────────────────────────────────────────── */}
      <header>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-primary">
              <MapPin className="h-4 w-4" />
              <span>{t("officialMap.eyebrow")}</span>
            </div>

            <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
              {t("officialMap.title")}
            </h1>

            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {t("officialMap.eyebrowHelp")}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-card px-4 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-background active:bg-muted disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>{t("officialMap.refreshFeed")}</span>
            </button>
          </div>
        </div>
      </header>

      {/* ── Primary Surveillance KPIs ─────────────────────────── */}
      <section>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title={t("officialMap.mappedIssues")}
            value={counts.total_issues}
            subtitle={t("officialMap.issueBreakdown", {
              screenings: counts.screenings,
              pests: counts.pests,
            })}
            icon={Activity}
            variant="primary"
          />

          <StatCard
            title={t("officialMap.criticalHighAlerts")}
            value={counts.critical_count + counts.high_count}
            subtitle={t("officialMap.requiresImmediateReview")}
            icon={ShieldAlert}
            variant="danger"
          />

          <StatCard
            title={t("officialMap.activeHoldings")}
            value={counts.farms_reporting}
            subtitle={t("officialMap.outOfRegisteredFarms", {
              count: counts.total_farms || data?.farmers?.length || 0,
            })}
            icon={Building2}
            variant="accent"
          />

          <StatCard
            title={t("officialMap.spatialClusters")}
            value={activeClusters.length}
            subtitle={t("officialMap.automatedHotspotGroups")}
            icon={Layers}
            variant="neutral"
          />
        </div>
      </section>

      {/* ── Filters & Controls Card ────────────────────────────── */}
      <section className="rounded-md border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Filter className="h-3.5 w-3.5 text-primary" />
            <span>{t("officialMap.filters")}</span>
          </div>

          <span className="text-xs text-muted-foreground">
            {t("officialMap.showingMatching", { count: filteredFeatures.length })}
          </span>
        </div>

        {/* Filter Dropdowns Grid */}
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {/* Evidence Stream */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("officialMap.evidenceStream")}
            </label>
            <select
              value={evidenceFilter}
              onChange={(e) => setEvidenceFilter(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">{t("officialMap.allEvidenceTypes")}</option>
              <option value="image_screening">{t("officialMap.diseaseScreenings")}</option>
              <option value="pest_observation">{t("officialMap.pestObservations")}</option>
              <option value="environmental_risk">{t("officialMap.weatherRiskAlerts")}</option>
            </select>
          </div>

          {/* Time Period */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("officialMap.timePeriod")}
            </label>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {TIME_WINDOWS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
          </div>

          {/* State */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("officialMap.state")}
            </label>
            <select
              value={selectedState}
              onChange={(e) => {
                setSelectedState(e.target.value);
                setSelectedDistrict("");
              }}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">{t("officialMap.allStates")}</option>
              {(data?.states || []).map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          {/* District */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("officialMap.district")}
            </label>
            <select
              value={selectedDistrict}
              onChange={(e) => setSelectedDistrict(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">{t("officialMap.allDistricts")}</option>
              {(data?.districts || []).map((dist) => (
                <option key={dist} value={dist}>
                  {dist}
                </option>
              ))}
            </select>
          </div>

          {/* Farmer Selector */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("officialMap.farmerHolding")}
            </label>
            <select
              value={selectedFarmerId}
              onChange={(e) => setSelectedFarmerId(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">{t("officialMap.allFarmers", { count: data?.farmers?.length || 0 })}</option>
              {(data?.farmers || []).map((farm) => (
                <option key={farm.farm_id} value={String(farm.farm_id)}>
                  {farm.farmer_name} — {farm.farm_name} ({t("officialMap.issueCount", { count: farm.issue_count })})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Bottom row: Search & Layer Toggles */}
        <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("officialMap.searchPlaceholder")}
              className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground mr-1">{t("officialMap.overlays")}</span>

            <button
              type="button"
              onClick={() => setShowHeat((v) => !v)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors ${showHeat
                  ? "border-primary bg-primary text-white"
                  : "border-border bg-card text-muted-foreground hover:bg-background hover:text-foreground"
                }`}
            >
              <Flame className="h-3.5 w-3.5" />
              <span>{t("officialMap.heatmap")}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowMarkers((v) => !v)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors ${showMarkers
                  ? "border-primary bg-primary text-white"
                  : "border-border bg-card text-muted-foreground hover:bg-background hover:text-foreground"
                }`}
            >
              <MapPin className="h-3.5 w-3.5" />
              <span>{t("officialMap.markers")}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowClusters((v) => !v)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors ${showClusters
                  ? "border-destructive bg-destructive text-white"
                  : "border-border bg-card text-muted-foreground hover:bg-background hover:text-foreground"
                }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>{t("officialMap.clusters")}</span>
            </button>
          </div>
        </div>
      </section>

      {/* ── Main Map Canvas with Floating HUD & Legend ──────────── */}
      <section className="overflow-hidden rounded-md border border-border bg-card shadow-sm">
        <div className="relative w-full bg-muted/60" style={{ height: "580px" }}>
          {/* Top Left: Quick Telemetry HUD */}
          <div className="absolute top-4 left-4 z-[400] max-w-xs rounded-md border border-border bg-card/95 p-3.5 text-xs shadow-sm backdrop-blur-sm">
            <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
              <span className="font-semibold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-primary" />
                Live Surveillance
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                Active
              </span>
            </div>

            <div className="mt-2.5 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {t("officialMap.mappedIssues")}
                </span>
                <span className="font-semibold text-foreground tabular-nums">{filteredFeatures.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {t("officialMap.hotspotAreas")}
                </span>
                <span className="font-semibold text-destructive tabular-nums">
                  {t("officialMap.activeClusters", { count: activeClusters.length })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {t("officialMap.regionScope")}
                </span>
                <span className="font-medium text-foreground truncate max-w-[130px]">
                  {selectedDistrict || selectedState || t("officialMap.platformWide")}
                </span>
              </div>
            </div>
          </div>

          {/* Leaflet Map */}
          <MapContainer
            center={DEFAULT_CENTER}
            zoom={DEFAULT_ZOOM}
            scrollWheelZoom={true}
            style={{ height: "100%", width: "100%", zIndex: 1 }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <InvalidateSize />
            <FitBoundsController points={boundingPoints} focusPoint={flyTarget} />

            {/* Heat Surface */}
            {showHeat && activeHeatPoints.length > 0 && (
              <SafeHeatLayer points={activeHeatPoints} />
            )}

            {/* Potential Cluster Circles */}
            {showClusters &&
              activeClusters.map((cluster) => (
                <Circle
                  key={cluster.cluster_id || `${cluster.latitude}-${cluster.longitude}`}
                  center={[cluster.latitude, cluster.longitude]}
                  radius={Math.max(cluster.radius || 250, 150)}
                  pathOptions={{
                    color: "#DC2626",
                    fillColor: "#DC2626",
                    fillOpacity: 0.16,
                    weight: 2,
                    dashArray: "4, 6",
                  }}
                >
                  <Popup>
                    <div className="min-w-[190px] p-1 font-sans text-xs">
                      <p className="font-semibold text-destructive text-sm flex items-center gap-1.5">
                        <AlertTriangle className="h-4 w-4" />
                        {cluster.subject || t("officialMap.clusterDefault")}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {t("officialMap.clusterObservations", {
                          count: cluster.observation_count || 0,
                          radius: formatDistance(cluster.radius || 250),
                        })}
                      </p>
                      <p className="mt-1.5 text-[11px] text-foreground font-medium border-t border-border pt-1">
                        {t("officialMap.scoutRecommended")}
                      </p>
                    </div>
                  </Popup>
                </Circle>
              ))}

            {/* Individual Farmer Issue Markers */}
            {showMarkers &&
              filteredFeatures.map((feat) => {
                const evidenceMeta = EVIDENCE_CONFIG[feat.evidence_type] || EVIDENCE_CONFIG.image_screening;
                const severityMeta = SEVERITY_STYLES[feat.severity] || SEVERITY_STYLES.low;
                const isSelected = selectedFeature?.id === feat.id;
                const radius = isSelected ? 12 : 8;

                return (
                  <CircleMarker
                    key={feat.id}
                    center={[feat.latitude, feat.longitude]}
                    radius={radius}
                    weight={isSelected ? 3 : 2}
                    color={isSelected ? "#1E1E1E" : evidenceMeta.color}
                    fillColor={severityMeta.color}
                    fillOpacity={isSelected ? 0.95 : 0.75}
                    eventHandlers={{
                      click: () => handleSelectFeature(feat),
                    }}
                  >
                    <Popup>
                      <div className="min-w-[240px] p-1 font-sans text-xs">
                        <div className="flex items-center justify-between border-b border-border pb-1.5">
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                            style={{
                              backgroundColor: `${severityMeta.color}20`,
                              color: severityMeta.color,
                            }}
                          >
                            {t("officialMap.severityRisk", {
                              severity: feat.severity,
                            })}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {feat.observed_at
                              ? new Date(
                                  feat.observed_at,
                                ).toLocaleDateString(i18n.language)
                              : t("officialMap.recent")}
                          </span>
                        </div>

                        <p className="mt-1.5 text-sm font-semibold text-foreground">
                          {feat.label}
                        </p>
                        <p className="text-xs text-muted-foreground">{feat.detail}</p>

                        <div className="mt-2.5 rounded border border-border bg-muted/30 p-2 text-xs space-y-1">
                          <div className="flex items-center gap-1.5 font-medium text-foreground">
                            <User className="h-3 w-3 text-muted-foreground" />
                            {feat.farmer_name || t("officialMap.farmerName")}
                          </div>
                          {feat.farmer_phone && (
                            <div className="flex items-center gap-1.5 text-muted-foreground">
                              <Phone className="h-3 w-3" />
                              <a href={`tel:${feat.farmer_phone}`} className="hover:text-primary">
                                {feat.farmer_phone}
                              </a>
                            </div>
                          )}
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Sprout className="h-3 w-3" />
                            {t("map.farmLabel")}: {feat.farm_name} ({feat.crop_name})
                          </div>
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <MapPin className="h-3 w-3" />
                            {feat.village ? `${feat.village}, ` : ""}{feat.district || feat.state || t("common.region")}
                          </div>
                        </div>

                        <div className="mt-2 text-right">
                          <button
                            type="button"
                            onClick={() => handleSelectFeature(feat)}
                            className="text-xs font-semibold text-primary hover:underline"
                          >
                            Inspect Issue Details →
                          </button>
                        </div>
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}
          </MapContainer>

          {/* Bottom Left: Comprehensive Legend */}
          <div className="absolute bottom-4 left-4 z-[400] rounded-md border border-border bg-card/95 p-3.5 text-xs shadow-sm backdrop-blur-sm max-w-xs">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("officialMap.mapLayersLegend")}
            </p>

            {/* Heat Gradient Bar */}
            {showHeat && (
              <div className="mb-3">
                <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                  <span>{t("officialMap.lowDensity")}</span>
                  <span>{t("officialMap.criticalHotspot")}</span>
                </div>
                <div
                  className="h-2 w-full rounded-full"
                  style={{
                    background:
                      "linear-gradient(to right, #1E88E5, #26A69A, #FDD835, #FB8C00, #E53935)",
                  }}
                  aria-hidden="true"
                />
              </div>
            )}

            {/* Evidence Legend */}
            <div className="space-y-1.5">
              {Object.entries(EVIDENCE_CONFIG).map(([key, item]) => (
                <div key={key} className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: item.color }}
                      aria-hidden="true"
                    />
                    <span className="text-foreground">{t(item.labelKey)}</span>
                  </div>
                  <span className="tabular-nums text-muted-foreground font-medium">
                    {filteredFeatures.filter((f) => f.evidence_type === key).length}
                  </span>
                </div>
              ))}

              <div className="flex items-center justify-between gap-3 text-xs pt-1.5 border-t border-border">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full border border-destructive bg-destructive/30 shrink-0" />
                  <span className="text-foreground">{t("officialMap.hotspotClusterArea")}</span>
                </div>
                <span className="tabular-nums text-muted-foreground font-medium">
                  {activeClusters.length}
                </span>
              </div>
            </div>
          </div>

          {/* Updating Overlay */}
          {loading && (
            <div className="absolute inset-0 z-[500] flex items-center justify-center bg-card/40 backdrop-blur-[1px]">
              <div className="flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 shadow-md">
                <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                <span className="text-xs font-medium text-foreground">
                  {t("officialMap.synchronizing")}
                </span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Intelligence Panels: Issue Inspector & Register ─────── */}
      <section className="grid gap-6 lg:grid-cols-2">
        {/* Left Panel: Selected Issue Inspector & Hotspot Clusters */}
        <div className="space-y-6">
          {selectedFeature ? (
            <div className="rounded-md border border-border border-l-2 border-l-primary bg-card p-5 sm:p-6">
              <div className="flex items-start justify-between border-b border-border pb-4">
                <div>
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${SEVERITY_STYLES[selectedFeature.severity]?.badgeBg
                      } ${SEVERITY_STYLES[selectedFeature.severity]?.badgeText}`}
                  >
                    {selectedFeature.severity} Severity
                  </span>

                  <h3 className="mt-2 text-lg font-semibold tracking-tight text-foreground">
                    {selectedFeature.label}
                  </h3>

                  <p className="mt-0.5 text-xs text-muted-foreground">{selectedFeature.detail}</p>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedFeature(null)}
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-muted/30 p-3.5 text-xs">
                  <div>
                    <span className="text-muted-foreground block">{t("officialMap.farmerName")}</span>
                    <span className="font-semibold text-foreground mt-0.5 block">
                      {selectedFeature.farmer_name || t("common.unknown")}
                    </span>
                  </div>

                  <div>
                    <span className="text-muted-foreground block">{t("officialMap.contactPhone")}</span>
                    {selectedFeature.farmer_phone ? (
                      <a
                        href={`tel:${selectedFeature.farmer_phone}`}
                        className="font-semibold text-primary hover:underline mt-0.5 block"
                      >
                        {selectedFeature.farmer_phone}
                      </a>
                    ) : (
                      <span className="text-muted-foreground mt-0.5 block">—</span>
                    )}
                  </div>

                  <div>
                    <span className="text-muted-foreground block">{t("officialMap.farmHolding")}</span>
                    <span className="font-medium text-foreground mt-0.5 block">
                      {selectedFeature.farm_name}
                    </span>
                  </div>

                  <div>
                    <span className="text-muted-foreground block">{t("officialMap.cropVariety")}</span>
                    <span className="font-medium text-foreground mt-0.5 block">
                      {selectedFeature.crop_name}
                    </span>
                  </div>

                  <div className="col-span-2 pt-2 border-t border-border/60">
                    <span className="text-muted-foreground block">{t("officialMap.locationGps")}</span>
                    <span className="font-medium text-foreground mt-0.5 block">
                      {selectedFeature.village ? `${selectedFeature.village}, ` : ""}
                      {selectedFeature.district || selectedFeature.state || t("common.region")}{" "}
                      <span className="font-mono text-muted-foreground text-[11px]">
                        ({selectedFeature.latitude?.toFixed(4)}, {selectedFeature.longitude?.toFixed(4)})
                      </span>
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setFlyTarget({ latitude: selectedFeature.latitude, longitude: selectedFeature.longitude });
                  }}
                  className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-card px-4 text-xs font-semibold text-foreground transition-colors hover:border-primary/40 hover:bg-background"
                >
                  <LocateFixed className="h-3.5 w-3.5 text-primary" />
                  <span>{t("officialMap.centerObservation")}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-border bg-card p-6 text-center">
              <MapPin className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">{t("officialMap.selectObservation")}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("officialMap.selectObservationHelp")}
              </p>
            </div>
          )}

          {/* Hotspot Clusters List */}
          <div className="rounded-md border border-border bg-card p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("officialMap.spatialIntelligence")}
                </p>
                <h3 className="mt-1 text-base font-semibold tracking-tight text-foreground">
                  {t("officialMap.detectedClusters")}
                </h3>
              </div>

              <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium tabular-nums text-destructive">
                {t("officialMap.activeClusters", { count: activeClusters.length })}
              </span>
            </div>

            {activeClusters.length > 0 ? (
              <div className="space-y-2">
                {activeClusters.map((cl, i) => (
                  <div
                    key={cl.cluster_id || i}
                    onClick={() => setFlyTarget({ latitude: cl.latitude, longitude: cl.longitude })}
                    className="cursor-pointer rounded-md border border-destructive/25 bg-destructive/5 p-3.5 transition-colors hover:border-destructive/40 hover:bg-destructive/10"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm text-destructive flex items-center gap-1.5">
                        <AlertTriangle className="h-4 w-4" />
                        {cl.subject || t("officialMap.clusterGroupFallback")}
                      </span>
                      <span className="text-xs font-semibold tabular-nums text-destructive">
                        {cl.observation_count || 0} observations
                      </span>
                    </div>

                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("officialMap.clusterRadius", {
                        radius: formatDistance(cl.radius || 250),
                        lat: cl.latitude.toFixed(3),
                        lng: cl.longitude.toFixed(3),
                      })}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground py-2">
                {t("officialMap.noClustersWindow")}
              </p>
            )}
          </div>
        </div>

        {/* Right Panel: Farmer Issues Register Table */}
        <div className="rounded-md border border-border bg-card p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("officialMap.telemetryRegister")}
              </p>
              <h3 className="mt-1 text-base font-semibold tracking-tight text-foreground">
                Farmer Observations
              </h3>
            </div>

            <span className="text-xs text-muted-foreground tabular-nums">
              {filteredFeatures.length} records
            </span>
          </div>

          {filteredFeatures.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("officialMap.noMatchingIssues")}
            </p>
          ) : (
            <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-card border-b border-border text-muted-foreground uppercase text-[10px] tracking-wider z-10">
                  <tr>
                    <th className="py-2.5 pr-3 font-semibold">{t("officialMap.farmerAndFarm")}</th>
                    <th className="px-3 py-2.5 font-semibold">{t("officialMap.issueCondition")}</th>
                    <th className="px-3 py-2.5 font-semibold">{t("common.crop")}</th>
                    <th className="px-3 py-2.5 font-semibold">{t("common.severity")}</th>
                    <th className="py-2.5 pl-3 text-right font-semibold">{t("officialMap.map")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredFeatures.map((feat) => {
                    const sev = SEVERITY_STYLES[feat.severity] || SEVERITY_STYLES.low;
                    const isSelected = selectedFeature?.id === feat.id;

                    return (
                      <tr
                        key={feat.id}
                        onClick={() => handleSelectFeature(feat)}
                        className={`cursor-pointer transition-colors duration-150 ${isSelected ? "bg-muted/80 font-medium" : "hover:bg-muted/40"
                          }`}
                      >
                        <td className="py-2.5 pr-3">
                          <span className="font-semibold text-foreground block truncate max-w-[130px]">
                            {feat.farmer_name}
                          </span>
                          <span className="text-[11px] text-muted-foreground block truncate max-w-[130px]">
                            {feat.farm_name}
                          </span>
                        </td>

                        <td className="px-3 py-2.5">
                          <span className="font-medium text-foreground block truncate max-w-[150px]">
                            {feat.label}
                          </span>
                          <span className="text-[10px] text-muted-foreground capitalize">
                            {feat.evidence_type.replace(/_/g, " ")}
                          </span>
                        </td>

                        <td className="px-3 py-2.5 font-medium text-foreground">
                          {feat.crop_name || "—"}
                        </td>

                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${sev.badgeBg} ${sev.badgeText}`}
                          >
                            {feat.severity}
                          </span>
                        </td>

                        <td className="py-2.5 pl-3 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectFeature(feat);
                            }}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10"
                          >
                            <Eye className="h-3 w-3" />
                            <span>{t("common.view")}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
