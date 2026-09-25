import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  Crosshair,
  Edit2,
  Eye,
  Leaf,
  MapPin,
  Plus,
  Ruler,
  Save,
  Sprout,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import api from "../services/api";

const CROPS = [
  "Rice",
  "Wheat",
  "Cotton",
  "Tomato",
  "Potato",
  "Corn",
  "Soybean",
  "Sugarcane",
];

// These are module-scope, so they cannot call `t` themselves: the caller passes
// it in and the fallback wording follows the active language at the call site.
const getLocationString = (location, t) => {
  if (!location) return t("farms.locationNotSet");

  if (typeof location === "string") return location;

  if (typeof location === "object") {
    const parts = [];

    if (location.address) parts.push(location.address);
    if (location.village) parts.push(location.village);
    if (location.district) parts.push(location.district);

    return parts.length > 0 ? parts.join(", ") : t("farms.locationNotSet");
  }

  return t("farms.locationNotSet");
};

const getCropName = (crop, t) => {
  if (!crop) return t("common.crop");

  if (typeof crop === "string") return crop;

  if (typeof crop === "object") {
    return crop.crop_name || crop.name || t("common.crop");
  }

  return t("common.crop");
};

const normalizeCropName = (crop) => {
  if (typeof crop === "string") return crop;
  if (crop && typeof crop === "object") {
    return crop.crop_name || crop.name || "";
  }
  return "";
};

const parseCoordinates = (value) => {
  const match = String(value || "").match(
    /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
  );

  if (!match) return null;

  const latitude = Number(match[1]);
  const longitude = Number(match[2]);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return { latitude, longitude };
};

function StatusBadge({ status }) {
  const { t } = useTranslation();
  const healthy = status?.toLowerCase() === "healthy";

  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
        "text-xs font-medium",
        healthy
          ? "bg-primary/10 text-primary"
          : "bg-accent/15 text-accent-foreground",
      ].join(" ")}
    >
      {healthy ? (
        <CheckCircle className="h-3.5 w-3.5" />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5" />
      )}

      <span>{status || t("dashboards.status.healthy")}</span>
    </span>
  );
}

function CropSelector({ selectedCrops, onToggle }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {CROPS.map((crop) => {
        const selected = selectedCrops.some(
          (item) => normalizeCropName(item) === crop,
        );

        return (
          <button
            key={crop}
            type="button"
            onClick={() => onToggle(crop)}
            aria-pressed={selected}
            className={[
              "flex min-h-11 items-center justify-center rounded-md border px-3 py-2",
              "text-sm font-medium transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
              selected
                ? "border-primary bg-primary text-white"
                : "border-border bg-card text-foreground hover:border-primary/50 hover:bg-primary/5",
            ].join(" ")}
          >
            <span>{crop}</span>
          </button>
        );
      })}
    </div>
  );
}

