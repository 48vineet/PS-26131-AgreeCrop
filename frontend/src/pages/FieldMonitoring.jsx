import {
  AlertTriangle,
  Building2,
  Calendar,
  CheckCircle2,
  ClipboardList,
  FlaskConical,
  HelpCircle,
  Leaf,
  Minus,
  Plus,
  RotateCcw,
  Send,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import DataTable from "../components/ui/DataTable";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import Field from "../components/ui/Field";
import LoadingState from "../components/ui/LoadingState";
import Modal from "../components/ui/Modal";
import PageHeader from "../components/ui/PageHeader";
import SectionHeader from "../components/ui/SectionHeader";
import Select from "../components/ui/Select";
import StatusBadge from "../components/ui/StatusBadge";
import Textarea from "../components/ui/Textarea";
import Timeline from "../components/ui/Timeline";
import { useAuth } from "../contexts/AuthContext";
import api from "../services/api";

/* ============================================================
   SHARED VOCABULARY
   ============================================================ */

const CASE_STATUS_VISUAL = {
  OPEN: { status: "info" },
  FOLLOW_UP_SUBMITTED: { status: "info" },
  FOLLOW_UP_DUE: { status: "warning" },
  RESOLVED: { status: "healthy" },
  CLOSED: { status: "neutral" },
};

// Matches the backend's ACTIVE_STATUSES (monitoring.py): a follow-up can only
// be appended to a case still being watched. Once RESOLVED or CLOSED, the
// backend returns 422 on POST .../followups, so the form is hidden rather
// than left up to fail.
const ACTIVE_CASE_STATUSES = ["OPEN", "FOLLOW_UP_SUBMITTED"];

const STATUS_ACTION = {
  RESOLVED: { icon: CheckCircle2, variant: "secondary" },
  CLOSED: { icon: XCircle, variant: "secondary" },
  OPEN: { icon: RotateCcw, variant: "secondary" },
};

const SYMPTOM_VISUAL = {
  IMPROVED: { status: "success", icon: TrendingDown },
  UNCHANGED: { status: "neutral", icon: Minus },
  WORSENED: { status: "danger", icon: TrendingUp },
  SYMPTOMS_GONE: { status: "success", icon: CheckCircle2 },
  UNCERTAIN: { status: "neutral", icon: HelpCircle },
};

// Used only when /monitoring/meta is unavailable; the meanings are localized
// at the render site.
const FALLBACK_SYMPTOM_CHANGES = [
  "IMPROVED",
  "UNCHANGED",
  "WORSENED",
  "SYMPTOMS_GONE",
  "UNCERTAIN",
].map((value) => ({ value }));

const REFERRAL_STATUS_VISUAL = {
  RECOMMENDED: { status: "pending" },
  REQUESTED: { status: "info" },
  REFERRED: { status: "info" },
  IN_PROGRESS: { status: "warning" },
  COMPLETED: { status: "healthy" },
  CANCELLED: { status: "neutral" },
};

const REFERRAL_KIND = {
  extension: { icon: Building2 },
  laboratory: { icon: FlaskConical },
};

function splitPredictedClass(predictedClass, t) {
  if (!predictedClass) {
    return { crop: null, disease: t("monitoring.unknownDisease") };
  }
  if (predictedClass.includes("___")) {
    const [crop, disease] = predictedClass.split("___");
    return {
      crop: crop.replace(/_/g, " "),
      disease: disease.replace(/_/g, " "),
    };
  }
  return { crop: null, disease: predictedClass.replace(/_/g, " ") };
}

function formatDateTime(value, t, locale) {
  if (!value) return t("monitoring.unknownDate");
  try {
    return new Date(value).toLocaleString(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return t("monitoring.unknownDate");
  }
}

function formatDate(value, t, locale) {
  if (!value) return t("monitoring.unknownDate");
  try {
    return new Date(value).toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return t("monitoring.unknownDate");
  }
}

/* ============================================================
   TOP-LEVEL ROLE BRANCH
   ============================================================ */

export default function FieldMonitoring() {
  const { profile, loading } = useAuth();
  const { t } = useTranslation();

  if (loading || !profile) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <LoadingState variant="page" />
      </div>
    );
  }

  if (profile.role === "extension_officer" || profile.role === "expert") {
    return <ExtensionMonitoring />;
  }

  if (profile.role === "farmer") {
    return <FarmerMonitoring />;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <EmptyState
        icon={Leaf}
        title={t("monitoring.notSetUpTitle")}
        description={t("monitoring.notSetUpDesc")}
      />
    </div>
  );
}

