import {
  AlertCircle,
  Bug,
  Camera,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Alert from "../components/ui/Alert";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import PageHeader from "../components/ui/PageHeader";
import SectionHeader from "../components/ui/SectionHeader";
import Select from "../components/ui/Select";
import Skeleton from "../components/ui/Skeleton";
import StatusBadge from "../components/ui/StatusBadge";
import { useAuth } from "../contexts/AuthContext";
import api from "../services/api";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

const CROPS = [
  "Rice",
  "Wheat",
  "Cotton",
  "Tomato",
  "Potato",
  "Corn",
  "Soybean",
  "Sugarcane",
];

const SEVERITY_STATUS = {
  high: "danger",
  medium: "warning",
  low: "info",
};

// Module-scope, so it takes `t` rather than calling it: the messages have to
// follow the active language, not be frozen in English here.
function validateFile(file, t) {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return t("pest.photoInvalid");
  }

  if (file.size > MAX_FILE_BYTES) {
    return t("pest.photoTooLarge");
  }

  return null;
}

// Module-scope, so it takes `t` rather than calling it: the "Unknown" fallback
// has to follow the active language, not be frozen in English here.
function formatSeverity(severity, t) {
  if (!severity) return t("common.unknown");
  return severity.charAt(0).toUpperCase() + severity.slice(1).toLowerCase();
}

