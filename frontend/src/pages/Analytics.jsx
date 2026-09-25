import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Building2,
  CheckCircle2,
  ChevronRight,
  Database,
  Map as MapIcon,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sprout,
} from "lucide-react";

import api from "../services/api";
import BarChartCard from "../components/ui/BarChartCard";
import LineChartCard from "../components/ui/LineChartCard";

const TIME_WINDOWS = [
  { value: 7, labelKey: "analytics.last7Days" },
  { value: 30, labelKey: "analytics.last30Days" },
  { value: 90, labelKey: "analytics.last90Days" },
  { value: 180, labelKey: "analytics.last180Days" },
  { value: 365, labelKey: "analytics.pastYear" },
];

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

export default function Analytics() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  // Filters
  const [selectedState, setSelectedState] = useState("");
  const [selectedDistrict, setSelectedDistrict] = useState("");
  const [days, setDays] = useState(90);

  // Data states
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch Analytics
  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.get("/official/analytics", {
        params: {
          state: selectedState || undefined,
          district: selectedDistrict || undefined,
          days,
        },
      });
      setData(response.data);
    } catch (err) {
      console.error("Failed to fetch official analytics:", err);
      setError(err.response?.data?.detail || t("analytics.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [selectedState, selectedDistrict, days, t]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  /* ============================================================
     KPI STAT CARD COMPONENT
     ============================================================ */
  const renderStatCard = (title, value, subtitle, icon, variant = "neutral", onClick) => {
    const style = KPI_STYLES[variant] || KPI_STYLES.neutral;

    return (
      <div
        onClick={onClick}
        className={`rounded-md border border-border border-l-2 bg-card p-5 text-left transition-colors duration-150 ${
          style.border
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
            {icon}
          </div>
        </div>

        {onClick && (
          <div className="mt-3 flex items-center gap-1 text-xs font-medium text-primary">
            <span>{t("analytics.exploreInMap")}</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </div>
        )}
      </div>
    );
  };

  /* ============================================================
     PREPARE CHART DATA
     ============================================================ */

  // 1. Time Series Data for Line Chart
  const timeSeriesData = useMemo(() => {
    if (!data?.time_series || data.time_series.length === 0) return [];
    return data.time_series.map((item) => ({
      date: item.date,
      Screenings: item.screenings || 0,
      Pests: item.pests || 0,
      Risks: item.risks || 0,
    }));
  }, [data]);

  // 2. Disease Top Conditions for Bar Chart
  const diseaseBarData = useMemo(() => {
    const raw = data?.disease_trends || [];
    return raw.slice(0, 8).map((d) => ({
      name: d.condition.length > 18 ? `${d.condition.slice(0, 16)}…` : d.condition,
      fullName: d.condition,
      Observations: d.count,
    }));
  }, [data]);

  // 3. Pest Top Occurrences for Bar Chart
  const pestBarData = useMemo(() => {
    const raw = data?.pest_trends || [];
    return raw.slice(0, 8).map((p) => ({
      name: p.pest.length > 18 ? `${p.pest.slice(0, 16)}…` : p.pest,
      fullName: p.pest,
      Count: p.count,
    }));
  }, [data]);

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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-md border border-border bg-card" />
          ))}
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="h-72 animate-pulse rounded-md border border-border bg-card" />
          <div className="h-72 animate-pulse rounded-md border border-border bg-card" />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-7xl items-center justify-center px-4">
        <div className="rounded-md border border-border bg-card px-8 py-10 text-center max-w-md">
          <Database className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
          <h2 className="text-base font-semibold text-foreground">{t("analytics.unavailableTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <button
            type="button"
            onClick={loadAnalytics}
            className="mt-5 h-9 rounded-md border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-background"
          >
            {t("analytics.retryLoading")}
          </button>
        </div>
      </div>
    );
  }

  const counts = data?.counts || {};
  const validation = data?.validation_stats || {};

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8 space-y-7">
      {/* ── Page Header ────────────────────────────────────────── */}
      <header>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-primary">
              <BarChart3 className="h-4 w-4" />
              <span>{t("analytics.officialIntelligence")}</span>
            </div>

            <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
              {t("analytics.regionalAnalytics")}
            </h1>

            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {t("analytics.pageSubtitle")}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate("/official/map")}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3.5 text-xs font-semibold text-foreground transition-colors hover:border-primary/40 hover:bg-background"
            >
              <MapIcon className="h-3.5 w-3.5 text-primary" />
              <span>{t("analytics.surveillanceMap")}</span>
            </button>

            <button
              type="button"
              onClick={loadAnalytics}
              disabled={loading}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-card px-4 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-background active:bg-muted disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>{t("analytics.refresh")}</span>
            </button>
          </div>
        </div>
      </header>

      {/* ── Filter Controls ────────────────────────────────────── */}
      <section className="rounded-md border border-border bg-card p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 flex-1 max-w-3xl">
            {/* State */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("analytics.filterState")}
              </label>
              <select
                value={selectedState}
                onChange={(e) => {
                  setSelectedState(e.target.value);
                  setSelectedDistrict("");
                }}
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">{t("analytics.allStates")}</option>
                {(data?.states || []).map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            {/* District */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("analytics.filterDistrict")}
              </label>
              <select
                value={selectedDistrict}
                onChange={(e) => setSelectedDistrict(e.target.value)}
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">{t("analytics.allDistricts")}</option>
                {(data?.districts || []).map((dist) => (
                  <option key={dist} value={dist}>
                    {dist}
                  </option>
                ))}
              </select>
            </div>

            {/* Time Window */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("analytics.analysisHorizon")}
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
          </div>

          <div className="text-xs text-muted-foreground pt-2 md:pt-0">
            {t("analytics.analysisWindow")}{" "}
            <span className="font-semibold text-foreground">
              {t("analytics.daysCount", { count: days })}
            </span>
          </div>
        </div>
      </section>

      {/* ── Key Performance Indicators Grid ────────────────────── */}
      <section>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {renderStatCard(
            t("analytics.registeredHoldings"),
            counts.farms,
            t("analytics.mappedFarms"),
            <Building2 className="h-4 w-4 text-primary" />,
            "primary"
          )}

          {renderStatCard(
            t("analytics.fieldObservations"),
            counts.observations,
            t("analytics.observationsBreakdown", {
              disease: counts.image_screenings || 0,
              pest: counts.pest_observations || 0,
            }),
            <Database className="h-4 w-4 text-muted-foreground" />,
            "neutral"
          )}

          {renderStatCard(
            t("analytics.highAndCritical"),
            (counts.high_risk_cases || 0) + (counts.critical_cases || 0),
            t("analytics.needsIntervention"),
            <ShieldAlert className="h-4 w-4 text-destructive" />,
            "danger",
            () => navigate("/official/map")
          )}

          {renderStatCard(
            t("analytics.diagnosticAccuracy"),
            validation.agreement_rate == null ? "—" : `${validation.agreement_rate}%`,
            validation.total_reviewed
              ? t("analytics.validatedAcross", { count: validation.total_reviewed })
              : t("analytics.noExpertReviews"),
            <CheckCircle2 className="h-4 w-4 text-primary" />,
            "primary"
          )}

          {renderStatCard(
            t("analytics.pendingValidations"),
            counts.pending_validations,
            t("analytics.awaitingReview"),
            <AlertTriangle className="h-4 w-4 text-accent-foreground" />,
            "accent"
          )}

          {renderStatCard(
            t("analytics.activeMonitoringCases"),
            counts.follow_up_workload,
            t("analytics.ongoingInvestigations"),
            <Activity className="h-4 w-4 text-primary" />,
            "primary"
          )}
        </div>
      </section>

      {/* ── Temporal Progression Chart (LineChartCard) ──────────── */}
      {timeSeriesData.length > 0 && (
        <section>
          <LineChartCard
            title={t("analytics.temporalProgression")}
            subtitle={t("analytics.temporalProgressionSubtitle", { days })}
            data={timeSeriesData}
            xKey="date"
            series={[
              { key: "Screenings", label: t("analytics.diseaseScreenings"), color: "#F26A4B" },
              { key: "Pests", label: t("analytics.pestIncidents"), color: "#9333EA" },
              { key: "Risks", label: t("analytics.weatherPressures"), color: "#EFA02A" },
            ]}
            height={300}
          />
        </section>
      )}

      {/* ── Categorical Distributions (BarChartCards) ───────────── */}
      <section className="grid gap-6 lg:grid-cols-2">
        {/* Top Diagnosed Disease Conditions */}
        <BarChartCard
          title={t("analytics.topDiseaseDiagnoses")}
          subtitle={t("analytics.topDiseaseSubtitle")}
          data={diseaseBarData}
          xKey="name"
          series={[{ key: "Observations", label: t("analytics.diagnoses"), color: "#F26A4B" }]}
          height={280}
        />

        {/* Pest Surveillance Frequency */}
        <BarChartCard
          title={t("analytics.topPestInfestations")}
          subtitle={t("analytics.topPestSubtitle")}
          data={pestBarData}
          xKey="name"
          series={[{ key: "Count", label: t("analytics.pestDetections"), color: "#1D9F76" }]}
          height={280}
        />
      </section>

      {/* ── Intelligence Panels: Crop Activity & District Ranking ── */}
      <section className="grid gap-6 lg:grid-cols-2">
        {/* Crop Screenings Breakdown */}
        <div className="rounded-md border border-border bg-card p-5 sm:p-6">
          <div className="mb-5 flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("analytics.cropVulnerability")}
              </p>
              <h3 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
                {t("analytics.activityByCrop")}
              </h3>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
              <Sprout className="h-4 w-4 text-primary" />
            </div>
          </div>

          {data?.crop_statistics && data.crop_statistics.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {data.crop_statistics.map((crop, idx) => (
                <div
                  key={idx}
                  className="rounded-md border border-border bg-muted/20 p-3.5 transition-colors hover:border-primary/40"
                >
                  <p className="truncate text-xs font-medium text-muted-foreground" title={crop.crop}>
                    {crop.crop}
                  </p>
                  <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums text-foreground">
                    {crop.image_screenings}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{t("analytics.screeningsRecorded")}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4">{t("analytics.noCropStats")}</p>
          )}
        </div>

        {/* District Risk & Surveillance Ranking */}
        <div className="rounded-md border border-border bg-card p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between border-b border-border pb-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("analytics.territorialFocus")}
              </p>
              <h3 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
                {t("analytics.districtRanking")}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => navigate("/official/map")}
              className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1"
            >
              <span>{t("analytics.viewMap")}</span>
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>

          {data?.district_rankings && data.district_rankings.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pr-3 font-semibold">{t("analytics.districtLabel")}</th>
                    <th className="px-2.5 py-2 text-right font-semibold">{t("analytics.holdingsLabel")}</th>
                    <th className="px-2.5 py-2 text-right font-semibold">{t("analytics.screeningLabel")}</th>
                    <th className="px-2.5 py-2 text-right font-semibold">{t("analytics.pestLabel")}</th>
                    <th className="py-2 pl-2 text-right font-semibold">{t("analytics.highRiskLabel")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {data.district_rankings.map((dist) => (
                    <tr
                      key={dist.district}
                      onClick={() => {
                        setSelectedDistrict(dist.district);
                      }}
                      className="cursor-pointer hover:bg-muted/40 transition-colors"
                    >
                      <td className="py-2.5 pr-3 font-medium text-foreground">
                        {dist.district}
                      </td>
                      <td className="px-2.5 py-2.5 text-right tabular-nums text-muted-foreground">
                        {dist.farms}
                      </td>
                      <td className="px-2.5 py-2.5 text-right tabular-nums text-muted-foreground">
                        {dist.screenings}
                      </td>
                      <td className="px-2.5 py-2.5 text-right tabular-nums text-muted-foreground">
                        {dist.pests}
                      </td>
                      <td className="py-2.5 pl-2 text-right">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ${
                            dist.high_risks > 0 ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {dist.high_risks}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4">{t("analytics.noDistrictRanking")}</p>
          )}
        </div>
      </section>

      {/* ── Risk Severity Spectrum & Diagnostic Quality ───────── */}
      <section className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { labelKey: "analytics.criticalRisk", count: data?.risk_levels?.CRITICAL || 0, color: "#DC2626", bg: "bg-destructive/10", text: "text-destructive", descKey: "analytics.outbreakImminent" },
          { labelKey: "analytics.highRisk", count: data?.risk_levels?.HIGH || 0, color: "#F26A4B", bg: "bg-orange-500/10", text: "text-orange-600 dark:text-orange-400", descKey: "analytics.actionRequired" },
          { labelKey: "analytics.moderateRisk", count: data?.risk_levels?.MODERATE || 0, color: "#EFA02A", bg: "bg-accent/15", text: "text-accent-foreground", descKey: "analytics.activeMonitoring" },
          { labelKey: "analytics.lowRisk", count: data?.risk_levels?.LOW || 0, color: "#1D9F76", bg: "bg-primary/10", text: "text-primary", descKey: "analytics.nominalStatus" },
        ].map((item) => (
          <div
            key={item.labelKey}
            className={`rounded-md border border-border p-5 ${item.bg}`}
          >
            <div className="flex items-center justify-between">
              <span className={`text-xs font-semibold uppercase tracking-wider ${item.text}`}>
                {t(item.labelKey)}
              </span>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
            </div>

            <p className={`mt-2 text-3xl font-semibold tabular-nums tracking-tight ${item.text}`}>
              {item.count}
            </p>

            <p className="mt-1 text-xs text-muted-foreground">{t(item.descKey)}</p>
          </div>
        ))}
      </section>

      {/* ── Privacy & Audit Notice ─────────────────────────────── */}
      <div className="rounded-md border border-primary/20 bg-primary/5 p-4 flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="text-xs leading-relaxed text-foreground">
          <span className="font-semibold text-primary">{t("analytics.aggregateNoticeLabel")} </span>
          {t("analytics.aggregateNotice")}
        </div>
      </div>
    </div>
  );
}
