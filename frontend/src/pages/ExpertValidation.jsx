import {
  AlertCircle,
  CheckCircle,
  Clock3,
  FileSearch,
  HelpCircle,
  ImageOff,
  MapPin,
  Maximize2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Modal from "../components/ui/Modal";
import api from "../services/api";

/* ============================================================
   STATUS CONFIG
   ============================================================ */

// Labels are translation keys rather than text: this map is module scope and
// cannot call `t`.
const STATUS_CONFIG = {
  PENDING: {
    labelKey: "validation.pending",
    icon: Clock3,
    classes: "bg-accent/15 text-accent-foreground border-accent/25",
  },

  VALIDATED: {
    labelKey: "validation.validated",
    icon: CheckCircle,
    classes: "bg-primary/10 text-primary border-primary/25",
  },

  REJECTED: {
    labelKey: "validation.rejected",
    icon: XCircle,
    classes: "bg-destructive/10 text-destructive border-destructive/20",
  },

  NEEDS_REVIEW: {
    labelKey: "validation.needsReview",
    icon: HelpCircle,
    classes: "bg-muted text-muted-foreground border-border",
  },
};

/* ============================================================
   SAFE FORMATTING HELPERS
   ============================================================ */

/**
 * The API may return confidence either as:
 *
 *   0.861
 *   86.1
 *
 * The old component always multiplied by 100, which could
 * produce values such as 8610%.
 *
 * Normalize both formats to a 0..1 ratio.
 */
const normalizeConfidence = (value) => {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  if (numeric > 1) {
    return Math.min(1, Math.max(0, numeric / 100));
  }

  return Math.min(1, Math.max(0, numeric));
};

const formatConfidence = (value) => {
  const ratio = normalizeConfidence(value);

  if (ratio === null) {
    return "—";
  }

  return `${(ratio * 100).toFixed(1)}%`;
};

const formatConfidenceValue = (value) => {
  const ratio = normalizeConfidence(value);

  if (ratio === null) {
    return null;
  }

  return Math.round(ratio * 100);
};

// Module-scope, so they take `t` and the active locale rather than calling
// `t`/`i18n` themselves: the fallbacks and the date format have to follow the
// selected language, not be frozen in English here.
const formatDate = (value, t, locale, includeTime = false) => {
  if (!value) {
    return t("validation.dateUnavailable");
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return t("validation.dateUnavailable");
  }

  return date.toLocaleString(locale, {
    dateStyle: "medium",
    ...(includeTime
      ? {
          timeStyle: "short",
        }
      : {}),
  });
};

const formatClassName = (value, t) => {
  if (!value) {
    return t("validation.unknownDiagnosis");
  }

  const cleaned = String(value)
    .replace(/___/g, " · ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned
    .split(" ")
    .map((word) => {
      if (!word) return word;

      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
};

const normalizeReviewDetail = (detail, t) => {
  const screening = detail.screening || {};
  const context = detail.context || {};
  const validation = detail.validation || {};
  const predictedCrop = screening.predicted_class?.split("___")[0];

  return {
    ...detail,
    predicted_class: screening.predicted_class,
    confidence: screening.confidence,
    screened_at: screening.screened_at,
    crop_name: context.crop_name || formatClassName(predictedCrop, t),
    location_district: context.district,
    location_state: context.state,
    validation_status: validation.status,
    validated_class: validation.validated_class,
    review_notes: validation.review_notes,
    reviewed_at: validation.reviewed_at,
    reviewer_role: validation.reviewer_role,
  };
};

/* ============================================================
   CONFIDENCE CONFIG
   ============================================================ */

// Module-scope, so it returns a translation key rather than text.
const getConfidenceConfig = (confidence) => {
  const ratio = normalizeConfidence(confidence);

  if (ratio === null) {
    return {
      labelKey: "common.unknown",
      classes: "bg-muted text-muted-foreground border-border",
      bar: "bg-muted-foreground",
    };
  }

  if (ratio >= 0.8) {
    return {
      labelKey: "screening.high",
      classes: "bg-primary/10 text-primary border-primary/20",
      bar: "bg-primary",
    };
  }

  if (ratio >= 0.5) {
    return {
      labelKey: "screening.medium",
      classes: "bg-accent/15 text-accent-foreground border-accent/25",
      bar: "bg-accent",
    };
  }

  return {
    labelKey: "screening.low",
    classes: "bg-destructive/10 text-destructive border-destructive/20",
    bar: "bg-destructive",
  };
};

/* ============================================================
   SCREENING IMAGE
   ============================================================ */

/**
 * The backend attaches a short-lived signed link under `image` on the detail
 * endpoint, with `available` and a specific `reason` when there is nothing to
 * show. Only the `url` the server signed is ever rendered: no token is built
 * here, and no second request is made, so authorisation stays entirely
 * server-side.
 */
const ImageEvidence = ({ image, diseaseName }) => {
  const { t } = useTranslation();
  const [loadFailed, setLoadFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  // A new observation is a new image; a stale error must not follow the reviewer.
  useEffect(() => {
    setLoadFailed(false);
    setZoomed(false);
  }, [image?.url]);

  const url = image?.url;
  const alt = diseaseName
    ? t("validation.screenedImageAlt", { disease: diseaseName })
    : t("validation.screenedImageAltGeneric");

  const unavailable = (
    <div
      className="flex flex-col items-center justify-center rounded-md border border-border bg-background px-6 py-10 text-center"
      role="img"
      aria-label={t("validation.noScreeningImage")}
    >
      <ImageOff
        className="h-8 w-8 text-muted-foreground"
        aria-hidden="true"
      />

      <p className="mt-3 text-sm font-medium text-foreground">
        {t("validation.imageUnavailable")}
      </p>

      {/* The server names its own cause, so the reviewer can tell an ordinary
          absence from a failure they should escalate. */}
      {image?.reason && (
        <p className="mt-1.5 max-w-md text-xs leading-relaxed text-muted-foreground">
          {image.reason}
        </p>
      )}
    </div>
  );

  const failed = (
    <div
      className="flex flex-col items-center justify-center rounded-md border border-destructive/20 bg-destructive/5 px-6 py-10 text-center"
      role="img"
      aria-label={t("validation.imageFailedToLoad")}
    >
      <AlertCircle
        className="h-8 w-8 text-destructive"
        aria-hidden="true"
      />

      <p className="mt-3 text-sm font-medium text-foreground">
        {t("validation.imageFailedToLoad")}
      </p>

      <p className="mt-1.5 max-w-md text-xs leading-relaxed text-muted-foreground">
        {t("validation.imageLoadFailedHelp")}
      </p>
    </div>
  );

  if (!image?.available || !url) {
    return unavailable;
  }

  return (
    <>
      <div className="group relative overflow-hidden rounded-md border border-border bg-background">
        {loadFailed ? (
          failed
        ) : (
          <img
            src={url}
            alt={alt}
            onError={() => setLoadFailed(true)}
            className="aspect-square w-full object-contain"
          />
        )}

        {!loadFailed && (
          <button
            type="button"
            onClick={() => setZoomed(true)}
            aria-label={t("validation.enlargeImage")}
            className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card/90 text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100"
          >
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <Modal
        open={zoomed}
        onClose={() => setZoomed(false)}
        title={formatClassName(diseaseName, t)}
        description={t("validation.enlargeImageDescription")}
        size="lg"
      >
        <img
          src={url}
          alt={alt}
          className="mx-auto max-h-[65vh] w-auto rounded-md border border-border object-contain"
        />
      </Modal>
    </>
  );
};

/* ============================================================
   MAIN COMPONENT
   ============================================================ */

const ExpertValidation = () => {
  const { t, i18n } = useTranslation();

  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [queueError, setQueueError] = useState(false);

  const [selectedObservation, setSelectedObservation] = useState(null);

  const [detailLoading, setDetailLoading] = useState(false);

  const [statusFilter, setStatusFilter] = useState("PENDING");

  const [counts, setCounts] = useState({});

  const [validationForm, setValidationForm] = useState({
    status: "VALIDATED",
    validated_class: "",
    review_notes: "",
  });

  const [submitting, setSubmitting] = useState(false);

  const [submitError, setSubmitError] = useState("");

  /* ==========================================================
     FETCH QUEUE
  ========================================================== */

  const fetchQueue = async () => {
    try {
      setLoading(true);
      setQueueError(false);

      const response = await api.get("/validation/observations", {
        params: {
          status: statusFilter,
          limit: 50,
        },
      });

      setQueue(response.data.items || []);
      setCounts(response.data.counts_by_status || {});
    } catch (error) {
      console.error("Failed to fetch validation queue:", error);

      setQueue([]);
      setQueueError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();

    // Intentionally reload when the selected filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  /* ==========================================================
     FETCH DETAIL
  ========================================================== */

  const fetchObservationDetail = async (observationId) => {
    try {
      setDetailLoading(true);
      setSubmitError("");

      const response = await api.get(
        `/validation/observations/${observationId}`,
      );

      const observation = normalizeReviewDetail(response.data, t);

      setSelectedObservation(observation);

      setValidationForm({
        status: "VALIDATED",
        validated_class: observation.predicted_class || "",
        review_notes: "",
      });
    } catch (error) {
      console.error("Failed to fetch observation details:", error);

      setSubmitError(t("validation.couldntLoadObservation"));
    } finally {
      setDetailLoading(false);
    }
  };

  /* ==========================================================
     SUBMIT VALIDATION
  ========================================================== */

  const submitValidation = async () => {
    if (!selectedObservation || submitting) {
      return;
    }

    try {
      setSubmitting(true);
      setSubmitError("");

      const submission = {
        status: validationForm.status,
        review_notes: validationForm.review_notes,
      };

      if (validationForm.status === "VALIDATED") {
        submission.validated_class = validationForm.validated_class;
      }

      const existingValidation =
        selectedObservation.validation_status &&
        selectedObservation.validation_status !== "PENDING";

      if (existingValidation) {
        await api.patch(
          `/validation/observations/${selectedObservation.observation_id}`,
          submission,
        );
      } else {
        await api.post(
          `/validation/observations/${selectedObservation.observation_id}`,
          submission,
        );
      }

      alert(t("validation.validationSubmitted"));

      setSelectedObservation(null);

      await fetchQueue();
    } catch (error) {
      console.error("Failed to submit validation:", error);

      setSubmitError(
        error.response?.data?.detail ||
          error.message ||
          t("validation.submitFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  /* ==========================================================
     QUEUE SUMMARY
  ========================================================== */

  const queueSummary = useMemo(() => {
    return {
      visible: queue.length,
      pending: counts.PENDING || 0,
      validated: counts.VALIDATED || 0,
      rejected: counts.REJECTED || 0,
      needsReview: counts.NEEDS_REVIEW || 0,
    };
  }, [queue.length, counts]);

  /* ==========================================================
     LOADING
  ========================================================== */

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-background">
        <div className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mb-7">
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />

            <div className="mt-3 h-9 w-64 animate-pulse rounded bg-muted" />

            <div className="mt-2 h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
          </div>

          <div className="mb-6 flex gap-2 border-b border-border pb-2">
            {[1, 2, 3, 4].map((item) => (
              <div
                key={item}
                className="h-10 w-24 animate-pulse rounded bg-muted"
              />
            ))}
          </div>

          <div className="grid min-h-[650px] grid-cols-1 gap-6 lg:grid-cols-[minmax(380px,0.85fr)_minmax(0,1.65fr)]">
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((item) => (
                <div
                  key={item}
                  className="h-32 animate-pulse rounded-md border border-border bg-card"
                />
              ))}
            </div>

            <div className="animate-pulse rounded-md border border-border bg-card" />
          </div>
        </div>
      </div>
    );
  }

  /* ==========================================================
     PAGE
  ========================================================== */

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-background">
      <div className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {/* ====================================================
            HEADER
        ===================================================== */}

        <header className="mb-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                {t("validation.eyebrow")}
              </p>

              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
                {t("validation.title")}
              </h1>

              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
                {t("validation.subtitle")}
              </p>
            </div>

            {/* Queue status summary */}
            <div className="flex flex-wrap gap-2">
              <SummaryPill
                label={t("validation.visibleLabel")}
                value={queueSummary.visible}
              />

              <SummaryPill
                label={t("validation.pendingCount")}
                value={queueSummary.pending}
                active={statusFilter === "PENDING"}
              />

              <SummaryPill
                label={t("validation.reviewed")}
                value={
                  queueSummary.validated +
                  queueSummary.rejected +
                  queueSummary.needsReview
                }
              />
            </div>
          </div>
        </header>

        {/* ====================================================
            STATUS FILTER
        ===================================================== */}

        <div className="mb-6 overflow-x-auto border-b border-border">
          <div className="flex min-w-max gap-1">
            {["PENDING", "VALIDATED", "REJECTED", "NEEDS_REVIEW"].map(
              (status) => {
                const config =
                  STATUS_CONFIG[status] || STATUS_CONFIG.NEEDS_REVIEW;

                const isActive = statusFilter === status;

                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setStatusFilter(status)}
                    className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset ${
                      isActive
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                    }`}
                  >
                    {t(config.labelKey)}

                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {counts[status] || 0}
                    </span>
                  </button>
                );
              },
            )}
          </div>
        </div>

        {/* ====================================================
            MAIN WORKSPACE
        ===================================================== */}

        <div className="grid min-h-[680px] grid-cols-1 gap-6 lg:grid-cols-[minmax(400px,0.85fr)_minmax(0,1.65fr)]">
          {/* ==================================================
              QUEUE
          =================================================== */}

          <section className="min-w-0">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {t("validation.reviewWorkload")}
                </p>

                <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
                  {t("validation.queue")}
                </h2>
              </div>

              <span className="text-xs tabular-nums text-muted-foreground">
                {t("validation.shownCount", { count: queue.length })}
              </span>
            </div>

            {/* Queue error */}
            {queueError ? (
              <div className="rounded-md border border-destructive/20 bg-card p-8 text-center">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-md bg-destructive/10">
                  <AlertCircle
                    className="h-5 w-5 text-destructive"
                    aria-hidden="true"
                  />
                </div>

                <h3 className="mt-4 text-sm font-semibold text-foreground">
                  {t("validation.queueLoadFailed")}
                </h3>

                <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  {t("validation.queueLoadFailedHelp")}
                </p>

                <button
                  type="button"
                  onClick={fetchQueue}
                  className="mt-5 h-10 rounded-md border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {t("common.tryAgain")}
                </button>
              </div>
            ) : queue.length === 0 ? (
              <div className="rounded-md border border-border bg-card px-6 py-14 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted/50">
                  <CheckCircle
                    className="h-6 w-6 text-primary"
                    aria-hidden="true"
                  />
                </div>

                <p className="mt-4 text-sm font-semibold text-foreground">
                  {t("validation.noItems")}
                </p>

                <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  {t("validation.noItemsHelp")}
                </p>
              </div>
            ) : (
              <div className="max-h-[calc(100vh-250px)] space-y-2.5 overflow-y-auto pr-1">
                {queue.map((item) => {
                  const confidence = formatConfidenceValue(item.confidence);

                  const confidenceConfig = getConfidenceConfig(item.confidence);

                  const isSelected =
                    selectedObservation?.observation_id === item.observation_id;

                  return (
                    <button
                      key={item.observation_id}
                      type="button"
                      onClick={() =>
                        fetchObservationDetail(item.observation_id)
                      }
                      className={`group w-full rounded-md border bg-card p-4 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                        isSelected
                          ? "border-primary bg-primary/[0.03] ring-1 ring-primary/25"
                          : "border-border hover:border-primary/35 hover:bg-background/30"
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        {/* Number */}
                        <div
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
                            isSelected
                              ? "bg-primary text-white"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {queue.indexOf(item) + 1}
                        </div>

                        <div className="min-w-0 flex-1">
                          {/* Title row */}
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="truncate text-sm font-semibold text-foreground">
                                {formatClassName(item.predicted_class, t)}
                              </h3>

                              <p className="mt-1 text-xs text-muted-foreground">
                                {item.crop_name ||
                                  t("validation.cropUnavailable")}
                              </p>
                            </div>

                            <span
                              className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${confidenceConfig.classes}`}
                            >
                              {t(confidenceConfig.labelKey)}
                            </span>
                          </div>

                          {/* Confidence */}
                          <div className="mt-4">
                            <div className="mb-1.5 flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">
                                {t("validation.aiConfidence")}
                              </span>

                              <span className="text-xs font-semibold tabular-nums text-foreground">
                                {confidence !== null ? `${confidence}%` : "—"}
                              </span>
                            </div>

                            <div
                              className="h-1.5 overflow-hidden rounded-full bg-muted"
                              role="progressbar"
                              aria-valuenow={confidence ?? 0}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label={t("screening.confidenceAria", {
                                value: confidence ?? 0,
                              })}
                            >
                              {confidence !== null && (
                                <div
                                  className={`h-full rounded-full transition-[width] duration-300 ${confidenceConfig.bar}`}
                                  style={{
                                    width: `${confidence}%`,
                                  }}
                                />
                              )}
                            </div>
                          </div>

                          {/* Metadata */}
                          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                            <span>
                              {formatDate(
                                item.screened_at,
                                t,
                                i18n.language,
                              )}
                            </span>

                            {item.location_district && (
                              <span className="inline-flex items-center gap-1">
                                <MapPin
                                  className="h-3 w-3"
                                  aria-hidden="true"
                                />

                                {item.location_district}
                                {item.location_state
                                  ? `, ${item.location_state}`
                                  : ""}
                              </span>
                            )}
                          </div>
                        </div>

                        <ChevronIcon />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* ==================================================
              DETAIL
          =================================================== */}

          <section className="min-w-0">
            {detailLoading ? (
              <div className="flex min-h-[680px] items-center justify-center rounded-md border border-border bg-card">
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span
                    className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary"
                    aria-hidden="true"
                  />
                  {t("validation.loadingObservation")}
                </div>
              </div>
            ) : selectedObservation ? (
              <div className="overflow-hidden rounded-md border border-border bg-card lg:sticky lg:top-6">
                {/* Detail header */}
                <div className="border-b border-border px-5 py-5 sm:px-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                        {t("validation.observationReview")}
                      </p>

                      <h2 className="mt-1 truncate text-xl font-semibold tracking-tight text-foreground">
                        {formatClassName(
                          selectedObservation.predicted_class,
                          t,
                        )}
                      </h2>

                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("validation.observationReviewHelp")}
                      </p>
                    </div>

                    {selectedObservation.validation_status && (
                      <StatusBadge
                        status={
                          selectedObservation.validation_status === "VALIDATED"
                            ? "healthy"
                            : selectedObservation.validation_status ===
                                "REJECTED"
                              ? "danger"
                              : selectedObservation.validation_status ===
                                  "NEEDS_REVIEW"
                                ? "neutral"
                                : "warning"
                        }
                      >
                        {t(
                          STATUS_CONFIG[
                            selectedObservation.validation_status
                          ]?.labelKey,
                        ) || selectedObservation.validation_status}
                      </StatusBadge>
                    )}
                  </div>
                </div>

                <div className="max-h-[calc(100vh-190px)] overflow-y-auto">
                  <div className="space-y-6 p-5 sm:p-6">
                    {/* ==================================================
                        SCREENING IMAGE
                    =================================================== */}

                    <ImageEvidence
                      image={selectedObservation.image}
                      diseaseName={selectedObservation.predicted_class}
                    />

                    {/* ==================================================
                        OBSERVATION SUMMARY
                    =================================================== */}

                    <div>
                      <div className="mb-3 flex items-center gap-2">
                        <FileSearch
                          className="h-4 w-4 text-primary"
                          aria-hidden="true"
                        />

                        <h3 className="text-sm font-semibold text-foreground">
                          {t("validation.observationDetails")}
                        </h3>
                      </div>

                      <div className="overflow-hidden rounded-md border border-border">
                        <DetailRow
                          label={t("common.crop")}
                          value={
                            selectedObservation.crop_name ||
                            t("validation.notAvailable")
                          }
                        />

                        <DetailRow
                          label={t("screening.disease")}
                          value={formatClassName(
                            selectedObservation.predicted_class,
                            t,
                          )}
                        />

                        <DetailRow
                          label={t("validation.aiConfidence")}
                          value={formatConfidence(
                            selectedObservation.confidence,
                          )}
                          strong
                        />

                        <DetailRow
                          label={t("common.date")}
                          value={formatDate(
                            selectedObservation.screened_at,
                            t,
                            i18n.language,
                            true,
                          )}
                        />

                        {selectedObservation.location_district && (
                          <DetailRow
                            label={t("common.location")}
                            value={[
                              selectedObservation.location_district,
                              selectedObservation.location_state,
                            ]
                              .filter(Boolean)
                              .join(", ")}
                          />
                        )}
                      </div>
                    </div>

                    {/* ==================================================
                        VALIDATION FORM
                    =================================================== */}

                    <div className="border-t border-border pt-6">
                      <div className="mb-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          {t("validation.expertDecision")}
                        </p>

                        <h3 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
                          {t("validation.validationTitle")}
                        </h3>
                      </div>

                      <div className="space-y-5">
                        {/* Status */}
                        <div>
                          <label
                            htmlFor="validation-status"
                            className="mb-2 block text-sm font-medium text-foreground"
                          >
                            {t("validation.validationStatus")}
                          </label>

                          <select
                            id="validation-status"
                            value={validationForm.status}
                            onChange={(event) => {
                              const status = event.target.value;
                              setValidationForm((current) => ({
                                ...current,
                                status,
                                validated_class:
                                  status === "VALIDATED"
                                    ? current.validated_class
                                    : "",
                              }));
                            }}
                            disabled={submitting}
                            className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <option value="VALIDATED">
                              {t("validation.optionValidated")}
                            </option>

                            <option value="REJECTED">
                              {t("validation.optionRejected")}
                            </option>

                            <option value="NEEDS_REVIEW">
                              {t("validation.optionNeedsReview")}
                            </option>
                          </select>
                        </div>

                        {/* Corrected diagnosis */}
                        <div>
                          <label
                            htmlFor="validated-class"
                            className="mb-2 block text-sm font-medium text-foreground"
                          >
                            {t("validation.correctedDiagnosis")}
                          </label>

                          <input
                            id="validated-class"
                            type="text"
                            value={validationForm.validated_class}
                            onChange={(event) =>
                              setValidationForm((current) => ({
                                ...current,
                                validated_class: event.target.value,
                              }))
                            }
                            disabled={
                              submitting ||
                              validationForm.status !== "VALIDATED"
                            }
                            placeholder={t("validation.diagnosisPlaceholder")}
                            className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                          />

                          <p className="mt-1.5 text-xs text-muted-foreground">
                            {validationForm.status === "VALIDATED"
                              ? t("validation.leaveUnchanged")
                              : t("validation.notUsedWhenNone")}
                          </p>
                        </div>

                        {/* Notes */}
                        <div>
                          <label
                            htmlFor="review-notes"
                            className="mb-2 block text-sm font-medium text-foreground"
                          >
                            {t("validation.reviewNotes")}
                          </label>

                          <textarea
                            id="review-notes"
                            value={validationForm.review_notes}
                            onChange={(event) =>
                              setValidationForm((current) => ({
                                ...current,
                                review_notes: event.target.value,
                              }))
                            }
                            disabled={submitting}
                            rows={5}
                            placeholder={t("validation.notesPlaceholder")}
                            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                          />
                        </div>

                        {/* Submit error */}
                        {submitError && (
                          <div className="flex items-start gap-3 rounded-md border border-destructive/20 bg-destructive/5 p-3.5">
                            <AlertCircle
                              className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                              aria-hidden="true"
                            />

                            <p className="text-sm leading-relaxed text-destructive">
                              {submitError}
                            </p>
                          </div>
                        )}

                        {/* Submit */}
                        <button
                          type="button"
                          onClick={submitValidation}
                          disabled={submitting}
                          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {submitting && (
                            <span
                              className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                              aria-hidden="true"
                            />
                          )}

                          {submitting
                            ? t("validation.submitting")
                            : t("validation.submitValidation")}
                        </button>
                      </div>
                    </div>

                    {/* ==================================================
                        PREVIOUS VALIDATION
                    =================================================== */}

                    {selectedObservation.validation_status &&
                      selectedObservation.validation_status !== "PENDING" && (
                        <div className="rounded-md border border-primary/20 bg-primary/5 p-4">
                          <div className="flex items-start gap-3">
                            <ShieldCheck
                              className="mt-0.5 h-5 w-5 shrink-0 text-primary"
                              aria-hidden="true"
                            />

                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-foreground">
                                {t("validation.previouslyReviewed")}
                              </p>

                              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                                {selectedObservation.reviewer_role ||
                                  t("validation.expert")}{" "}
                                ·{" "}
                                {formatDate(
                                  selectedObservation.reviewed_at,
                                  t,
                                  i18n.language,
                                  true,
                                )}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                  </div>
                </div>
              </div>
            ) : (
              /* ==================================================
                 EMPTY DETAIL
              =================================================== */

              <div className="flex min-h-[680px] flex-col items-center justify-center rounded-md border border-dashed border-border bg-card px-8 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-muted/50">
                  <FileSearch
                    className="h-6 w-6 text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>

                <p className="mt-5 text-base font-semibold text-foreground">
                  {t("validation.selectItem")}
                </p>

                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  {t("validation.selectItemHelp")}
                </p>

                <div className="mt-5 flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  {t("validation.observationsAvailable", {
                    count: queue.length,
                  })}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

/* ============================================================
   SMALL UI COMPONENTS
   ============================================================ */

const StatusBadge = ({ status, children }) => {
  const classes = {
    healthy: "border-primary/25 bg-primary/10 text-primary",
    danger: "border-destructive/20 bg-destructive/10 text-destructive",
    neutral: "border-border bg-muted text-muted-foreground",
    warning: "border-accent/25 bg-accent/15 text-accent-foreground",
  };

  return (
    <span
      className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${
        classes[status] || classes.neutral
      }`}
    >
      {children}
    </span>
  );
};

const SummaryPill = ({ label, value, active = false }) => {
  return (
    <div
      className={`rounded-md border px-3 py-2 ${
        active ? "border-primary/25 bg-primary/5" : "border-border bg-card"
      }`}
    >
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>

      <span
        className={`ml-2 text-sm font-semibold tabular-nums ${
          active ? "text-primary" : "text-foreground"
        }`}
      >
        {value}
      </span>
    </div>
  );
};

const DetailRow = ({ label, value, strong = false }) => {
  return (
    <div className="flex flex-col gap-1 border-b border-border px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <span className="text-xs text-muted-foreground">{label}</span>

      <span
        className={`text-sm ${
          strong
            ? "font-semibold tabular-nums text-foreground"
            : "font-medium text-foreground"
        } sm:text-right`}
      >
        {value}
      </span>
    </div>
  );
};

const ChevronIcon = () => {
  return <ChevronRightIcon />;
};

const ChevronRightIcon = () => {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
      aria-hidden="true"
    >
      <path
        d="M7.5 4.5 13 10l-5.5 5.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export default ExpertValidation;
