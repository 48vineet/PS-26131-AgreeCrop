import { MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import HeatLayer from "./HeatLayer";
import EmptyState from "./EmptyState";

// Severity colors intentionally remain distinct for fast
// visual recognition and stay aligned with the app's
// warning / danger / primary semantics. Labels are translation keys
// rather than text: this map is module scope and cannot call `t`.
const SEVERITY_STYLES = {
  low: {
    color: "#1D9F76",
    labelKey: "map.severityLow",
  },
  moderate: {
    color: "#EFA02A",
    labelKey: "map.severityModerate",
  },
  high: {
    color: "#F26A4B",
    labelKey: "map.severityHigh",
  },
  critical: {
    color: "#DC2626",
    labelKey: "map.severityCritical",
  },
  info: {
    color: "#5E5A52",
    labelKey: "map.severityInfo",
  },
};

const LEGEND_ORDER = ["critical", "high", "moderate", "low", "info"];

function resolveSeverity(severity) {
  return SEVERITY_STYLES[severity] ? severity : "info";
}

export default function MapView({
  center,
  zoom = 6,
  markers = [],
  heatPoints = [],
  height = 420,
  className = "",
}) {
  const { t } = useTranslation();

  /* ============================================================
     EMPTY STATE
     ============================================================ */

  const validMarkers = (markers || []).filter(
    (marker) =>
      Number.isFinite(marker.lat) &&
      Number.isFinite(marker.lng) &&
      marker.lat >= -90 &&
      marker.lat <= 90 &&
      marker.lng >= -180 &&
      marker.lng <= 180,
  );

  if (!validMarkers.length) {
    return (
      <div
        className={`
          relative
          overflow-hidden
          rounded-md
          border
          border-border
          bg-card
          ${className}
        `}
        style={{ height }}
      >
        <div className="flex h-full items-center justify-center">
          <EmptyState
            icon={MapPin}
            title={t("map.noMappedObservations")}
            description={t("map.noMappedObservationsHelp")}
          />
        </div>
      </div>
    );
  }

  const presentSeverities = LEGEND_ORDER.filter((severity) =>
    markers.some((marker) => resolveSeverity(marker.severity) === severity),
  );

  /* ============================================================
     MAP
     ============================================================ */

  return (
    <div
      className={`
        relative
        overflow-hidden
        rounded-md
        border
        border-border
        bg-muted
        ${className}
      `}
      style={{ height }}
    >
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={zoom}
        style={{
          height: "100%",
          width: "100%",
        }}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {heatPoints.length > 0 && <HeatLayer points={heatPoints} />}

        {validMarkers.map((marker) => {
          const severity = resolveSeverity(marker.severity);
          const style = SEVERITY_STYLES[severity];

          return (
            <CircleMarker
              key={marker.id}
              center={[marker.lat, marker.lng]}
              radius={8}
              weight={2}
              color={style.color}
              fillColor={style.color}
              fillOpacity={0.55}
            >
              <Popup>{marker.popupContent ?? marker.label}</Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {/* ========================================================
          MAP LEGEND
         ======================================================== */}

      {presentSeverities.length > 0 && (
        <div
          className="
            absolute
            bottom-4
            left-4
            z-[400]
            rounded-md
            border
            border-border
            bg-card/95
            p-3
            text-xs
            shadow-[0_6px_15px_rgba(0,0,0,0.10)]
            backdrop-blur-sm
          "
        >
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("map.riskLevel")}
          </p>

          <ul className="space-y-1.5">
            {presentSeverities.map((severity) => {
              const style = SEVERITY_STYLES[severity];

              return (
                <li key={severity} className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: style.color,
                    }}
                    aria-hidden="true"
                  />

                  <span className="text-foreground">
                    {t(style.labelKey)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
