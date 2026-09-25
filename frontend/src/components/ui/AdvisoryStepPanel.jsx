import { AlertTriangle, Bug, FlaskConical, Leaf } from "lucide-react";

import StatusBadge from "./StatusBadge";

const TIER_CONFIG = {
  cultural: {
    icon: Leaf,
    iconColor: "text-primary",
    iconBg: "bg-primary/10",
    circleBg: "bg-primary",
  },

  biological: {
    icon: Bug,
    iconColor: "text-secondary",
    iconBg: "bg-secondary/10",
    circleBg: "bg-secondary",
  },

  chemical: {
    icon: FlaskConical,
    iconColor: "text-accent-foreground",
    iconBg: "bg-accent/15",
    circleBg: "bg-accent",
  },
};

export default function AdvisoryStepPanel({ steps, className = "" }) {
  if (!steps || steps.length === 0) {
    return (
      <div
        className={`
          bg-card
          border border-border
          rounded-md
          p-5
          text-sm
          text-muted-foreground
          ${className}
        `}
      >
        No management steps available yet.
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {steps.map((step) => {
        const tierConfig = TIER_CONFIG[step.tier] || TIER_CONFIG.cultural;

        const Icon = tierConfig.icon;

        const showSafetyNotes =
          step.tier === "chemical" &&
          step.safetyNotes &&
          step.safetyNotes.length > 0;

        return (
          <div
            key={step.order}
            className="
              group
              bg-card
              border border-border
              rounded-md
              p-5
              transition-all
              duration-200
              hover:border-muted-foreground/30
            "
          >
            {/* ==================================================
                HEADER
               ================================================== */}

            <div className="flex items-center gap-3 min-w-0">
              {/* Step number */}
              <span
                className={`
                  flex
                  h-7
                  w-7
                  shrink-0
                  items-center
                  justify-center
                  rounded-full
                  text-xs
                  font-semibold
                  tabular-nums
                  text-white
                  ${tierConfig.circleBg}
                `}
                aria-hidden="true"
              >
                {step.order}
              </span>

              {/* Tier icon */}
              <span
                className={`
                  flex
                  h-8
                  w-8
                  shrink-0
                  items-center
                  justify-center
                  rounded-md
                  ${tierConfig.iconBg}
                `}
              >
                <Icon
                  className={`h-[17px] w-[17px] ${tierConfig.iconColor}`}
                  aria-hidden="true"
                />
              </span>

              {/* Title */}
              <h4 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight text-foreground">
                {step.title}
              </h4>

              {/* Status */}
              {step.recommended ? (
                <StatusBadge status="healthy" className="ml-auto shrink-0">
                  Recommended
                </StatusBadge>
              ) : step.tier === "chemical" ? (
                <StatusBadge status="warning" className="ml-auto shrink-0">
                  Last resort
                </StatusBadge>
              ) : null}
            </div>

            {/* ==================================================
                DESCRIPTION
               ================================================== */}

            <div className="ml-[76px] mt-3">
              <p className="text-sm leading-6 text-muted-foreground">
                {step.description}
              </p>
            </div>

            {/* ==================================================
                CHEMICAL SAFETY NOTES
               ================================================== */}

            {showSafetyNotes && (
              <div
                className="
                  ml-[76px]
                  mt-4
                  rounded-md
                  border border-accent/25
                  bg-accent/10
                  px-3.5
                  py-3
                "
              >
                <div className="mb-2 flex items-center gap-2">
                  <AlertTriangle
                    className="h-4 w-4 shrink-0 text-accent-foreground"
                    aria-hidden="true"
                  />

                  <span className="text-xs font-semibold uppercase tracking-wide text-accent-foreground">
                    Safety
                  </span>
                </div>

                <ul className="space-y-2">
                  {step.safetyNotes.map((note, index) => (
                    <li
                      key={index}
                      className="
                        flex
                        items-start
                        gap-2
                        text-xs
                        leading-5
                        text-muted-foreground
                      "
                    >
                      <span
                        className="
                          mt-[7px]
                          h-1
                          w-1
                          shrink-0
                          rounded-full
                          bg-accent
                        "
                        aria-hidden="true"
                      />

                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
