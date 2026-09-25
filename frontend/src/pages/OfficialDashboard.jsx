import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Building2,
  ClipboardCheck,
  Database,
  Mail,
  Map,
  MapPin,
  Megaphone,
  Minus,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import api from "../services/api";

const RISK_CONFIG = {
  HIGH: {
    icon: ShieldAlert,
    value: "text-destructive",
    bg: "bg-destructive/10",
    border: "border-destructive/20",
    bar: "bg-destructive",
  },
  MODERATE: {
    icon: AlertTriangle,
    value: "text-accent-foreground",
    bg: "bg-accent/10",
    border: "border-accent/25",
    bar: "bg-accent",
  },
  LOW: {
    icon: ShieldCheck,
    value: "text-primary",
    bg: "bg-primary/10",
    border: "border-primary/20",
    bar: "bg-primary",
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

const OfficialDashboard = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSummary();
  }, []);

  const fetchSummary = async () => {
    try {
      setLoading(true);

      const response = await api.get("/official/summary");
      setSummary(response.data);
    } catch (error) {
      console.error("Failed to fetch official summary:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
        <div className="mb-8 space-y-3">
          <div className="h-8 w-72 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-96 max-w-full animate-pulse rounded-md bg-muted" />
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((item) => (
            <div
              key={item}
              className="h-32 animate-pulse rounded-md border border-border bg-card"
            />
          ))}
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <div className="h-72 animate-pulse rounded-md border border-border bg-card" />
          <div className="h-72 animate-pulse rounded-md border border-border bg-card" />
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-7xl items-center justify-center px-4">
        <div className="rounded-md border border-border bg-card px-8 py-10 text-center">
          <Database className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />

          <h2 className="text-base font-semibold text-foreground">
            {t("dashboard.noData")}
          </h2>

          <p className="mt-1 text-sm text-muted-foreground">
            {t("dashboards.official.regionalSummaryFailed")}
          </p>

          <button
            type="button"
            onClick={fetchSummary}
            className="mt-5 h-9 rounded-md border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-background"
          >
            {t("common.tryAgain")}
          </button>
        </div>
      </div>
    );
  }

  const StatCard = ({
    title,
    value,
    subtitle,
    icon: Icon,
    variant = "neutral",
    onClick,
  }) => {
    const style = KPI_STYLES[variant] || KPI_STYLES.neutral;

    return (
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className={[
          "group w-full rounded-md border border-border border-l-2 bg-card p-5 text-left",
          style.border,
          onClick
            ? "cursor-pointer transition-colors duration-150 hover:border-primary/40 hover:bg-background"
            : "cursor-default",
        ].join(" ")}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {title}
            </p>

            <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground tabular-nums">
              {value?.toLocaleString(i18n.language) || 0}
            </p>

            {subtitle && (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>

          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${style.iconBg}`}
          >
            <Icon className={`h-4 w-4 ${style.icon}`} />
          </div>
        </div>

        {onClick && (
          <div className="mt-3 flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
            <span>{t("dashboards.official.viewDetails")}</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </div>
        )}
      </button>
    );
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
      {/* Header */}
      <header className="mb-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-primary">
              <Activity className="h-4 w-4" />
              <span>{t("dashboards.official.regionalIntelligence")}</span>
            </div>

            <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
              {t("dashboard.welcome")} — {t("dashboard.official")}
            </h1>

            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {t("dashboard.officialSubtitle")}
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-primary" />
            <span>{t("dashboards.official.systemOverview")}</span>
          </div>
        </div>
      </header>

      {/* Primary KPIs */}
      <section className="mb-7">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {t("dashboards.official.systemOverview")}
            </h2>

            <p className="mt-1 text-xs text-muted-foreground">
              {t("dashboards.official.platformSurveillance")}
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <StatCard
            title={t("dashboard.totalFarms")}
            value={summary.counts?.farms}
            subtitle={t("dashboard.registeredInSystem")}
            icon={Building2}
            variant="primary"
          />

          <StatCard
            title={t("dashboard.totalObservations")}
            value={summary.counts?.observations}
            subtitle={t("dashboards.official.screeningsPlusPests", {
              screenings: summary.counts?.image_screenings || 0,
              pests: summary.counts?.pest_observations || 0,
            })}
            icon={Database}
            variant="neutral"
          />

          <StatCard
            title={t("dashboard.highRiskCases")}
            value={summary.counts?.high_risk_cases}
            subtitle={t("dashboard.requiresAttention")}
            icon={ShieldAlert}
            variant="danger"
            onClick={() => navigate("/official/analytics")}
          />

          <StatCard
            title={t("dashboard.pendingValidations")}
            value={summary.counts?.pending_validations}
            subtitle={t("dashboard.awaitingExpertReview")}
            icon={ClipboardCheck}
            variant="accent"
          />

          <StatCard
            title={t("dashboard.openReferrals")}
            value={summary.counts?.open_referrals}
            subtitle={t("dashboard.activeReferrals")}
            icon={Mail}
            variant="neutral"
          />

          <StatCard
            title={t("dashboard.followUpCases")}
            value={summary.counts?.follow_up_workload}
            subtitle={t("dashboard.activeMonitoring")}
            icon={Activity}
            variant="primary"
          />
        </div>
      </section>

      {/* Intelligence panels */}
      <section className="mb-7 grid gap-5 lg:grid-cols-2">
        {/* Diseases */}
        <div className="rounded-md border border-border bg-card p-5 sm:p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("dashboards.official.diseaseIntelligence")}
              </p>

              <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
                {t("dashboard.topDiseases")}
              </h2>
            </div>

            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-destructive/10">
              <Activity className="h-4 w-4 text-destructive" />
            </div>
          </div>

          {summary.disease_trends && summary.disease_trends.length > 0 ? (
            <div className="space-y-1">
              {summary.disease_trends.slice(0, 5).map((item, idx) => (
                <div
                  key={`${item.condition}-${idx}`}
                  className="flex items-center gap-3 border-b border-border py-3 last:border-0"
                >
                  <span className="w-5 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                    {String(idx + 1).padStart(2, "0")}
                  </span>

                  <span
                    className="min-w-0 flex-1 truncate text-sm text-foreground"
                    title={item.condition}
                  >
                    {item.condition}
                  </span>

                  <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium tabular-nums text-destructive">
                    {item.count}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyPanel t={t} />
          )}

          <button
            type="button"
            onClick={() => navigate("/official/analytics")}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:text-secondary"
          >
            {t("dashboard.viewAllAnalytics")}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Pests */}
        <div className="rounded-md border border-border bg-card p-5 sm:p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("dashboards.official.pestIntelligence")}
              </p>

              <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
                {t("dashboard.topPests")}
              </h2>
            </div>

            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent/10">
              <AlertTriangle className="h-4 w-4 text-accent-foreground" />
            </div>
          </div>

          {summary.pest_trends && summary.pest_trends.length > 0 ? (
            <div className="space-y-1">
              {summary.pest_trends.slice(0, 5).map((item, idx) => (
                <div
                  key={`${item.pest}-${idx}`}
                  className="flex items-center gap-3 border-b border-border py-3 last:border-0"
                >
                  <span className="w-5 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                    {String(idx + 1).padStart(2, "0")}
                  </span>

                  <span
                    className="min-w-0 flex-1 truncate text-sm text-foreground"
                    title={item.pest}
                  >
                    {item.pest}
                  </span>

                  <span className="rounded-full bg-accent/15 px-2.5 py-1 text-xs font-medium tabular-nums text-accent-foreground">
                    {item.count}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyPanel t={t} />
          )}

          <button
            type="button"
            onClick={() => navigate("/official/analytics")}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:text-secondary"
          >
            {t("dashboard.viewAllAnalytics")}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </section>

      {/* Risk distribution */}
      {summary.risk_levels && Object.keys(summary.risk_levels).length > 0 && (
        <section className="mb-7 rounded-md border border-border bg-card p-5 sm:p-6">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("dashboards.official.riskIntelligence")}
              </p>

              <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
                {t("dashboard.riskDistribution")}
              </h2>
            </div>

            <div className="hidden h-9 w-9 items-center justify-center rounded-md border border-border sm:flex">
              <ShieldAlert className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {["HIGH", "MODERATE", "LOW"].map((level) => {
              const config = RISK_CONFIG[level];
              const Icon = config.icon;
              const value = summary.risk_levels[level] || 0;

              return (
                <div
                  key={level}
                  className={`rounded-md border p-4 ${config.bg} ${config.border}`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs font-semibold tracking-wider ${config.value}`}
                    >
                      {level === "HIGH"
                        ? t("dashboard.highRisk")
                        : level === "MODERATE"
                          ? t("dashboard.moderateRisk")
                          : t("dashboard.lowRisk")}
                    </span>

                    <Icon className={`h-4 w-4 ${config.value}`} />
                  </div>

                  <p
                    className={`mt-3 text-3xl font-semibold tracking-tight tabular-nums ${config.value}`}
                  >
                    {value.toLocaleString(i18n.language)}
                  </p>

                  <div className="mt-3 h-1 overflow-hidden rounded-full bg-background/60">
                    <div
                      className={`h-full rounded-full ${config.bar}`}
                      style={{
                        width: `${Math.min(value > 0 ? 100 : 0, 100)}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Quick actions */}
      <section className="mb-7">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-foreground">
            {t("dashboard.quickActions")}
          </h2>

          <p className="mt-1 text-xs text-muted-foreground">
            {t("dashboards.official.navigateCoreTools")}
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <ActionCard
            icon={BarChart3}
            title={t("dashboard.viewAnalytics")}
            description={t("dashboard.detailedInsights")}
            onClick={() => navigate("/official/analytics")}
          />

          <ActionCard
            icon={Map}
            title={t("dashboard.viewMap")}
            description={t("dashboard.hotspotMapping")}
            onClick={() => navigate("/official/map")}
          />

          <ActionCard
            icon={Megaphone}
            title={t("dashboard.manageAdvisories")}
            description={t("dashboard.regionalGuidance")}
            onClick={() => navigate("/official/advisories")}
          />
        </div>
      </section>

      {/* Geographic coverage */}
      {summary.states && summary.states.length > 0 && (
        <section className="rounded-md border border-border bg-card p-5 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                <MapPin className="h-4 w-4 text-muted-foreground" />
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("dashboards.official.geographicCoverage")}
                </p>

                <p className="mt-1 text-sm font-medium text-foreground">
                  {t("dashboard.coveringStates")} {summary.states.length}{" "}
                  {t("dashboard.states")}
                </p>
              </div>
            </div>

            <div className="max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-right">
              {summary.states.slice(0, 10).join(", ")}

              {summary.states.length > 10 && (
                <span className="ml-1 text-foreground">
                  {t("dashboards.official.moreCount", {
                    count: summary.states.length - 10,
                  })}
                </span>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
};

function ActionCard({ icon: Icon, title, description, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-md border border-border bg-card p-5 text-left transition-colors duration-150 hover:border-primary/40 hover:bg-background"
    >
      <div className="mb-5 flex items-center justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>

        <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
      </div>

      <h3 className="text-sm font-semibold text-foreground">{title}</h3>

      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
    </button>
  );
}

function EmptyPanel({ t }) {
  return (
    <div className="flex min-h-36 items-center justify-center rounded-md border border-dashed border-border">
      <div className="text-center">
        <Minus className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />

        <p className="text-sm font-medium text-foreground">
          {t("dashboard.noData")}
        </p>

        <p className="mt-1 text-xs text-muted-foreground">
          {t("dashboards.official.noTrends")}
        </p>
      </div>
    </div>
  );
}

export default OfficialDashboard;
