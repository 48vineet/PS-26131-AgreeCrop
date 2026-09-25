import { Leaf, LogOut } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import Avatar from "./Avatar";
import LanguageSelector from "./LanguageSelector";

export default function Sidebar({
  navItems,
  basePath,
  appName,
  appTagline,
  profileName,
  profileLabel,
  logoutLabel,
  onSignOut,
  onNavigate,
}) {
  const location = useLocation();
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* ========================================================
          BRAND
         ======================================================== */}

      <div
        className="
          flex
          h-16
          shrink-0
          items-center
          gap-2.5
          border-b
          border-sidebar-border
          px-5
        "
      >
        <div
          className="
            flex
            h-8
            w-8
            shrink-0
            items-center
            justify-center
            rounded-md
            bg-primary
          "
        >
          <Leaf className="text-white" size={18} aria-hidden="true" />
        </div>

        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
            {appName}
          </p>

          <p className="truncate text-xs text-muted-foreground">{appTagline}</p>
        </div>
      </div>

      {/* ========================================================
          NAVIGATION
         ======================================================== */}

      <nav
        className="
          flex-1
          space-y-0.5
          overflow-y-auto
          px-3
          py-4
        "
        aria-label={t("common.mainNavigation")}
      >
        {navItems.map((item) => {
          const Icon = item.icon;

          const target = `${basePath}/${item.path}`;

          const isActive =
            location.pathname === target ||
            location.pathname.startsWith(`${target}/`);

          return (
            <Link
              key={item.path}
              to={target}
              onClick={onNavigate}
              aria-current={isActive ? "page" : undefined}
              className={`
                group
                flex
                items-center
                gap-3
                rounded-md
                border-l-2
                py-2.5
                pl-3
                pr-3
                text-sm
                font-medium
                transition-colors
                duration-150

                focus-visible:outline-none
                focus-visible:ring-2
                focus-visible:ring-primary
                focus-visible:ring-offset-1
                focus-visible:ring-offset-sidebar

                ${
                  isActive
                    ? `
                      border-l-primary
                      bg-primary/10
                      text-primary
                    `
                    : `
                      border-l-transparent
                      text-sidebar-foreground/75
                      hover:bg-sidebar-accent/60
                      hover:text-sidebar-foreground
                    `
                }
              `}
            >
              <Icon
                size={18}
                className={
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground group-hover:text-sidebar-foreground"
                }
                aria-hidden="true"
              />

              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* ========================================================
          FOOTER / USER CONTROLS
         ======================================================== */}

      <div
        className="
          shrink-0
          space-y-0.5
          border-t
          border-sidebar-border
          px-3
          py-3
        "
      >
        {/* Language */}
        <LanguageSelector variant="sidebar" />

        {/* Profile */}
        <Link
          to={`${basePath}/profile`}
          onClick={onNavigate}
          className="
            flex
            h-10
            items-center
            gap-3
            rounded-md
            px-3
            text-sm
            font-medium
            text-sidebar-foreground/75
            transition-colors
            duration-150
            hover:bg-sidebar-accent/60
            hover:text-sidebar-foreground

            focus-visible:outline-none
            focus-visible:ring-2
            focus-visible:ring-primary
            focus-visible:ring-offset-1
            focus-visible:ring-offset-sidebar
          "
        >
          <Avatar name={profileName} size="sm" />

          <span className="truncate">{profileName || profileLabel}</span>
        </Link>

        {/* Sign out */}
        <button
          type="button"
          onClick={onSignOut}
          className="
            flex
            h-10
            w-full
            items-center
            gap-3
            rounded-md
            px-3
            text-sm
            font-medium
            text-sidebar-foreground/75
            transition-colors
            duration-150
            hover:bg-destructive/10
            hover:text-destructive

            focus-visible:outline-none
            focus-visible:ring-2
            focus-visible:ring-primary
            focus-visible:ring-offset-1
            focus-visible:ring-offset-sidebar
          "
        >
          <LogOut
            size={18}
            className="text-muted-foreground"
            aria-hidden="true"
          />

          {logoutLabel}
        </button>
      </div>
    </div>
  );
}