function ExtensionMonitoring() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await api.get("/extension/monitoring");
      setData(response.data);
    } catch (loadError) {
      console.error("Failed to load extension monitoring:", loadError);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const columns = [
    {
      key: "farmer_name",
      header: t("monitoring.tableFarmer"),
      render: (row) => (
        <div>
          <p className="font-medium text-foreground">
            {row.farmer_name || t("monitoring.unnamedFarmer")}
          </p>
          <p className="text-xs text-muted-foreground">{row.farm_name}</p>
        </div>
      ),
    },
    {
      key: "crop_name",
      header: t("common.crop"),
      render: (row) => row.crop_name || t("monitoring.cropNotRecorded"),
    },
    {
      key: "condition",
      header: t("monitoring.tableScreening"),
      render: (row) => formatDate(row.updated_at, t, i18n.language),
    },
    {
      key: "effective_status",
      header: t("monitoring.statusLabel"),
      render: (row) => {
        const visual = CASE_STATUS_VISUAL[row.effective_status] || {
          status: "neutral",
        };
        return (
          <StatusBadge status={visual.status}>
            {t(`monitoring.caseStatus.${row.effective_status}`)}
          </StatusBadge>
        );
      },
    },
    {
      key: "due_at",
      header: t("monitoring.tableNextCheck"),
      render: (row) =>
        row.due_at
          ? formatDate(row.due_at, t, i18n.language)
          : t("monitoring.notScheduled"),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <PageHeader
        title={t("monitoring.title")}
        subtitle={t("monitoring.farmerSubtitle")}
      />

      {error ? (
        <ErrorState
          title={t("monitoring.loadFailedTitle")}
          description={t("monitoring.loadFailedDesc")}
          onRetry={load}
        />
      ) : (
        <DataTable
          columns={columns}
          data={data?.items || []}
          loading={loading}
          keyField="case_id"
          emptyState={
            <EmptyState
              icon={ClipboardList}
              title={t("monitoring.noCasesTitle")}
              description={t("monitoring.noCasesDesc")}
            />
          }
        />
      )}
    </div>
  );
}

/* ============================================================
   FARMER: MONITORING CASES
   ============================================================ */

const STATUS_FILTERS = [
  { value: null, labelKey: "monitoring.allFilter" },
  { value: "OPEN", labelKey: "monitoring.caseStatus.OPEN" },
  { value: "FOLLOW_UP_DUE", labelKey: "monitoring.caseStatus.FOLLOW_UP_DUE" },
  {
    value: "FOLLOW_UP_SUBMITTED",
    labelKey: "monitoring.caseStatus.FOLLOW_UP_SUBMITTED",
  },
  { value: "RESOLVED", labelKey: "monitoring.caseStatus.RESOLVED" },
  { value: "CLOSED", labelKey: "monitoring.caseStatus.CLOSED" },
];

const PAGE_SIZE = 10;

function FarmerMonitoring() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCaseId = searchParams.get("case");

  const [meta, setMeta] = useState(null);

  const [statusFilter, setStatusFilter] = useState(null);
  const [offset, setOffset] = useState(0);
  const [listData, setListData] = useState(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(false);

  const [startOpen, setStartOpen] = useState(false);

  useEffect(() => {
    api
      .get("/monitoring/meta")
      .then((res) => setMeta(res.data))
      .catch((err) =>
        console.error("Failed to load monitoring vocabulary:", err),
      );
  }, []);

  useEffect(() => {
    if (activeCaseId) return;
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, offset, activeCaseId]);

  const loadList = async () => {
    setListLoading(true);
    setListError(false);
    try {
      const params = { limit: PAGE_SIZE, offset };
      if (statusFilter) params.status = statusFilter;
      const res = await api.get("/monitoring", { params });
      setListData(res.data);
    } catch (err) {
      console.error("Failed to load monitoring cases:", err);
      setListError(true);
    } finally {
      setListLoading(false);
    }
  };

  const openCase = (caseId) => {
    setSearchParams({ case: String(caseId) });
  };

  const closeCase = () => {
    setSearchParams({});
    loadList();
  };

  if (activeCaseId) {
    return <CaseDetail caseId={activeCaseId} meta={meta} onBack={closeCase} />;
  }

  const counts = listData?.counts_by_status || {};
  const items = listData?.items || [];
  const total = listData?.total_matching || 0;
  const hasMore = offset + items.length < total;
  const hasPrev = offset > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <PageHeader
        title={t("monitoring.title")}
        subtitle={t("monitoring.yourSubtitle")}
        actions={
          <Button icon={Plus} onClick={() => setStartOpen(true)}>
            {t("monitoring.startMonitoring")}
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => {
          const isActive =
            (filter.value === null && statusFilter === null) ||
            filter.value === statusFilter;
          const count =
            filter.value === null
              ? Object.values(counts).reduce((sum, n) => sum + n, 0)
              : counts[filter.value] || 0;

          return (
            <button
              key={filter.labelKey}
              type="button"
              onClick={() => {
                setStatusFilter(filter.value);
                setOffset(0);
              }}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                isActive
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
              }`}
            >
              {t(filter.labelKey)}
              {listData && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${
                    isActive ? "bg-primary/15" : "bg-muted"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {listLoading ? (
        <LoadingState variant="cards" rows={PAGE_SIZE} />
      ) : listError ? (
        <ErrorState
          title={t("monitoring.yourLoadFailedTitle")}
          description={t("monitoring.yourLoadFailedDesc")}
          onRetry={loadList}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={
            statusFilter
              ? t("monitoring.noFilterTitle")
              : t("monitoring.noCasesTitle")
          }
          description={
            statusFilter
              ? t("monitoring.noFilterDesc")
              : t("monitoring.yourNoCasesDesc")
          }
          action={
            !statusFilter && (
              <Button icon={Plus} onClick={() => setStartOpen(true)}>
                {t("monitoring.startMonitoring")}
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <CaseCard
                key={item.id}
                item={item}
                onOpen={() => openCase(item.id)}
              />
            ))}
          </div>

          {(hasPrev || hasMore) && (
            <div className="flex items-center justify-between border-t border-border pt-4 text-sm text-muted-foreground">
              <span>
                {t("monitoring.showingRange", {
                  from: offset + 1,
                  to: offset + items.length,
                  total,
                })}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!hasPrev}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  {t("monitoring.previous")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!hasMore}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  {t("monitoring.next")}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <StartMonitoringModal
        open={startOpen}
        onClose={() => setStartOpen(false)}
        meta={meta}
        onOpened={(caseId) => {
          setStartOpen(false);
          openCase(caseId);
        }}
      />
    </div>
  );
}

function CaseCard({ item, onOpen }) {
  const { t, i18n } = useTranslation();
  const visual =
    CASE_STATUS_VISUAL[item.effective_status] || CASE_STATUS_VISUAL.OPEN;
  const { crop, disease } = splitPredictedClass(
    item.evidence?.predicted_class,
    t,
  );

  return (
    <Card
      interactive
      padding="p-5"
      onClick={onOpen}
      className="flex flex-col gap-3 text-left"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10">
          <Leaf className="h-4 w-4 text-primary" aria-hidden="true" />
        </div>
        <StatusBadge status={visual.status}>
          {t(`monitoring.caseStatus.${item.effective_status || "OPEN"}`)}
        </StatusBadge>
      </div>

      <div>
        <p className="text-sm font-semibold text-foreground">{disease}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {item.farm_name || t("monitoring.farmNotRecorded")}
          {crop ? ` · ${crop}` : item.crop_name ? ` · ${item.crop_name}` : ""}
        </p>
      </div>

      {item.summary && (
        <p className="line-clamp-2 text-sm text-muted-foreground">
          {item.summary}
        </p>
      )}

      <div className="mt-auto flex items-center gap-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
        <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {t("monitoring.openedOn", {
          date: formatDate(item.opened_at, t, i18n.language),
        })}
      </div>
    </Card>
  );
}

function StartMonitoringModal({ open, onClose, meta, onOpened }) {
  const { t, i18n } = useTranslation();
  const [eligible, setEligible] = useState([]);
  const [eligibilityRule, setEligibilityRule] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [summary, setSummary] = useState("");
  const [followUpDays, setFollowUpDays] = useState("7");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setSelectedId("");
    setSummary("");
    setFollowUpDays("7");
    setSubmitError(null);
    loadEligible();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const loadEligible = async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await api.get("/monitoring/eligible", {
        params: { limit: 25 },
      });
      setEligible(res.data.items || []);
      setEligibilityRule(res.data.eligibility_rule || "");
    } catch (err) {
      console.error("Failed to load eligible screenings:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const dayBounds = meta?.follow_up_days || { min: 1, max: 90 };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await api.post("/monitoring", {
        observation_id: Number(selectedId),
        summary: summary.trim() || null,
        follow_up_in_days: followUpDays ? Number(followUpDays) : null,
      });
      onOpened(res.data.case.id);
    } catch (err) {
      console.error("Failed to open monitoring case:", err);
      setSubmitError(
        err.response?.data?.detail || t("monitoring.openFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("monitoring.startTitle")}
      description={t("monitoring.startDesc")}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            loading={submitting}
            disabled={!selectedId || loading}
          >
            {t("monitoring.startMonitoring")}
          </Button>
        </>
      }
    >
      {loading ? (
        <LoadingState variant="list" rows={3} />
      ) : error ? (
        <ErrorState
          title={t("monitoring.screeningsLoadFailedTitle")}
          description={t("monitoring.screeningsLoadFailedDesc")}
          onRetry={loadEligible}
        />
      ) : eligible.length === 0 ? (
        <EmptyState
          icon={Leaf}
          title={t("monitoring.noScreeningsTitle")}
          description={eligibilityRule || t("monitoring.noScreeningsDesc")}
        />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <Field label={t("monitoring.screeningField")} required>
            <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-border p-2">
              {eligible.map((row) => {
                const { crop, disease } = splitPredictedClass(
                  row.predicted_class,
                  t,
                );
                const selected = String(row.observation_id) === selectedId;
                return (
                  <button
                    key={row.observation_id}
                    type="button"
                    onClick={() => setSelectedId(String(row.observation_id))}
                    className={`w-full rounded-md border p-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      selected
                        ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                        : "border-border hover:border-muted-foreground/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-foreground">
                        {disease}
                      </p>
                      <span className="text-xs text-muted-foreground">
                        {t("monitoring.confidencePct", {
                          count: Math.round(row.confidence || 0),
                        })}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.farm_name}
                      {crop
                        ? ` · ${crop}`
                        : row.crop_name
                          ? ` · ${row.crop_name}`
                          : ""}{" "}
                      · {formatDate(row.screened_at, t, i18n.language)}
                    </p>
                  </button>
                );
              })}
            </div>
          </Field>

          <Textarea
            label={t("monitoring.summaryLabel")}
            hint={t("monitoring.summaryHint")}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={2}
            placeholder={t("monitoring.summaryPlaceholder")}
          />

          <Field
            label={t("monitoring.checkAgainDays")}
            htmlFor="start-follow-up-days"
            hint={t("monitoring.checkAgainHint", {
              min: dayBounds.min,
              max: dayBounds.max,
            })}
          >
            <input
              id="start-follow-up-days"
              type="number"
              min={dayBounds.min}
              max={dayBounds.max}
              value={followUpDays}
              onChange={(e) => setFollowUpDays(e.target.value)}
              className="h-10 w-32 rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/25"
            />
          </Field>

          {submitError && (
            <p className="text-sm text-destructive" role="alert">
              {submitError}
            </p>
          )}
        </form>
      )}
    </Modal>
  );
}

