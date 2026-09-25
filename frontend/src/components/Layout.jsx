import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

import Sidebar from "./ui/Sidebar";
import Topbar from "./ui/Topbar";

import {
  Activity,
  BarChart3,
  Bug,
  Camera,
  CheckCircle,
  CloudRain,
  FileText,
  LayoutDashboard,
  Leaf,
  Map,
} from "lucide-react";

const Layout = ({ children, role }) => {
  const { t } = useTranslation();
  const { profile, signOut } = useAuth();
  const location = useLocation();

  const [sidebarOpen, setSidebarOpen] = useState(false);

  /* ============================================================
     CLOSE MOBILE SIDEBAR WHEN ROUTE CHANGES
     ============================================================ */

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  /* ============================================================
     NAVIGATION
     ============================================================ */

  const getNavItems = () => {
    const baseItems = [
      {
        path: "dashboard",
        icon: LayoutDashboard,
        label: t("nav.dashboard"),
      },
    ];

    const farmerItems = [
      {
        path: "farms",
        icon: Leaf,
        label: t("nav.farms"),
      },
      {
        path: "screening",
        icon: Camera,
        label: t("nav.screening"),
      },
      {
        path: "pest-monitoring",
        icon: Bug,
        label: t("nav.pestMonitoring"),
      },
      {
        path: "weather",
        icon: CloudRain,
        label: t("nav.weather"),
      },
      {
        path: "advisories",
        icon: FileText,
        label: t("nav.advisories"),
      },
      {
        path: "monitoring",
        icon: Activity,
        label: t("nav.monitoring"),
      },
    ];

    const extensionItems = [
      {
        path: "validation",
        icon: CheckCircle,
        label: t("nav.validation"),
      },
      {
        path: "map",
        icon: Map,
        label: t("nav.map"),
      },
      {
        path: "pest-monitoring",
        icon: Bug,
        label: t("nav.pestMonitoring"),
      },
      {
        path: "weather",
        icon: CloudRain,
        label: t("nav.weather"),
      },
      {
        path: "advisories",
        icon: FileText,
        label: t("nav.advisories"),
      },
      {
        path: "monitoring",
        icon: Activity,
        label: t("nav.monitoring"),
      },
    ];

    const officialItems = [
      {
        path: "map",
        icon: Map,
        label: t("nav.map"),
      },
      {
        path: "analytics",
        icon: BarChart3,
        label: t("nav.analytics"),
      },
      {
        path: "advisories",
        icon: FileText,
        label: t("nav.advisories"),
      },
    ];

    switch (role) {
      case "extension_officer":
        return [...baseItems, ...extensionItems];

      case "official":
        return [...baseItems, ...officialItems];

      default:
        return [...baseItems, ...farmerItems];
    }
  };

  const navItems = getNavItems();

  /* ============================================================
     ROLE BASE PATH
     ============================================================ */

  const basePath =
    role === "extension_officer"
      ? "/extension"
      : role === "official"
        ? "/official"
        : "/farmer";

  /* ============================================================
     SIGN OUT
     ============================================================ */

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  /* ============================================================
     SIDEBAR PROPS
     ============================================================ */

  const sidebarProps = {
    navItems,
    basePath,
    appName: t("app.name"),
    appTagline: t("app.tagline"),
    profileName: profile?.name,
    profileLabel: t("nav.profile"),
    logoutLabel: t("auth.logout"),
    onSignOut: handleSignOut,
  };

  /* ============================================================
     LAYOUT
     ============================================================ */

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ========================================================
          TOPBAR
          ======================================================== */}

      <Topbar
        appName={t("app.name")}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((value) => !value)}
        profileName={profile?.name}
        profilePath={`${basePath}/profile`}
      />

      {/* ========================================================
          DESKTOP SIDEBAR
          ======================================================== */}

      <aside
        className="
          hidden
          lg:block
          fixed
          inset-y-0
          left-0
          z-30
          w-60
          border-r
          border-sidebar-border
          bg-sidebar
        "
      >
        <Sidebar {...sidebarProps} />
      </aside>

      {/* ========================================================
          MOBILE SIDEBAR
          ======================================================== */}

      <aside
        className={`
          lg:hidden
          fixed
          inset-y-0
          left-0
          z-50
          w-72
          max-w-[85vw]
          border-r
          border-sidebar-border
          bg-sidebar
          shadow-[4px_0_15px_rgba(0,0,0,0.10)]
          transition-transform
          duration-200
          ease-out
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <Sidebar {...sidebarProps} onNavigate={() => setSidebarOpen(false)} />
      </aside>

      {/* ========================================================
          MOBILE OVERLAY
          ======================================================== */}

      {sidebarOpen && (
        <button
          type="button"
          aria-label={t("common.closeMenu")}
          className="
            lg:hidden
            fixed
            inset-0
            z-40
            bg-foreground/25
            backdrop-blur-[2px]
          "
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ========================================================
          MAIN CONTENT
          ======================================================== */}

      <main
        className="
          min-h-screen
          pt-14
          lg:ml-60
          lg:pt-0
          bg-background
        "
      >
        {children}
      </main>
    </div>
  );
};

export default Layout;
