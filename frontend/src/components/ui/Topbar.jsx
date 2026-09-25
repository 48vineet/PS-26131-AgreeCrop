import { Leaf, Menu, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import Avatar from "./Avatar";
import LanguageSelector from "./LanguageSelector";

export default function Topbar({
  appName,
  open,
  onToggle,
  profileName,
  profilePath,
}) {
  const { t } = useTranslation();

  return (
    <div
      className="
        fixed
        left-0
        right-0
        top-0
        z-40
        flex
        h-14
        items-center
        justify-between
        border-b
        border-border
        bg-background/95
        px-4
        backdrop-blur-sm
        lg:hidden
      "
    >
      {/* Menu toggle */}
      <button
        type="button"
        onClick={onToggle}
        aria-label={open ? t("common.closeMenu") : t("common.openMenu")}
        aria-expanded={open}
        className="
          -ml-2
          rounded-md
          p-2
          text-foreground
          transition-colors
          duration-150
          hover:bg-muted
          focus-visible:outline-none
          focus-visible:ring-2
          focus-visible:ring-primary
          focus-visible:ring-offset-2
          focus-visible:ring-offset-background
        "
      >
        {open ? (
          <X size={20} aria-hidden="true" />
        ) : (
          <Menu size={20} aria-hidden="true" />
        )}
      </button>

      {/* Brand */}
      <div className="flex items-center gap-2">
        <div
          className="
            flex
            h-6
            w-6
            items-center
            justify-center
            rounded-md
            bg-primary
          "
        >
          <Leaf className="text-white" size={13} aria-hidden="true" />
        </div>

        <span
          className="
            max-w-[160px]
            truncate
            text-sm
            font-semibold
            tracking-tight
            text-foreground
          "
        >
          {appName}
        </span>
      </div>

      {/* Language + profile */}
      <div className="flex items-center gap-1.5">
        <LanguageSelector variant="topbar" />

        <Link
          to={profilePath}
          aria-label={t("common.viewProfile")}
          className="
            rounded-full
            focus-visible:outline-none
            focus-visible:ring-2
            focus-visible:ring-primary
            focus-visible:ring-offset-2
            focus-visible:ring-offset-background
          "
        >
          <Avatar name={profileName} size="sm" />
        </Link>
      </div>
    </div>
  );
}
