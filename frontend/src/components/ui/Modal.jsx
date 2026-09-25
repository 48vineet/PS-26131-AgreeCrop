import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";

const SIZES = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
};

export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef(null);
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    panelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60]">
      {/* Backdrop */}
      <div
        className="
          fixed
          inset-0
          bg-foreground/35
          backdrop-blur-[2px]
        "
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal positioning */}
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          className={`
            relative
            w-full
            overflow-hidden
            rounded-md
            border
            border-border
            bg-card
            text-card-foreground
            shadow-[0_12px_30px_rgba(0,0,0,0.14)]
            focus:outline-none
            ${SIZES[size] || SIZES.md}
          `}
        >
          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="
              absolute
              right-4
              top-4
              z-10
              flex
              h-8
              w-8
              items-center
              justify-center
              rounded-md
              text-muted-foreground
              transition-colors
              duration-150
              hover:bg-muted
              hover:text-foreground
              focus-visible:outline-none
              focus-visible:ring-2
              focus-visible:ring-primary
              focus-visible:ring-offset-2
              focus-visible:ring-offset-card
            "
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>

          {/* Header */}
          {(title || description) && (
            <div className="px-6 pb-0 pt-6 pr-14">
              {title && (
                <h2
                  id={titleId}
                  className="
                    text-lg
                    font-semibold
                    tracking-tight
                    text-foreground
                  "
                >
                  {title}
                </h2>
              )}

              {description && (
                <p
                  id={descriptionId}
                  className="
                    mt-1
                    text-sm
                    leading-relaxed
                    text-muted-foreground
                  "
                >
                  {description}
                </p>
              )}
            </div>
          )}

          {/* Content */}
          <div
            className={`
              max-h-[70vh]
              overflow-y-auto
              ${title || description ? "px-6 pb-6 pt-4" : "p-6"}
            `}
          >
            {children}
          </div>

          {/* Footer */}
          {footer && (
            <div
              className="
                flex
                justify-end
                gap-3
                border-t
                border-border
                bg-background/30
                px-6
                py-4
              "
            >
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
