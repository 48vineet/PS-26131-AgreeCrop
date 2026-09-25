import { ImageOff, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import RiskIndicator from "./RiskIndicator";

export default function DiseaseResultPanel({
  imageUrl,
  diseaseName,
  confidence,
  riskLevel,
  riskReason,
  cropName,
  farmName,
  className = "",
}) {
  const { t } = useTranslation();
  const confidencePct =
    typeof confidence === "number" && !Number.isNaN(confidence)
      ? Math.round(Math.min(1, Math.max(0, confidence)) * 100)
      : null;

  const caption = [cropName, farmName].filter(Boolean).join(" • ");

  return (
    <div
      className={`
        overflow-hidden
        rounded-md
        border
        border-border
        bg-card
        text-card-foreground
        ${className}
      `}
    >
      <div className="p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,220px)_1fr]">
          {/* ==================================================
              SCREENED IMAGE
             ================================================== */}

          <div>
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={
                  diseaseName
                    ? t("weather.screenedImageAlt", { disease: diseaseName })
                    : t("weather.screenedImageAltGeneric")
                }
                className="
                  aspect-square
                  w-full
                  rounded-md
                  border
                  border-border
                  bg-background
                  object-cover
                "
              />
            ) : (
              <div
                className="
                  flex
                  aspect-square
                  w-full
                  items-center
                  justify-center
                  rounded-md
                  border
                  border-border
                  bg-background
                "
                role="img"
                aria-label={t("weather.noScreenedImage")}
              >
                <ImageOff
                  className="h-8 w-8 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
            )}

            {caption && (
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {caption}
              </p>
            )}
          </div>

          {/* ==================================================
              RESULT DETAILS
             ================================================== */}

          <div className="min-w-0">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              {t("weather.resultPanelCaption")}
            </p>

            <h3 className="text-xl font-semibold tracking-tight text-foreground">
              {diseaseName || t("weather.resultUnavailable")}
            </h3>

            {/* Confidence */}
            {confidencePct !== null && (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("weather.confidenceLabel")}
                  </span>

                  <span className="text-sm font-semibold tabular-nums text-foreground">
                    {confidencePct}%
                  </span>
                </div>

                <div
                  className="
                    h-1.5
                    w-full
                    overflow-hidden
                    rounded-full
                    bg-muted
                  "
                  role="progressbar"
                  aria-valuenow={confidencePct}
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-label={t("weather.confidenceAria", {
                    value: confidencePct,
                  })}
                >
                  <div
                    className="
                      h-full
                      rounded-full
                      bg-primary
                      transition-[width]
                      duration-500
                      ease-out
                    "
                    style={{ width: `${confidencePct}%` }}
                  />
                </div>
              </div>
            )}

            {/* Risk — only rendered when a real risk assessment exists */}
            {riskLevel && (
              <div className="mt-5">
                <RiskIndicator level={riskLevel} />

                {riskReason && (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {riskReason}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ======================================================
          DISCLAIMER
         ====================================================== */}

      <div
        className="
          flex
          items-start
          gap-2.5
          border-t
          border-border
          bg-background/40
          px-6
          py-3.5
          text-xs
          leading-5
          text-muted-foreground
        "
      >
        <Info
          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />

        <p>{t("weather.screeningDisclaimer")}</p>
      </div>
    </div>
  );
}
