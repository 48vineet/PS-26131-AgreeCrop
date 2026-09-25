import { AlertTriangle, Flame, ShieldCheck, TriangleAlert } from "lucide-react";

const LEVELS = {
  low: {
    icon: ShieldCheck,
    color: "text-primary",
    bg: "bg-primary/10",
    border: "border-primary/25",
    bar: "bg-primary",
    label: "Low risk",
  },

  moderate: {
    icon: AlertTriangle,
    color: "text-accent-foreground",
    bg: "bg-accent/10",
    border: "border-accent/25",
    bar: "bg-accent",
    label: "Moderate risk",
  },

  high: {
    icon: TriangleAlert,
    color: "text-destructive",
    bg: "bg-destructive/10",
    border: "border-destructive/20",
    bar: "bg-destructive",
    label: "High risk",
  },

  critical: {
    icon: Flame,
    color: "text-destructive",
    bg: "bg-destructive/15",
    border: "border-destructive/30",
    bar: "bg-destructive",
    label: "Critical risk",
  },
};

export default function RiskIndicator({
  level = "low",
  score,
  className = "",
}) {
  const cfg = LEVELS[level] || LEVELS.low;
  const Icon = cfg.icon;

  const normalizedScore =
    typeof score === "number" ? Math.min(100, Math.max(0, score)) : null;

  return (
    <div
      className={`
        flex
        items-center
        gap-3
        rounded-md
        border
        px-3
        py-2.5
        ${cfg.border}
        ${cfg.bg}
        ${className}
      `}
    >
      <Icon
        className={`
          h-5
          w-5
          shrink-0
          ${cfg.color}
        `}
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        <p
          className={`
            text-sm
            font-semibold
            ${cfg.color}
          `}
        >
          {cfg.label}
        </p>

        {normalizedScore !== null && (
          <div
            className="
              mt-1.5
              h-1.5
              w-full
              overflow-hidden
              rounded-full
              bg-foreground/10
            "
            role="progressbar"
            aria-valuenow={normalizedScore}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-label={`${cfg.label} score ${normalizedScore}`}
          >
            <div
              className={`
                h-full
                rounded-full
                transition-[width]
                duration-300
                ${cfg.bar}
              `}
              style={{
                width: `${normalizedScore}%`,
              }}
            />
          </div>
        )}
      </div>

      {normalizedScore !== null && (
        <span
          className={`
            text-sm
            font-semibold
            tabular-nums
            ${cfg.color}
          `}
        >
          {normalizedScore}
        </span>
      )}
    </div>
  );
}
