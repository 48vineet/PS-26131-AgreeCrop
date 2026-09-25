import { ChevronDown, Globe } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useLanguage } from "../../contexts/LanguageContext";

/* The one language selector. Sidebar, mobile topbar, login, signup and profile
   all render this; none of them keeps its own language state. `variant` only
   changes where the menu drops and how the trigger is tinted. */
const STYLES = {
  sidebar: {
    trigger:
      "flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm font-medium " +
      "text-sidebar-foreground/75 transition-colors duration-150 " +
      "hover:bg-sidebar-accent/60 hover:text-sidebar-foreground " +
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " +
      "focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar",
    menu: "absolute bottom-full left-0 right-0 z-10 mb-1",
    label: "flex-1 text-left",
  },
  topbar: {
    trigger:
      "flex h-9 items-center gap-1.5 rounded-md px-2 text-xs font-medium " +
      "text-foreground transition-colors duration-150 hover:bg-muted " +
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " +
      "focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    menu: "absolute right-0 z-10 mt-1 w-40",
    label: "",
  },
  panel: {
    trigger:
      "flex h-10 w-full items-center gap-3 rounded-md border border-border " +
      "bg-background px-3 text-sm font-medium text-foreground " +
      "transition-colors duration-150 hover:bg-muted " +
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " +
      "focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    menu: "absolute right-0 z-10 mt-1 w-44",
    label: "flex-1 text-left",
  },
};

export default function LanguageSelector({ variant = "panel", className = "" }) {
  const { languages, currentLanguage, changeLanguage } = useLanguage();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const styles = STYLES[variant] || STYLES.panel;

  useEffect(() => {
    if (!open) return;

    const handleClick = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const current = languages.find((item) => item.code === currentLanguage);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {open && (
        <div
          className={`
            overflow-hidden
            rounded-md
            border
            border-border
            bg-popover
            py-1
            shadow-[0_6px_15px_rgba(0,0,0,0.10)]
            ${styles.menu}
          `}
        >
          {languages.map((language) => {
            const isSelected = language.code === currentLanguage;

            return (
              <button
                key={language.code}
                type="button"
                onClick={() => {
                  changeLanguage(language.code);
                  setOpen(false);
                }}
                className={`
                  w-full
                  px-3
                  py-2
                  text-left
                  text-sm
                  transition-colors
                  duration-150

                  ${
                    isSelected
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-foreground hover:bg-muted"
                  }
                `}
              >
                {language.label}
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={current?.label || "English"}
        className={styles.trigger}
      >
        <Globe
          size={variant === "topbar" ? 16 : 18}
          className="text-muted-foreground"
          aria-hidden="true"
        />

        <span className={styles.label}>
          {variant === "topbar" ? currentLanguage.toUpperCase() : current?.label}
        </span>

        <ChevronDown
          size={14}
          className={`
            text-muted-foreground
            transition-transform
            duration-150
            ${open ? "rotate-180" : ""}
          `}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