function FormField({ label, children, hint }) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-foreground">
        {label}
      </label>

      {children}

      {hint && (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

function FarmFormShell({ title, description, onBack, children }) {
  const { t } = useTranslation();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:py-8">
      <button
        type="button"
        onClick={onBack}
        className="mb-6 inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>{t("farms.backToFarms")}</span>
      </button>

      <div className="mb-6">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md border border-primary/20 bg-primary/10">
          <Leaf className="h-5 w-5 text-primary" />
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          {title}
        </h1>

        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>

      <div className="rounded-md border border-border bg-card p-5 sm:p-7">
        {children}
      </div>
    </div>
  );
}

export default function FarmerFarms() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [farms, setFarms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingFarm, setEditingFarm] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    loadFarms();
  }, []);

  const loadFarms = async () => {
    try {
      const response = await api.get("/profile/farms");
      setFarms(response.data || []);
    } catch (err) {
      console.error("Failed to load farms:", err);
      setFarms([]);
    } finally {
      setLoading(false);
    }
  };

  const deleteFarm = async (farmId) => {
    if (!window.confirm(t("farms.deleteConfirm"))) return;

    setDeletingId(farmId);

    try {
      await api.delete(`/profile/farms/${farmId}`);

      setFarms((currentFarms) =>
        currentFarms.filter((farm) => farm.id !== farmId),
      );

      console.log("Farm deleted successfully");
    } catch (err) {
      console.error("Failed to delete farm:", err);
      loadFarms();
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
        <div className="mb-8 space-y-3">
          <div className="h-8 w-40 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-72 animate-pulse rounded-md bg-muted" />
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <div
              key={item}
              className="h-72 animate-pulse rounded-md border border-border bg-card"
            />
          ))}
        </div>
      </div>
    );
  }

  if (showAddForm) {
    return (
      <AddFarmForm
        onBack={() => {
          setShowAddForm(false);
          loadFarms();
        }}
      />
    );
  }

  if (editingFarm) {
    return (
      <EditFarmForm
        farm={editingFarm}
        onBack={() => {
          setEditingFarm(null);
          loadFarms();
        }}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-primary">
            <Leaf className="h-4 w-4" />
            <span>{t("farms.management")}</span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
            {t("dashboard.yourFarms")}
          </h1>

          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {t("farms.subtitle")}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <Plus className="h-4 w-4" />
          <span>{t("dashboard.addFirstFarm")}</span>
        </button>
      </div>

      {/* Summary */}
      {farms.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-border py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {t("farms.countLabel")}
            </span>
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {farms.length}
            </span>
          </div>

          <div className="h-4 w-px bg-border" />

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {t("farms.cropsTracked")}
            </span>
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {farms.reduce(
                (total, farm) => total + (farm.crops?.length || 0),
                0,
              )}
            </span>
          </div>
        </div>
      )}

      {/* Farms */}
      {farms.length > 0 ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {farms.map((farm) => (
            <article
              key={farm.id}
              className="group flex flex-col rounded-md border border-border bg-card p-5 transition-colors duration-150 hover:border-primary/40"
            >
              {/* Farm header */}
              <div className="mb-5 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex items-center gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10">
                      <Leaf className="h-4.5 w-4.5 text-primary" />
                    </div>

                    <h2 className="truncate text-base font-semibold tracking-tight text-foreground">
                      {farm.farm_name || t("farms.farm")}
                    </h2>
                  </div>

                  <div className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />

                    <span className="line-clamp-2">
                      {getLocationString(farm.location, t)}
                    </span>
                  </div>
                </div>

                <StatusBadge status={farm.status} />
              </div>

              {/* Farm metrics */}
              <div className="mb-5 grid grid-cols-2 divide-x divide-border rounded-md border border-border bg-background/40">
                <div className="p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Ruler className="h-3.5 w-3.5" />
                    <span>{t("farms.area")}</span>
                  </div>

                  <p className="text-sm font-semibold tabular-nums text-foreground">
                    {farm.area || "0"}{" "}
                    <span className="font-normal text-muted-foreground">
                      {farm.area_unit || "acres"}
                    </span>
                  </p>
                </div>

                <div className="p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Sprout className="h-3.5 w-3.5" />
                    <span>{t("farms.crops")}</span>
                  </div>

                  <p className="text-sm font-semibold tabular-nums text-foreground">
                    {farm.crops?.length || 0}
                  </p>
                </div>
              </div>

              {/* Crop list */}
              <div className="mb-5 flex-1">
                {farm.crops && farm.crops.length > 0 ? (
                  <>
                    <p className="mb-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {t("farms.activeCrops")}
                    </p>

                    <div className="space-y-2">
                      {farm.crops.slice(0, 3).map((crop, idx) => (
                        <div
                          key={`${getCropName(crop, t)}-${idx}`}
                          className="flex items-center gap-2 text-sm text-foreground"
                        >
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10">
                            <Leaf className="h-3 w-3 text-primary" />
                          </span>

                          <span>{getCropName(crop, t)}</span>
                        </div>
                      ))}
                    </div>

                    {farm.crops.length > 3 && (
                      <p className="mt-2.5 pl-7 text-xs text-muted-foreground">
                        {t("farms.moreCrops", { count: farm.crops.length - 3 })}
                      </p>
                    )}
                  </>
                ) : (
                  <div className="rounded-md border border-dashed border-border px-3 py-4">
                    <p className="text-xs text-muted-foreground">
                      {t("farms.noCropsYet")}
                    </p>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="grid grid-cols-3 gap-2 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => navigate(`/farmer/farms/${farm.id}`)}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-background"
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>{t("common.view")}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setEditingFarm(farm)}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-background"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                  <span>{t("common.edit")}</span>
                </button>

                <button
                  type="button"
                  onClick={() => deleteFarm(farm.id)}
                  disabled={deletingId === farm.id}
                  className={[
                    "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border px-2",
                    "text-xs font-medium transition-colors",
                    deletingId === farm.id
                      ? "cursor-not-allowed border-destructive/20 bg-destructive/5 text-destructive/50"
                      : "border-destructive/25 bg-card text-destructive hover:bg-destructive/5",
                  ].join(" ")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>
                    {deletingId === farm.id
                      ? t("farms.deleting")
                      : t("common.delete")}
                  </span>
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border bg-card px-6 py-16 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
            <Leaf className="h-7 w-7 text-primary" />
          </div>

          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {t("farms.noneYet")}
          </h2>

          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            {t("farms.noneYetHelp")}
          </p>

          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="mt-6 inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-white transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <Plus className="h-4 w-4" />
            <span>{t("farms.addFirst")}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function AddFarmForm({ onBack }) {
  const { t } = useTranslation();

  const [formData, setFormData] = useState({
    name: "",
    location: "",
    size: "",
    crops: [],
    latitude: null,
    longitude: null,
  });

  const [loading, setLoading] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState(null);

  const captureLocation = () => {
    setGeoLoading(true);
    setGeoError(null);

    if (!navigator.geolocation) {
      setGeoError(t("farms.geoUnsupported"));
      setGeoLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;

        setFormData((prev) => ({
          ...prev,
          latitude,
          longitude,
          location: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
        }));

        setGeoLoading(false);
      },
      (error) => {
        setGeoError(error.message || t("farms.geoFailed"));
        setGeoLoading(false);
      },
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const farmRes = await api.post("/profile/farms", {
        farm_name: formData.name,
        area: parseFloat(formData.size),
        area_unit: "acres",
      });

      const manualCoordinates = parseCoordinates(formData.location);
      const latitude = formData.latitude ?? manualCoordinates?.latitude;
      const longitude = formData.longitude ?? manualCoordinates?.longitude;

      if (latitude !== undefined && longitude !== undefined) {
        await api.post(`/profile/farms/${farmRes.data.id}/location`, {
          latitude,
          longitude,
          address: formData.location,
        });
      }

      await Promise.all(
        formData.crops.map((cropName) =>
          api.post(`/profile/farms/${farmRes.data.id}/crops`, {
            crop_name: cropName,
          }),
        ),
      );

      onBack();
    } catch (err) {
      console.error("Failed to add farm:", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleCrop = (crop) => {
    setFormData((prev) => ({
      ...prev,
      crops: prev.crops.includes(crop)
        ? prev.crops.filter((item) => item !== crop)
        : [...prev.crops, crop],
    }));
  };

  return (
    <FarmFormShell
      title={t("farms.addTitle")}
      description={t("farms.addDescription")}
      onBack={onBack}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <FormField label={t("farms.name")}>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
            placeholder={t("farms.namePlaceholder")}
            required
          />
        </FormField>

        <FormField
          label={t("common.location")}
          hint={t("farms.locationHint")}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={formData.location}
              onChange={(e) =>
                setFormData({ ...formData, location: e.target.value })
              }
              className="h-10 min-w-0 flex-1 rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
              placeholder={t("farms.locationPlaceholder")}
            />

            <button
              type="button"
              onClick={captureLocation}
              disabled={geoLoading}
              className={[
                "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors",
                geoLoading
                  ? "cursor-not-allowed border-border bg-muted text-muted-foreground"
                  : formData.latitude && formData.longitude
                    ? "border-primary/25 bg-primary/10 text-primary hover:bg-primary/15"
                    : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-background",
              ].join(" ")}
            >
              {formData.latitude && formData.longitude ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <Crosshair className="h-4 w-4" />
              )}

              <span>
                {geoLoading
                  ? t("farms.capturing")
                  : formData.latitude
                    ? t("farms.gpsSet")
                    : t("farms.captureGps")}
              </span>
            </button>
          </div>

          {geoError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{geoError}</span>
            </div>
          )}

          {formData.latitude && formData.longitude && (
            <div className="flex items-center gap-2 rounded-md bg-primary/5 px-3 py-2 text-xs text-primary">
              <MapPin className="h-3.5 w-3.5" />
              <span>
                {formData.latitude.toFixed(6)}, {formData.longitude.toFixed(6)}
              </span>
            </div>
          )}
        </FormField>

        <FormField label={t("farms.size")}>
          <div className="relative">
            <input
              type="number"
              min="0"
              step="0.01"
              value={formData.size}
              onChange={(e) =>
                setFormData({ ...formData, size: e.target.value })
              }
              className="h-10 w-full rounded-md border border-border bg-card px-3 pr-20 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
              placeholder={t("farms.sizePlaceholder")}
              required
            />

            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
              {t("farms.acres")}
            </span>
          </div>
        </FormField>

        <FormField
          label={t("farms.crops")}
          hint={
            formData.crops.length > 0
              ? t("farms.cropsSelected", { count: formData.crops.length })
              : t("farms.cropsHint")
          }
        >
          <CropSelector selectedCrops={formData.crops} onToggle={toggleCrop} />
        </FormField>

        <div className="flex flex-col-reverse gap-2 border-t border-border pt-5 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onBack}
            className="h-10 rounded-md border border-border bg-card px-5 text-sm font-medium text-foreground transition-colors hover:bg-background"
          >
            {t("common.cancel")}
          </button>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-white transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            <span>
              {loading ? t("farms.adding") : t("farms.addFarm")}
            </span>
          </button>
        </div>
      </form>
    </FarmFormShell>
  );
}

function EditFarmForm({ farm, onBack }) {
  const { t } = useTranslation();

  const [formData, setFormData] = useState({
    name: farm.farm_name || "",
    location:
      typeof farm.location === "string"
        ? farm.location
        : farm.location?.address || "",
    size: farm.area || "",
    crops: farm.crops || [],
  });

  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      await api.put(`/profile/farms/${farm.id}`, {
        farm_name: formData.name,
        area: parseFloat(formData.size),
        area_unit: "acres",
      });

      const existingCrops = farm.crops || [];
      const desiredCropNames = new Set(
        formData.crops.map((crop) => normalizeCropName(crop)),
      );
      const existingCropNames = new Set(
        existingCrops.map((crop) => normalizeCropName(crop)),
      );

      await Promise.all([
        ...existingCrops
          .filter((crop) => !desiredCropNames.has(normalizeCropName(crop)))
          .map((crop) => api.delete(`/profile/crops/${crop.id}`)),
        ...formData.crops
          .filter((crop) => !existingCropNames.has(normalizeCropName(crop)))
          .map((crop) =>
            api.post(`/profile/farms/${farm.id}/crops`, {
              crop_name: normalizeCropName(crop),
            }),
          ),
      ]);

      onBack();
    } catch (err) {
      console.error("Failed to update farm:", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleCrop = (crop) => {
    const cropName = normalizeCropName(crop);

    setFormData((prev) => ({
      ...prev,
      crops: prev.crops.some((item) => normalizeCropName(item) === cropName)
        ? prev.crops.filter((item) => normalizeCropName(item) !== cropName)
        : [...prev.crops, cropName],
    }));
  };

  return (
    <FarmFormShell
      title={t("farms.editTitle")}
      description={t("farms.editDescription")}
      onBack={onBack}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <FormField label={t("farms.name")}>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
            required
          />
        </FormField>

        <FormField label={t("common.location")}>
          <div className="relative">
            <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

            <input
              type="text"
              value={formData.location}
              onChange={(e) =>
                setFormData({ ...formData, location: e.target.value })
              }
              className="h-10 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </FormField>

        <FormField label={t("farms.size")}>
          <div className="relative">
            <input
              type="number"
              min="0"
              step="0.01"
              value={formData.size}
              onChange={(e) =>
                setFormData({ ...formData, size: e.target.value })
              }
              className="h-10 w-full rounded-md border border-border bg-card px-3 pr-20 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
              required
            />

            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
              {t("farms.acres")}
            </span>
          </div>
        </FormField>

        <FormField
          label={t("farms.crops")}
          hint={
            formData.crops.length > 0
              ? t("farms.cropsSelected", { count: formData.crops.length })
              : t("farms.cropsHint")
          }
        >
          <CropSelector selectedCrops={formData.crops} onToggle={toggleCrop} />
        </FormField>

        <div className="flex flex-col-reverse gap-2 border-t border-border pt-5 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onBack}
            className="h-10 rounded-md border border-border bg-card px-5 text-sm font-medium text-foreground transition-colors hover:bg-background"
          >
            {t("common.cancel")}
          </button>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-white transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            <span>
              {loading ? t("farms.updating") : t("farms.updateFarm")}
            </span>
          </button>
        </div>
      </form>
    </FarmFormShell>
  );
}