function CaseDetail({ caseId, meta, onBack }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [transitioning, setTransitioning] = useState(false);
  const [transitionError, setTransitionError] = useState(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await api.get(`/monitoring/${caseId}`);
      setData(res.data.case);
    } catch (err) {
      console.error("Failed to load case:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleTransition = async (status) => {
    setTransitioning(true);
    setTransitionError(null);
    try {
      const res = await api.patch(`/monitoring/${caseId}`, { status });
      setData(res.data.case);
    } catch (err) {
      console.error("Failed to update case status:", err);
      setTransitionError(
        err.response?.data?.detail || t("monitoring.updateFailed"),
      );
    } finally {
      setTransitioning(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <LoadingState variant="page" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <ErrorState
          title={t("monitoring.caseLoadFailedTitle")}
          description={t("monitoring.caseLoadFailedDesc")}
          onRetry={load}
        />
      </div>
    );
  }

  const visual =
    CASE_STATUS_VISUAL[data.effective_status] || CASE_STATUS_VISUAL.OPEN;
  const { crop, disease } = splitPredictedClass(
    data.evidence?.predicted_class,
    t,
  );
  const canFollowUp = ACTIVE_CASE_STATUSES.includes(data.status);

  const timelineItems = [
    {
      id: "opened",
      status: "info",
      icon: Leaf,
      title: t("monitoring.caseOpened"),
      description:
        data.summary || t("monitoring.openedOnScreening", { disease }),
      timestamp: formatDateTime(data.opened_at, t, i18n.language),
    },
    ...(data.followups || []).map((f) => {
      const sv = SYMPTOM_VISUAL[f.symptom_change] || SYMPTOM_VISUAL.UNCERTAIN;
      return {
        id: f.id,
        status:
          sv.status === "success"
            ? "success"
            : sv.status === "danger"
              ? "danger"
              : "neutral",
        icon: sv.icon,
        title: t(`monitoring.symptom.${f.symptom_change}`),
        description: f.notes || f.symptom_change_meaning,
        timestamp: formatDateTime(f.observed_at, t, i18n.language),
      };
    }),
  ];

  if (data.resolved_at) {
    timelineItems.push({
      id: "resolved",
      status: "success",
      icon: CheckCircle2,
      title: t("monitoring.markedResolved"),
      description: t("monitoring.stoppedWatching"),
      timestamp: formatDateTime(data.resolved_at, t, i18n.language),
    });
  }
  if (data.closed_at) {
    timelineItems.push({
      id: "closed",
      status: "neutral",
      icon: XCircle,
      title: t("monitoring.caseClosed"),
      description: null,
      timestamp: formatDateTime(data.closed_at, t, i18n.language),
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <PageHeader
        backTo="/farmer/monitoring"
        title={disease}
        subtitle={`${data.farm_name || t("monitoring.farmNotRecorded")}${
          crop ? ` · ${crop}` : data.crop_name ? ` · ${data.crop_name}` : ""
        }`}
        actions={
          <StatusBadge status={visual.status}>
            {t(`monitoring.caseStatus.${data.effective_status}`)}
          </StatusBadge>
        }
      />

      {data.overdue && (
        <div className="flex items-start gap-3 rounded-md border border-accent/25 bg-accent/10 p-4">
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-accent-foreground"
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-medium text-foreground">
              {t("monitoring.followUpDue")}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t("monitoring.followUpDueDesc", {
                date: formatDate(data.due_at, t, i18n.language),
              })}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-6">
          <section>
            <SectionHeader
              title={t("monitoring.history")}
              subtitle={t("monitoring.historySubtitle")}
            />
            <Card>
              <Timeline items={timelineItems} />
            </Card>
          </section>
        </div>

        <div className="space-y-6">
          {canFollowUp ? (
            <section>
              <SectionHeader
                title={t("monitoring.recordFollowUp")}
                subtitle={t("monitoring.whatDidYouSee")}
              />
              <FollowupForm
                caseId={caseId}
                meta={meta}
                onRecorded={(updatedCase) => setData(updatedCase)}
              />
            </section>
          ) : (
            <section>
              <SectionHeader
                title={t("monitoring.recordFollowUp")}
                subtitle={t("monitoring.whatDidYouSee")}
              />
              <Card className="flex items-start gap-3">
                <CheckCircle2
                  className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="text-sm text-muted-foreground">
                  {data.status === "CLOSED"
                    ? t("monitoring.notWatchedClosed")
                    : t("monitoring.notWatchedResolved")}
                </p>
              </Card>
            </section>
          )}

          {data.next_statuses?.length > 0 && (
            <section>
              <SectionHeader
                title={t("monitoring.statusLabel")}
                subtitle={data.status_meaning}
              />
              <Card className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {data.next_statuses.map((status) => {
                    const action = STATUS_ACTION[status];
                    if (!action) return null;
                    return (
                      <Button
                        key={status}
                        variant={action.variant}
                        size="sm"
                        icon={action.icon}
                        loading={transitioning}
                        onClick={() => handleTransition(status)}
                      >
                        {t(`monitoring.caseAction.${status}`)}
                      </Button>
                    );
                  })}
                </div>
                {transitionError && (
                  <p className="text-sm text-destructive" role="alert">
                    {transitionError}
                  </p>
                )}
              </Card>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function FollowupForm({ caseId, meta, onRecorded }) {
  const { t } = useTranslation();
  const symptomChanges = meta?.symptom_changes?.length
    ? meta.symptom_changes
    : FALLBACK_SYMPTOM_CHANGES;
  const dayBounds = meta?.follow_up_days || { min: 1, max: 90 };

  const [symptomChange, setSymptomChange] = useState(
    symptomChanges[0]?.value || "UNCHANGED",
  );
  const [notes, setNotes] = useState("");
  const [observedAt, setObservedAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [nextFollowUpDays, setNextFollowUpDays] = useState("7");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const selectedMeaning = useMemo(() => {
    if (meta?.symptom_changes?.length) {
      return symptomChanges.find((s) => s.value === symptomChange)?.meaning;
    }
    return t(`monitoring.symptomMeaning.${symptomChange}`);
  }, [meta, symptomChanges, symptomChange, t]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await api.post(`/monitoring/${caseId}/followups`, {
        symptom_change: symptomChange,
        notes: notes.trim() || null,
        observed_at: observedAt ? new Date(observedAt).toISOString() : null,
        next_follow_up_in_days: nextFollowUpDays
          ? Number(nextFollowUpDays)
          : null,
      });
      setNotes("");
      onRecorded(res.data.case);
    } catch (err) {
      console.error("Failed to record follow-up:", err);
      setSubmitError(
        err.response?.data?.detail || t("monitoring.followUpFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Select
          label={t("monitoring.whatChanged")}
          value={symptomChange}
          onChange={(e) => setSymptomChange(e.target.value)}
          hint={selectedMeaning}
        >
          {symptomChanges.map((s) => (
            <option key={s.value} value={s.value}>
              {t(`monitoring.symptom.${s.value}`)}
            </option>
          ))}
        </Select>

        <Field
          label={t("monitoring.dateObserved")}
          htmlFor="followup-observed-at"
        >
          <input
            id="followup-observed-at"
            type="date"
            value={observedAt}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setObservedAt(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/25"
          />
        </Field>

        <Textarea
          label={t("monitoring.notesLabel")}
          hint={t("monitoring.notesHint")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder={t("monitoring.notesPlaceholder")}
        />

        <Field
          label={t("monitoring.checkAgainDays")}
          htmlFor="followup-next-days"
          hint={t("monitoring.checkAgainHintOptional", {
            min: dayBounds.min,
            max: dayBounds.max,
          })}
        >
          <input
            id="followup-next-days"
            type="number"
            min={dayBounds.min}
            max={dayBounds.max}
            value={nextFollowUpDays}
            onChange={(e) => setNextFollowUpDays(e.target.value)}
            className="h-10 w-32 rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/25"
          />
        </Field>

        {submitError && (
          <p className="text-sm text-destructive" role="alert">
            {submitError}
          </p>
        )}

        <Button
          type="submit"
          icon={Send}
          loading={submitting}
          className="w-full"
        >
          {t("monitoring.recordFollowUpAction")}
        </Button>
      </form>
    </Card>
  );
}

/* ============================================================
   EXTENSION OFFICER / EXPERT: REFERRALS QUEUE
   ============================================================ */

const REFERRAL_FILTERS = [
  { value: null, labelKey: "monitoring.allFilter" },
  { value: "RECOMMENDED", labelKey: "monitoring.referralStatus.RECOMMENDED" },
  { value: "REQUESTED", labelKey: "monitoring.referralStatus.REQUESTED" },
  { value: "REFERRED", labelKey: "monitoring.referralStatus.REFERRED" },
  { value: "IN_PROGRESS", labelKey: "monitoring.referralStatus.IN_PROGRESS" },
  { value: "COMPLETED", labelKey: "monitoring.referralStatus.COMPLETED" },
  { value: "CANCELLED", labelKey: "monitoring.referralStatus.CANCELLED" },
];

function ReviewerReferrals() {
  const { t, i18n } = useTranslation();
  const [statusFilter, setStatusFilter] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeReferral, setActiveReferral] = useState(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const params = { limit: 50 };
      if (statusFilter) params.status = statusFilter;
      const res = await api.get("/referrals", { params });
      setData(res.data);
    } catch (err) {
      console.error("Failed to load referrals:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const counts = data?.counts_by_status || {};
  const items = data?.items || [];
  const yourTransitions = data?.your_transitions || [];

  const columns = [
    {
      key: "kind",
      header: t("monitoring.tableRequest"),
      render: (row) => {
        const kind = REFERRAL_KIND[row.kind] || REFERRAL_KIND.extension;
        const Icon = kind.icon;
        return (
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10">
              <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {t(`monitoring.referralKind.${row.kind || "extension"}`)}
              </p>
              <p className="mt-0.5 line-clamp-2 max-w-xs text-xs text-muted-foreground">
                {row.reason}
              </p>
            </div>
          </div>
        );
      },
    },
    {
      key: "facility",
      header: t("monitoring.tableDestination"),
      render: (row) => (
        <span className="text-sm text-foreground">
          {row.facility?.name || t("monitoring.notSpecified")}
        </span>
      ),
    },
    {
      key: "status",
      header: t("monitoring.statusLabel"),
      render: (row) => {
        const visual =
          REFERRAL_STATUS_VISUAL[row.status] ||
          REFERRAL_STATUS_VISUAL.RECOMMENDED;
        return (
          <StatusBadge status={visual.status}>
            {t(`monitoring.referralStatus.${row.status}`)}
          </StatusBadge>
        );
      },
    },
    {
      key: "created_at",
      header: t("monitoring.tableRaised"),
      render: (row) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDate(row.created_at, t, i18n.language)}
        </span>
      ),
    },
    {
      key: "action",
      header: "",
      align: "right",
      render: (row) => {
        const options = (row.next_statuses || []).filter((s) =>
          yourTransitions.includes(s),
        );
        if (options.length === 0) {
          return (
            <span className="text-xs text-muted-foreground">
              {row.is_final
                ? t("monitoring.closedLabel")
                : t("monitoring.waitingOnFarmer")}
            </span>
          );
        }
        return (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setActiveReferral(row)}
          >
            {t("monitoring.update")}
          </Button>
        );
      },
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <PageHeader
        title={t("monitoring.referralsTitle")}
        subtitle={t("monitoring.referralsSubtitle")}
      />

      <div className="flex flex-wrap gap-2">
        {REFERRAL_FILTERS.map((filter) => {
          const isActive =
            (filter.value === null && statusFilter === null) ||
            filter.value === statusFilter;
          const count =
            filter.value === null
              ? Object.values(counts).reduce((sum, n) => sum + n, 0)
              : counts[filter.value] || 0;

          return (
            <button
              key={filter.labelKey}
              type="button"
              onClick={() => setStatusFilter(filter.value)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                isActive
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
              }`}
            >
              {t(filter.labelKey)}
              {data && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${
                    isActive ? "bg-primary/15" : "bg-muted"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error ? (
        <ErrorState
          title={t("monitoring.referralsLoadFailedTitle")}
          description={t("monitoring.referralsLoadFailedDesc")}
          onRetry={load}
        />
      ) : (
        <DataTable
          columns={columns}
          data={items}
          keyField="referral_id"
          loading={loading}
          emptyState={
            <EmptyState
              icon={ClipboardList}
              title={
                statusFilter
                  ? t("monitoring.noReferralFilterTitle")
                  : t("monitoring.noReferralsTitle")
              }
              description={
                statusFilter
                  ? t("monitoring.tryDifferentStatus")
                  : t("monitoring.noReferralsDesc")
              }
            />
          }
        />
      )}

      <ReferralUpdateModal
        referral={activeReferral}
        yourTransitions={yourTransitions}
        onClose={() => setActiveReferral(null)}
        onUpdated={() => {
          setActiveReferral(null);
          load();
        }}
      />
    </div>
  );
}

function ReferralUpdateModal({
  referral,
  yourTransitions,
  onClose,
  onUpdated,
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState("");
  const [outcomeNotes, setOutcomeNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    if (!referral) return;
    const options = (referral.next_statuses || []).filter((s) =>
      yourTransitions.includes(s),
    );
    setStatus(options[0] || "");
    setOutcomeNotes("");
    setSubmitError(null);
  }, [referral, yourTransitions]);

  if (!referral) return null;

  const options = (referral.next_statuses || []).filter((s) =>
    yourTransitions.includes(s),
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!status) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.patch(`/referrals/${referral.referral_id}`, {
        status,
        outcome_notes: outcomeNotes.trim() || null,
      });
      onUpdated();
    } catch (err) {
      console.error("Failed to update referral:", err);
      setSubmitError(
        err.response?.data?.detail || t("monitoring.updateReferralFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={!!referral}
      onClose={onClose}
      title={t("monitoring.updateReferralTitle", {
        kind: t(`monitoring.referralKind.${referral.kind || "extension"}`),
      })}
      description={referral.reason}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            loading={submitting}
            disabled={!status}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Select
          label={t("monitoring.newStatus")}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {options.map((s) => (
            <option key={s} value={s}>
              {t(`monitoring.referralStatus.${s}`)}
            </option>
          ))}
        </Select>

        <Textarea
          label={t("monitoring.outcomeNotes")}
          hint={t("monitoring.outcomeNotesHint")}
          value={outcomeNotes}
          onChange={(e) => setOutcomeNotes(e.target.value)}
          rows={3}
          placeholder={t("monitoring.outcomeNotesPlaceholder")}
        />

        {submitError && (
          <p className="text-sm text-destructive" role="alert">
            {submitError}
          </p>
        )}
      </form>
    </Modal>
  );
}