export default function PestMonitoring() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [step, setStep] = useState("upload"); // upload | ready | analyzing | result
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [fileError, setFileError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [crop, setCrop] = useState("");

  const [result, setResult] = useState(null);
  const [submitError, setSubmitError] = useState("");

  const [reports, setReports] = useState({ status: "loading", data: [] });

  const loadReports = useCallback(async () => {
    setReports((s) => ({ ...s, status: "loading" }));

    try {
      const res = await api.get("/api/pest/my-reports", {
        params: { language: i18n.language },
      });
      setReports({ status: "ready", data: res.data || [] });
    } catch {
      setReports({ status: "error", data: [] });
    }
  }, [i18n.language]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const acceptFile = (file) => {
    if (!file) return;

    const problem = validateFile(file, t);
    if (problem) {
      setFileError(problem);
      return;
    }

    setFileError("");
    setImage(file);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
    setStep("ready");
  };

  const handleFileSelect = (e) => {
    acceptFile(e.target.files?.[0]);
    e.target.value = "";
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    acceptFile(e.dataTransfer.files?.[0]);
  };

  const handleAnalyze = async () => {
    if (!image || !crop) return;

    setStep("analyzing");
    setSubmitError("");

    const formData = new FormData();
    formData.append("file", image);
    formData.append("crop", crop);
    formData.append("language", i18n.language);

    try {
      const res = await api.post("/api/pest/identify", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setResult(res.data);
      setStep("result");
      loadReports();
    } catch (err) {
      setSubmitError(
        err.response?.data?.detail ||
          "Couldn't identify this photo. Try again.",
      );
      setStep("ready");
    }
  };

  const handleReset = () => {
    if (preview) URL.revokeObjectURL(preview);
    setStep("upload");
    setImage(null);
    setPreview(null);
    setFileError("");
    setSubmitError("");
    setResult(null);
    setCrop("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const goToFollowUp = () =>
    navigate(
      profile?.role === "extension_officer"
        ? "/extension/monitoring"
        : "/farmer/monitoring",
    );

  // ============================================================
  // UPLOAD
  // ============================================================
  if (step === "upload") {
    return (
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6 lg:py-10">
        <PageHeader
          title={t("pest.identifyTitle")}
          subtitle={t("pest.identifySubtitle")}
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6">
            <Card
              padding="p-0"
              className={`overflow-hidden ${isDragging ? "border-primary" : ""}`}
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className="flex cursor-pointer flex-col items-center gap-4 px-6 py-16 text-center transition-colors duration-150 hover:bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card sm:py-20"
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-background">
                  <Bug className="h-6 w-6 text-primary" aria-hidden="true" />
                </span>

                <div>
                  <p className="text-base font-semibold text-foreground">
                    {t("pest.dragPhoto")}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("pest.fileFormats")}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    icon={Upload}
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    {t("pest.chooseFile")}
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    icon={Camera}
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.setAttribute(
                        "capture",
                        "environment",
                      );
                      fileInputRef.current?.click();
                    }}
                  >
                    {t("pest.useCamera")}
                  </Button>
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES.join(",")}
                onChange={handleFileSelect}
                className="hidden"
              />
            </Card>

            {fileError && (
              <Alert variant="danger" title={t("pest.photoErrorTitle")}>
                {fileError}
              </Alert>
            )}

            <div className="flex items-start gap-3 rounded-md border border-border bg-card p-4">
              <ShieldAlert
                className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t("pest.identifyDisclaimer")}
              </p>
            </div>
          </div>

          <Card padding="p-5">
            <SectionHeader title={t("pest.recentReports")} />

            {reports.status === "loading" && (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            )}

            {reports.status === "error" && (
              <ErrorState
                title={t("pest.loadReportsFailed")}
                description={t("pest.loadReportsFailedHelp")}
                onRetry={loadReports}
              />
            )}

            {reports.status === "ready" && reports.data.length === 0 && (
              <EmptyState
                icon={Bug}
                title={t("pest.noReports")}
                description={t("pest.noReportsHelp")}
              />
            )}

            {reports.status === "ready" && reports.data.length > 0 && (
              <div className="space-y-3">
                {reports.data.slice(0, 5).map((report, idx) => (
                  <div
                    key={report.report_id ?? idx}
                    className="rounded-md border border-border p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-medium text-foreground">
                        {report.pest_name}
                      </p>
                      <StatusBadge
                        status={
                          SEVERITY_STATUS[report.severity?.toLowerCase()] ||
                          "neutral"
                        }
                      >
                        {formatSeverity(report.severity, t)}
                      </StatusBadge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {report.crop}
                      {report.date
                        ? ` ${t("common.on")} ${new Date(report.date).toLocaleDateString(i18n.language)}`
                        : ""}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    );
  }

  // ============================================================
  // READY
  // ============================================================
  if (step === "ready") {
    return (
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-6 sm:px-6 lg:py-10">
        <PageHeader
          title={t("pest.confirmTitle")}
          subtitle={t("pest.confirmSubtitle")}
        />

        {submitError && (
          <Alert variant="danger" title={t("pest.identifyFailedTitle")}>
            {submitError}
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,280px)_1fr]">
          <Card padding="p-4">
            <img
              src={preview}
              alt={t("pest.photoAlt")}
              className="aspect-square w-full rounded-md border border-border object-cover"
            />
            <Button
              variant="ghost"
              size="sm"
              icon={RefreshCw}
              className="mt-3 w-full"
              onClick={handleReset}
            >
              {t("pest.useDifferentPhoto")}
            </Button>
          </Card>

          <Card>
            <SectionHeader
              title={t("pest.cropContextTitle")}
              subtitle={t("pest.cropContextSubtitle")}
            />

            <Select
              label={t("pest.cropLabel")}
              value={crop}
              onChange={(e) => setCrop(e.target.value)}
            >
              <option value="">{t("pest.chooseCrop")}</option>
              {CROPS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={handleAnalyze} disabled={!crop}>
                {t("pest.identifyPest")}
              </Button>
              <Button variant="secondary" onClick={handleReset}>
                {t("common.cancel")}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  // ============================================================
  // ANALYZING
  // ============================================================
  if (step === "analyzing") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:py-10">
        <Card className="flex flex-col items-center gap-6 py-12 text-center">
          <img
            src={preview}
            alt={t("pest.identifyingAlt")}
            className="h-32 w-32 rounded-md border border-border object-cover"
          />

          <div
            role="status"
            aria-live="polite"
            className="flex flex-col items-center gap-2"
          >
            <Loader2
              className="h-6 w-6 animate-spin text-primary"
              aria-hidden="true"
            />
            <p className="text-base font-semibold text-foreground">
              {t("pest.identifyingTitle")}
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {t("pest.identifyingHelp", { crop })}
            </p>
          </div>
        </Card>
      </div>
    );
  }

  // ============================================================
  // RESULT
  // ============================================================
  const pestFound = !!result?.pest_found;
  const severityKey = result?.severity?.toLowerCase();

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-6 sm:px-6 lg:py-10">
      <PageHeader
        title={t("pest.resultTitle")}
        subtitle={t("pest.resultSubtitle", { crop })}
      />

      <Card>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,220px)_1fr]">
          <div>
            <img
              src={preview}
              alt={
                pestFound
                  ? t("pest.resultPhotoAlt", { pest: result.pest_name })
                  : t("pest.screenedPhotoAlt")
              }
              className="aspect-square w-full rounded-md border border-border object-cover"
            />
          </div>

          <div className="min-w-0">
            {pestFound ? (
              <>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {t("pest.pestIdentified")}
                </p>
                <h3 className="text-xl font-semibold tracking-tight text-foreground">
                  {result.pest_name}
                </h3>
                {result.pest_english && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {result.pest_english}
                  </p>
                )}

                {typeof result.confidence === "number" && (
                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-muted-foreground">
                        {t("screening.confidence")}
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-foreground">
                        {Math.round(Math.min(1, result.confidence) * 100)}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
                        style={{
                          width: `${Math.round(Math.min(1, result.confidence) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-md border border-border bg-background p-3">
                    <p className="text-xs text-muted-foreground">
                      {t("pest.damageType")}
                    </p>
                    <p className="mt-1.5 text-sm font-medium text-foreground">
                      {result.damage_type || t("pest.notSpecified")}
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-background p-3">
                    <p className="text-xs text-muted-foreground">
                      {t("common.severity")}
                    </p>
                    <div className="mt-1.5">
                      <StatusBadge
                        status={SEVERITY_STATUS[severityKey] || "neutral"}
                      >
                        {formatSeverity(result.severity, t)}
                      </StatusBadge>
                    </div>
                  </div>
                </div>

                {result.symptoms?.length > 0 && (
                  <div className="mt-5">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      {t("pest.symptomsToCheck")}
                    </p>
                    <ul className="space-y-2">
                      {result.symptoms.map((symptom, idx) => (
                        <li
                          key={idx}
                          className="flex items-start gap-2 text-sm leading-relaxed text-foreground"
                        >
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                          <span>{symptom}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <div className="flex min-h-48 flex-col items-center justify-center text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <CheckCircle2
                    className="h-6 w-6 text-primary"
                    aria-hidden="true"
                  />
                </span>
                <p className="mt-4 text-base font-semibold text-foreground">
                  {t("common.success")}
                </p>
                <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                  {t("pest.noPestFound")}
                </p>
              </div>
            )}
          </div>
        </div>

        {result?.damage_description && (
          <div className="mt-6 border-t border-border pt-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {result.damage_description}
            </p>
          </div>
        )}
      </Card>

      {pestFound && result.control_methods && (
        <section aria-label={t("pest.recommendedActionAria")}>
          <SectionHeader
            title={t("screening.recommendations")}
            subtitle={t("pest.recommendedActionSubtitle")}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card padding="p-4">
              <h3 className="text-sm font-semibold text-foreground">
                {t("screening.nonChemical")}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {result.control_methods.non_chemical ||
                  t("pest.noRecommendation")}
              </p>
            </Card>
            <Card padding="p-4">
              <h3 className="text-sm font-semibold text-foreground">
                {t("screening.biological")}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {result.control_methods.organic || t("pest.noRecommendation")}
              </p>
            </Card>
            <Card padding="p-4">
              <h3 className="text-sm font-semibold text-foreground">
                {t("screening.chemical")}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {result.control_methods.chemical ||
                  t("pest.noRecommendation")}
              </p>
            </Card>
          </div>

          {result.pesticide_recommendation && (
            <div className="mt-4">
              <Alert
                variant="warning"
                title={t("pest.recommendedPesticide")}
              >
                {result.pesticide_recommendation}
                {result.safety_period && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {t("pest.safetyPeriod", {
                      period: result.safety_period,
                    })}
                  </p>
                )}
              </Alert>
            </div>
          )}
        </section>
      )}

      {result?.monitoring_advice && (
        <Card>
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Clock className="h-5 w-5 text-primary" aria-hidden="true" />
            </span>
            <div>
              <p className="text-base font-semibold text-foreground">
                {t("pest.adviceTitle")}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {result.monitoring_advice}
              </p>
            </div>
          </div>
        </Card>
      )}

      <div className="flex items-start gap-2.5 rounded-md border border-border bg-background/60 px-4 py-3.5">
        <AlertCircle
          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <p className="text-xs leading-5 text-muted-foreground">
          {t("pest.historyNote")}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button onClick={goToFollowUp}>{t("pest.goToMonitoring")}</Button>
        <Button variant="secondary" onClick={handleReset}>
          {t("pest.identifyAnother")}
        </Button>
      </div>
    </div>
  );
}
