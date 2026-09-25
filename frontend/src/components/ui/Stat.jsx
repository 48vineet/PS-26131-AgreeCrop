import { ArrowDown, ArrowUp } from "lucide-react";

const ACCENTS = {
  primary: "border-l-primary",
  success: "border-l-primary",
  accent: "border-l-accent",
  warning: "border-l-accent",
  danger: "border-l-destructive",
  neutral: "border-l-muted-foreground",
};

export default function Stat({
  label,
  value,
  unit,
  icon: Icon,
  accent = "neutral",
  trend,
  className = "",
}) {
  const trendUp = typeof trend === "number" && trend > 0;

  const trendDown = typeof trend === "number" && trend < 0;

  const accentClass = ACCENTS[accent] || ACCENTS.neutral;

  return (
    <div
      className={`
        rounded-md
        border
        border-border
        border-l-2
        bg-card
        p-5
        text-card-foreground
        ${accentClass}
        ${className}
      `}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>

        {Icon && (
          <Icon
            className="
              h-5
              w-5
              shrink-0
              text-muted-foreground
            "
            aria-hidden="true"
          />
        )}
      </div>

      {/* Value */}
      <div className="mt-2 flex items-baseline gap-1.5">
        <span
          className="
            text-3xl
            font-semibold
            tracking-tight
            text-foreground
            tabular-nums
          "
        >
          {value}
        </span>

        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </div>

      {/* Trend */}
      {typeof trend === "number" && (
        <div
          className={`
            mt-2
            inline-flex
            items-center
            gap-1
            text-xs
            font-medium

            ${
              trendUp
                ? "text-primary"
                : trendDown
                  ? "text-destructive"
                  : "text-muted-foreground"
            }
          `}
        >
          {trendUp && <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />}

          {trendDown && (
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          )}

          <span className="tabular-nums">{Math.abs(trend)}%</span>

          <span className="font-normal text-muted-foreground">
            vs last period
          </span>
        </div>
      )}
    </div>
  );
}
