import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

const VARIANTS = {
  success: {
    icon: CheckCircle2,
    classes: "bg-primary/10 border-primary/25 text-foreground",
    iconClass: "text-primary",
  },

  warning: {
    icon: AlertTriangle,
    classes: "bg-accent/10 border-accent/25 text-foreground",
    iconClass: "text-accent-foreground",
  },

  danger: {
    icon: XCircle,
    classes: "bg-destructive/10 border-destructive/20 text-foreground",
    iconClass: "text-destructive",
  },

  info: {
    icon: Info,
    classes: "bg-muted/50 border-border text-foreground",
    iconClass: "text-muted-foreground",
  },
};

export default function Alert({
  variant = "info",
  title,
  children,
  onDismiss,
  className = "",
}) {
  const cfg = VARIANTS[variant] || VARIANTS.info;
  const Icon = cfg.icon;
  const { t } = useTranslation();

  return (
    <div
      role="alert"
      className={`
        flex
        items-start
        gap-3
        rounded-md
        border
        px-4
        py-3.5
        ${cfg.classes}
        ${className}
      `}
    >
      {/* Icon */}
      <Icon
        className={`
          h-5
          w-5
          shrink-0
          mt-0.5
          ${cfg.iconClass}
        `}
        aria-hidden="true"
      />

      {/* Content */}
      <div className="min-w-0 flex-1">
        {title && (
          <p className="text-sm font-semibold tracking-tight text-foreground">
            {title}
          </p>
        )}

        {children && (
          <div
            className={`
              text-sm
              leading-5
              ${title ? "mt-1" : ""}
              text-muted-foreground
            `}
          >
            {children}
          </div>
        )}
      </div>

      {/* Dismiss */}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("common.dismiss")}
          className="
            shrink-0
            rounded-sm
            p-1
            text-muted-foreground
            transition-colors
            duration-150
            hover:bg-foreground/5
            hover:text-foreground
            focus-visible:outline-none
            focus-visible:ring-2
            focus-visible:ring-primary
          "
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
