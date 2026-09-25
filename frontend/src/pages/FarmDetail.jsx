import {
  ArrowLeft,
  Edit2,
  Leaf,
  MapPin,
  Plus,
  Sprout,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import api from "../services/api";

export default function FarmDetail() {
  const { t, i18n } = useTranslation();
  const { farmId } = useParams();
  const navigate = useNavigate();

  const [farm, setFarm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAddCropForm, setShowAddCropForm] = useState(false);

  const [cropFormData, setCropFormData] = useState({
    crop_name: "",
    variety: "",
    current_stage: "",
  });

  const [cropFormLoading, setCropFormLoading] = useState(false);

  useEffect(() => {
    loadFarm();
  }, [farmId]);

  const loadFarm = async () => {
    try {
      const response = await api.get("/profile/farms");

      const foundFarm = response.data.find((f) => f.id === parseInt(farmId));

      if (foundFarm) {
        setFarm(foundFarm);
      } else {
        setFarm(null);
      }
    } catch (err) {
      console.error("Failed to load farm:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddCrop = async (e) => {
    e.preventDefault();
    setCropFormLoading(true);

    try {
      await api.post(`/profile/farms/${farmId}/crops`, {
        crop_name: cropFormData.crop_name,
        variety: cropFormData.variety || "",
        current_stage: cropFormData.current_stage || "",
      });

      setCropFormData({
        crop_name: "",
        variety: "",
        current_stage: "",
      });

      setShowAddCropForm(false);
      loadFarm();
    } catch (err) {
      console.error("Failed to add crop:", err);
    } finally {
      setCropFormLoading(false);
    }
  };

  const getLocationString = (location) => {
    if (!location) return t("farms.locationNotSet");

    if (typeof location === "string") {
      return location;
    }

    if (typeof location === "object") {
      const parts = [];

      if (location.address) parts.push(location.address);
      if (location.village) parts.push(location.village);
      if (location.district) parts.push(location.district);
      if (location.state) parts.push(location.state);

      return parts.length > 0
        ? parts.join(", ")
        : t("farms.locationNotSet");
    }

    return t("farms.locationNotSet");
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <div
          className="animate-pulse space-y-6"
          role="status"
          aria-label={t("validation.loadingFarm")}
        >
          <div className="h-5 w-28 rounded-md bg-muted" />
          <div className="rounded-md border border-border bg-card p-6">
            <div className="h-8 w-1/3 rounded-md bg-muted" />
            <div className="mt-3 h-4 w-2/3 rounded-md bg-muted" />

            <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="h-16 rounded-md bg-muted" />
              <div className="h-16 rounded-md bg-muted" />
              <div className="h-16 rounded-md bg-muted" />
            </div>
          </div>

          <div className="h-48 rounded-md bg-muted" />
        </div>
      </div>
    );
  }

  if (!farm) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => navigate("/farmer/farms")}
          className="mb-6 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("farms.backToFarms")}
        </button>

        <div className="rounded-md border border-border bg-card p-12 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted/50">
            <Leaf
              className="h-6 w-6 text-muted-foreground"
              aria-hidden="true"
            />
          </div>

          <p className="text-base font-semibold text-foreground">
            {t("farms.notFound")}
          </p>

          <p className="mt-1 text-sm text-muted-foreground">
            {t("farms.notFoundHelp")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {/* Back */}
      <button
        type="button"
        onClick={() => navigate("/farmer/farms")}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("farms.backToFarms")}
      </button>

      {/* Farm Header */}
      <section className="rounded-md border border-border bg-card">
        <div className="p-5 md:p-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary">
                  <Leaf className="h-5 w-5 text-white" aria-hidden="true" />
                </div>

                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                    {t("farms.profileLabel")}
                  </p>

                  <h1 className="mt-0.5 truncate text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
                    {farm.farm_name}
                  </h1>
                </div>
              </div>

              <div className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
                <MapPin
                  className="mt-0.5 h-4 w-4 shrink-0"
                  aria-hidden="true"
                />

                <p>{getLocationString(farm.location)}</p>
              </div>
            </div>

            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => navigate("/farmer/farms")}
                className="flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:border-muted-foreground/40 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Edit2 className="h-4 w-4" aria-hidden="true" />
                {t("common.edit")}
              </button>

              <button
                type="button"
                onClick={() => navigate("/farmer/farms")}
                className="flex h-9 items-center gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {t("common.delete")}
              </button>
            </div>
          </div>
        </div>

        {/* Farm Metrics */}
        <div className="grid grid-cols-1 border-t border-border md:grid-cols-3">
          <div className="border-b border-border p-5 md:border-b-0 md:border-r md:p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("farms.size")}
            </p>

            <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {farm.area}{" "}
              <span className="text-sm font-medium text-muted-foreground">
                {farm.area_unit}
              </span>
            </p>
          </div>

          <div className="border-b border-border p-5 md:border-b-0 md:border-r md:p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("farms.crops")}
            </p>

            <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {farm.crops?.length || 0}
            </p>
          </div>

          <div className="p-5 md:p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("farms.gpsCoordinates")}
            </p>

            <p className="mt-2 font-mono text-sm text-foreground">
              {farm.location?.latitude && farm.location?.longitude
                ? `${farm.location.latitude.toFixed(
                    6,
                  )}, ${farm.location.longitude.toFixed(6)}`
                : t("farms.noGps")}
            </p>
          </div>
        </div>
      </section>

      {/* Crops */}
      <section className="rounded-md border border-border bg-card">
        <div className="flex items-center justify-between gap-4 border-b border-border p-5 md:p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("farms.profileLabel")}
            </p>

            <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
              {t("farms.crops")}
            </h2>
          </div>

          {!showAddCropForm && (
            <button
              type="button"
              onClick={() => setShowAddCropForm(true)}
              className="flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("farms.addCrop")}
            </button>
          )}
        </div>

        <div className="p-5 md:p-6">
          {/* Add Crop Form */}
          {showAddCropForm && (
            <form
              onSubmit={handleAddCrop}
              className="mb-6 rounded-md border border-primary/20 bg-primary/5 p-5"
            >
              <div className="mb-5 flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
                  <Sprout className="h-4 w-4 text-primary" aria-hidden="true" />
                </div>

                <div>
                  <h3 className="text-base font-semibold text-foreground">
                    {t("farms.addNewCrop")}
                  </h3>

                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {t("farms.addNewCropHelp")}
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                {/* Crop Name */}
                <div>
                  <label
                    htmlFor="crop-name"
                    className="mb-2 block text-sm font-medium text-foreground"
                  >
                    {t("common.crop")}{" "}
                    <span className="text-destructive">*</span>
                  </label>

                  <input
                    id="crop-name"
                    type="text"
                    value={cropFormData.crop_name}
                    onChange={(e) =>
                      setCropFormData({
                        ...cropFormData,
                        crop_name: e.target.value,
                      })
                    }
                    className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
                    placeholder={t("diseaseScreening.cropNamePlaceholder")}
                    required
                  />
                </div>

                {/* Variety */}
                <div>
                  <label
                    htmlFor="crop-variety"
                    className="mb-2 block text-sm font-medium text-foreground"
                  >
                    {t("monitoring.variety")}
                  </label>

                  <input
                    id="crop-variety"
                    type="text"
                    value={cropFormData.variety}
                    onChange={(e) =>
                      setCropFormData({
                        ...cropFormData,
                        variety: e.target.value,
                      })
                    }
                    className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
                    placeholder={t("farms.varietyPlaceholder")}
                  />
                </div>

                {/* Growth Stage */}
                <div>
                  <label
                    htmlFor="crop-stage"
                    className="mb-2 block text-sm font-medium text-foreground"
                  >
                    {t("farms.growthStage")}
                  </label>

                  <input
                    id="crop-stage"
                    type="text"
                    value={cropFormData.current_stage}
                    onChange={(e) =>
                      setCropFormData({
                        ...cropFormData,
                        current_stage: e.target.value,
                      })
                    }
                    className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
                    placeholder={t("farms.stagePlaceholder")}
                  />
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                  <button
                    type="submit"
                    disabled={cropFormLoading}
                    className="flex h-10 flex-1 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {cropFormLoading ? t("validation.addingCrop") : t("validation.addCrop")}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowAddCropForm(false)}
                    className="flex h-10 flex-1 items-center justify-center rounded-md border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-background hover:border-muted-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Crop List */}
          {farm.crops && farm.crops.length > 0 ? (
            <div className="space-y-3">
              {farm.crops.map((crop) => (
                <div
                  key={crop.id}
                  className="rounded-md border border-border bg-background/40 p-4 transition-colors duration-150 hover:border-muted-foreground/40"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10">
                        <Leaf
                          className="h-4 w-4 text-primary"
                          aria-hidden="true"
                        />
                      </div>

                      <div>
                        <h3 className="text-base font-semibold text-foreground">
                          {crop.crop_name}
                        </h3>

                        <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                          {crop.variety && (
                            <p>
                              <span className="font-medium text-foreground">
                                {t("farms.varietyLabel")}
                              </span>{" "}
                              {crop.variety}
                            </p>
                          )}

                          {crop.current_stage && (
                            <p>
                              <span className="font-medium text-foreground">
                                {t("farms.stageLabel")}
                              </span>{" "}
                              {crop.current_stage}
                            </p>
                          )}

                          {crop.sowing_date && (
                            <p>
                              <span className="font-medium text-foreground">
                                {t("farms.sownLabel")}
                              </span>{" "}
                              {new Date(
                                crop.sowing_date,
                              ).toLocaleDateString(i18n.language)}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2 sm:shrink-0">
                      <button
                        type="button"
                        className="h-8 rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-background hover:border-muted-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {t("common.edit")}
                      </button>

                      <button
                        type="button"
                        className="h-8 rounded-md border border-destructive/20 bg-destructive/5 px-3 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border px-6 py-12 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted/50">
                <Leaf
                  className="h-6 w-6 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>

              <p className="text-sm font-semibold text-foreground">
                {t("farms.noCropsAdded")}
              </p>

              <p className="mt-1 text-sm text-muted-foreground">
                {t("farms.noCropsAddedHelp")}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Location Details */}
      {farm.location && (
        <section className="rounded-md border border-border bg-card">
          <div className="border-b border-border p-5 md:p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                <MapPin
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("farms.farmCoordinates")}
                </p>

                <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
                  {t("farms.locationDetails")}
                </h2>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-px bg-border md:grid-cols-2">
            <div className="bg-card p-5 md:p-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("farms.latitude")}
              </p>

              <p className="mt-2 font-mono text-sm text-foreground">
                {farm.location.latitude?.toFixed(6) || t("farms.notAvailable")}
              </p>
            </div>

            <div className="bg-card p-5 md:p-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("farms.longitude")}
              </p>

              <p className="mt-2 font-mono text-sm text-foreground">
                {farm.location.longitude?.toFixed(6) || t("farms.notAvailable")}
              </p>
            </div>

            <div className="bg-card p-5 md:p-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("farms.address")}
              </p>

              <p className="mt-2 text-sm leading-relaxed text-foreground">
                {farm.location.address || t("farms.notAvailable")}
              </p>
            </div>

            <div className="bg-card p-5 md:p-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("farms.village")}
              </p>

              <p className="mt-2 text-sm text-foreground">
                {farm.location.village || t("farms.notAvailable")}
              </p>
            </div>

            <div className="bg-card p-5 md:p-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("farms.district")}
              </p>

              <p className="mt-2 text-sm text-foreground">
                {farm.location.district || t("farms.notAvailable")}
              </p>
            </div>

            <div className="bg-card p-5 md:p-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("farms.state")}
              </p>

              <p className="mt-2 text-sm text-foreground">
                {farm.location.state || t("farms.notAvailable")}
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
