import {
  Camera,
  ClipboardList,
  ImagePlus,
  Leaf,
  Loader2,
  RefreshCw,
  Sprout,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import AdvisoryStepPanel from "../components/ui/AdvisoryStepPanel";
import AiFallbackPanel from "../components/ui/AiFallbackPanel";
import Alert from "../components/ui/Alert";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import DiseaseResultPanel from "../components/ui/DiseaseResultPanel";
import ErrorState from "../components/ui/ErrorState";
import PageHeader from "../components/ui/PageHeader";
import SectionHeader from "../components/ui/SectionHeader";
import Select from "../components/ui/Select";
import Checkbox from "../components/ui/Checkbox";
import Skeleton from "../components/ui/Skeleton";
import api from "../services/api";
import { buildSteps } from "../utils/advisoryHelpers";

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

function formatDiseaseLabel(predictedClass, t) {
  if (!predictedClass) return t("diseaseScreening.resultUnavailable");

  const part = predictedClass.includes("___")
    ? predictedClass.split("___")[1]
    : predictedClass;

  const cleaned = part.replace(/_/g, " ").replace(/\s+/g, " ").trim();

  if (/^healthy$/i.test(cleaned)) {
    return t("diseaseScreening.noDiseaseDetected");
  }

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function formatCropLabel(cropName) {
  if (!cropName) return "";
  return cropName.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeConfidence(confidence) {
  if (typeof confidence !== "number" || Number.isNaN(confidence)) {
    return null;
  }
  if (confidence > 1) {
    return confidence / 100;
  }
  return confidence;
}

function isHealthyClass(diseaseClass) {
  if (!diseaseClass) return false;
  const part = diseaseClass.includes("___")
    ? diseaseClass.split("___")[1]
    : diseaseClass;
  return /^healthy$/i.test(part.replace(/_/g, " ").trim());
}

function validateFile(file, t) {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return t("diseaseScreening.useSupportedPhoto");
  }

  if (file.size > MAX_FILE_BYTES) {
    return t("diseaseScreening.photoTooLarge");
  }

  return null;
}

export default function DiseaseScreening() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [step, setStep] = useState("upload"); // upload | ready | analyzing | result
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [fileError, setFileError] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const [farms, setFarms] = useState({ status: "loading", data: [] });
  const [farmId, setFarmId] = useState("");
  const [cropId, setCropId] = useState("");
  const [cropName, setCropName] = useState("");
  const [cropError, setCropError] = useState("");
  const [addingCrop, setAddingCrop] = useState(false);

  const [result, setResult] = useState(null);
  const [submitError, setSubmitError] = useState("");

  const [advisories, setAdvisories] = useState({ status: "idle", data: null });
  const [observationId, setObservationId] = useState(null);
  const [consentReview, setConsentReview] = useState(false);
  const [consentTraining, setConsentTraining] = useState(false);

  const loadFarms = useCallback(async () => {
    setFarms((s) => ({ ...s, status: "loading" }));

    try {
      const res = await api.get("/profile/farms");
      const farmData = res.data || [];
      setFarms({ status: "ready", data: farmData });
      return farmData;
    } catch {
      setFarms({ status: "error", data: [] });
      return [];
    }
  }, []);

  useEffect(() => {
    loadFarms();
  }, [loadFarms]);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const selectedFarm = useMemo(
    () => farms.data.find((f) => String(f.id) === String(farmId)) || null,
    [farms.data, farmId],
  );

  const cropsForFarm = useMemo(() => selectedFarm?.crops || [], [selectedFarm]);

  const selectedCrop = useMemo(
    () => cropsForFarm.find((c) => String(c.id) === String(cropId)) || null,
    [cropsForFarm, cropId],
  );

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
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    acceptFile(e.dataTransfer.files?.[0]);
  };

  const loadAdvisoriesForScreening = useCallback(async (id) => {
    setAdvisories({ status: "loading", data: null });

    try {
      const res = await api.get(`/advisories/for-screening/${id}`, {
        params: { language: "en" },
      });
      setAdvisories({ status: "ready", data: res.data });
    } catch {
      setAdvisories({ status: "error", data: null });
    }
  }, []);

  const retryAdvisories = () => {
    if (observationId) loadAdvisoriesForScreening(observationId);
  };

  const handleAnalyze = async () => {
    if (!image) return;

    setStep("analyzing");
    setSubmitError("");

    const formData = new FormData();
    formData.append("file", image);
    formData.append("image_consent_review", consentReview ? "true" : "false");
    formData.append("image_consent_training", consentTraining ? "true" : "false");
    if (farmId) formData.append("farm_id", farmId);
    if (cropId) formData.append("crop_id", cropId);

    try {
      const res = await api.post("/predict", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      if (res.data?.success === false) {
        setSubmitError(
          res.data.message || t("diseaseScreening.screeningNotAvailable"),
        );
        setStep("ready");
        return;
      }

      setResult(res.data);
      setObservationId(res.data.observation_id || null);
      setStep("result");

      if (res.data.observation_id) {
        loadAdvisoriesForScreening(res.data.observation_id);
      }
    } catch (err) {
      setSubmitError(
        err.response?.data?.detail || t("diseaseScreening.couldntAnalyze"),
      );
      setStep("ready");
    }
  };

  const handleAddCrop = async () => {
    const name = cropName.trim();

    if (!farmId || !name || addingCrop) {
      return;
    }

    setAddingCrop(true);
    setCropError("");

    try {
      const response = await api.post(`/profile/farms/${farmId}/crops`, {
        crop_name: name,
      });
      const createdCrop = response.data;
      const farmData = await loadFarms();
      const refreshedFarm = farmData.find(
        (farm) => String(farm.id) === String(farmId),
      );
      const refreshedCrop =
        refreshedFarm?.crops?.find(
          (crop) => String(crop.id) === String(createdCrop.id),
        ) || createdCrop;

      setCropId(String(refreshedCrop.id));
      setCropName("");
    } catch (err) {
      setCropError(
        err.response?.data?.detail || t("diseaseScreening.couldntAddCrop"),
      );
    } finally {
      setAddingCrop(false);
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
    setObservationId(null);
    setAdvisories({ status: "idle", data: null });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const goToFollowUp = () => navigate("/farmer/monitoring");

  const advisorySteps = useMemo(
    () => buildSteps(advisories.data?.groups || [], t),
    [advisories.data, t],
  );

  const generalForCrop = advisories.data?.general_for_crop;

  // ============================================================
  // UPLOAD
  // ============================================================
  if (step === "upload") {
    return (
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-6 sm:px-6 lg:py-10">
        <PageHeader
          title={t("diseaseScreening.uploadTitle")}
          subtitle={t("diseaseScreening.uploadSubtitle")}
        />

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
              <ImagePlus className="h-6 w-6 text-primary" aria-hidden="true" />
            </span>

            <div>
              <p className="text-base font-semibold text-foreground">
                {t("diseaseScreening.dragPhoto")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("diseaseScreening.fileFormats")}
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
                {t("diseaseScreening.chooseFile")}
              </Button>

              <Button
                type="button"
                variant="ghost"
                icon={Camera}
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.setAttribute("capture", "environment");
                  fileInputRef.current?.click();
                }}
              >
                {t("diseaseScreening.useCamera")}
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
          <Alert variant="danger" title={t("diseaseScreening.couldntUsePhoto")}>
            {fileError}
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Leaf className="h-4 w-4 text-primary" aria-hidden="true" />
            </span>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("diseaseScreening.tipDaylight")}
            </p>
          </div>

          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Sprout className="h-4 w-4 text-primary" aria-hidden="true" />
            </span>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("diseaseScreening.tipSingleLeaf")}
            </p>
          </div>

          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <ClipboardList
                className="h-4 w-4 text-primary"
                aria-hidden="true"
              />
            </span>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("diseaseScreening.tipLinkFarm")}
            </p>
          </div>
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
          title={t("diseaseScreening.readyTitle")}
          subtitle={t("diseaseScreening.readySubtitle")}
        />

        {submitError && (
          <Alert variant="danger" title={t("diseaseScreening.couldntComplete")}>
            {submitError}
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,280px)_1fr]">
          <Card padding="p-4">
            <img
              src={preview}
              alt={t("diseaseScreening.selectedLeafAlt")}
              className="aspect-square w-full rounded-md border border-border object-cover"
            />
            <Button
              variant="ghost"
              size="sm"
              icon={RefreshCw}
              className="mt-3 w-full"
              onClick={handleReset}
            >
              {t("diseaseScreening.useDifferentPhoto")}
            </Button>
          </Card>

          <Card>
            <SectionHeader
              title={t("diseaseScreening.farmContext")}
              subtitle={t("diseaseScreening.farmContextSubtitle")}
            />

            {farms.status === "error" ? (
              <Alert variant="warning" title={t("diseaseScreening.couldntLoadFarms")}>
                {t("diseaseScreening.canScreenWithoutFarm")}
              </Alert>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Select
                  label={t("common.farm")}
                  value={farmId}
                  disabled={farms.status === "loading"}
                  onChange={(e) => {
                    setFarmId(e.target.value);
                    setCropId("");
                  }}
                >
                  <option value="">{t("diseaseScreening.noFarmSelected")}</option>
                  {farms.data.map((farm) => (
                    <option key={farm.id} value={farm.id}>
                      {farm.farm_name}
                    </option>
                  ))}
                </Select>

                <Select
                  label={t("common.crop")}
                  value={cropId}
                  onChange={(e) => setCropId(e.target.value)}
                  disabled={!farmId}
                  hint={!farmId ? t("diseaseScreening.chooseFarmFirst") : undefined}
                >
                  <option value="">{t("diseaseScreening.noCropSelected")}</option>
                  {cropsForFarm.map((crop) => (
                    <option key={crop.id} value={crop.id}>
                      {crop.crop_name}
                      {crop.variety ? ` — ${crop.variety}` : ""}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            {farmId && cropsForFarm.length === 0 && (
              <div className="mt-4 rounded-md border border-border bg-background p-4">
                <label
                  htmlFor="screening-crop-name"
                  className="mb-2 block text-sm font-medium text-foreground"
                >
                  {t("diseaseScreening.enterCropName")}
                </label>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    id="screening-crop-name"
                    type="text"
                    value={cropName}
                    onChange={(e) => {
                      setCropName(e.target.value);
                      setCropError("");
                    }}
                    placeholder={t("diseaseScreening.cropNamePlaceholder")}
                    className="h-10 min-w-0 flex-1 rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />

                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleAddCrop}
                    disabled={!cropName.trim() || addingCrop}
                  >
                    {addingCrop
                      ? t("diseaseScreening.adding")
                      : t("diseaseScreening.addCrop")}
                  </Button>
                </div>

                {cropError && (
                  <p className="mt-2 text-sm text-destructive">{cropError}</p>
                )}
              </div>
            )}

            <div className="mt-4 space-y-3">
              <Checkbox
                id="consent-review"
                label={t("diseaseScreening.consentReviewLabel")}
                checked={consentReview}
                onChange={(e) => setConsentReview(e.target.checked)}
              />
              <Checkbox
                id="consent-training"
                label={t("diseaseScreening.consentTrainingLabel")}
                checked={consentTraining}
                onChange={(e) => setConsentTraining(e.target.checked)}
              />
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={handleAnalyze}>
                {t("diseaseScreening.screenThisPhoto")}
              </Button>
              <Button variant="secondary" onClick={handleReset}>
                {t("diseaseScreening.cancel")}
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
            alt={t("diseaseScreening.analyzingAlt")}
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
              {t("diseaseScreening.screeningYourPhoto")}
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {t("diseaseScreening.screeningYourPhotoDesc")}
            </p>
          </div>
        </Card>
      </div>
    );
  }

  // ============================================================
  // RESULT
  // ============================================================
  const diseaseLabel = formatDiseaseLabel(result?.disease, t);
  const confidenceNorm = normalizeConfidence(result?.confidence);
  const healthy = isHealthyClass(result?.disease);
  const refNumber = result?.observation_id || observationId;

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-6 sm:px-6 lg:py-10">
      <PageHeader
        title={t("diseaseScreening.resultTitle")}
        subtitle={t("diseaseScreening.resultSubtitle")}
      />

      {result?.awaiting_officer_review && refNumber && (
        <Alert variant="info" title={t("diseaseScreening.awaitingReviewMessage")}>
          {t("diseaseScreening.submittedRefNumber", { refNumber })}{" "}
          {t("diseaseScreening.submittedSubtitle")}
        </Alert>
      )}

      <DiseaseResultPanel
        imageUrl={preview}
        diseaseName={diseaseLabel}
        confidence={confidenceNorm}
        cropName={formatCropLabel(selectedCrop?.crop_name)}
        farmName={selectedFarm?.farm_name}
      />

      {result?.crop_mismatch_warning && (
        <Alert
          variant="warning"
          title={t("diseaseScreening.cropMismatchTitle")}
        >
          {result.message ||
            t("diseaseScreening.cropMismatchBody", {
              predicted: formatCropLabel(result.predicted_crop),
              selected: formatCropLabel(result.submitted_crop || selectedCrop?.crop_name),
            })}
        </Alert>
      )}

      {result?.confidence_warning && !healthy && (
        <Alert variant="warning" title={t("diseaseScreening.lowConfidenceTitle")}>
          {t("diseaseScreening.lowConfidenceBody")}
        </Alert>
      )}

      {healthy && (
        <Alert variant="success" title={t("diseaseScreening.healthyTitle")}>
          {t("diseaseScreening.healthyBody")}
        </Alert>
      )}

      <Card>
        <SectionHeader
          title={t("diseaseScreening.recommendedAction")}
          subtitle={t("diseaseScreening.recommendedActionSubtitle")}
        />

        {advisories.status === "loading" && (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}

        {advisories.status === "error" && (
          <ErrorState
            title={t("diseaseScreening.couldntLoadGuidance")}
            description={t("diseaseScreening.couldntLoadGuidanceDesc")}
            onRetry={retryAdvisories}
          />
        )}

        {advisories.status === "ready" && (
          <div className="space-y-6">
            {advisorySteps.length > 0 ? (
              <AdvisoryStepPanel steps={advisorySteps} />
            ) : (
              advisories.data?.no_match_reason && (
                <Alert variant="info" title={t("diseaseScreening.noAdvisoryMatched")}>
                  {advisories.data.no_match_reason}
                </Alert>
              )
            )}

            {generalForCrop && generalForCrop.total > 0 && (
              <div>
                <SectionHeader title={t("diseaseScreening.generalPractice")} />
                <div className="space-y-3">
                  {generalForCrop.advisories.map((advisory) => (
                    <div
                      key={advisory.advisory_id}
                      className="rounded-md border border-border bg-background p-4 text-sm leading-relaxed text-muted-foreground"
                    >
                      {advisory.recommendation}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {advisories.data?.ai_fallback && (
              <AiFallbackPanel fallback={advisories.data.ai_fallback} />
            )}
          </div>
        )}
      </Card>

      <Card>
        <SectionHeader title={t("diseaseScreening.keepTrackTitle")} />
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("diseaseScreening.keepTrackBody")}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button variant="secondary" onClick={goToFollowUp}>
            {t("diseaseScreening.goToMonitoring")}
          </Button>
          <Button variant="secondary" onClick={handleReset}>
            {t("diseaseScreening.screenAnother")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
