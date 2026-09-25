import {
  ArrowLeft,
  Bug,
  ClipboardList,
  Leaf,
  Sprout,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import Button from "../components/ui/Button";
import ErrorState from "../components/ui/ErrorState";
import LoadingState from "../components/ui/LoadingState";
import StatusBadge from "../components/ui/StatusBadge";
import api from "../services/api";

export default function ExtensionFarmDetail() {
  const { farmId } = useParams();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const [farm, setFarm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    loadFarm();
  }, [farmId]);

  const loadFarm = async () => {
    setLoading(true);
    setError(false);
    setNotFound(false);

    try {
      const response = await api.get("/extension/farmers");
      const foundFarm = (response.data.items || []).find(
        (item) => item.farm_id === Number(farmId),
      );

      if (foundFarm) {
        setFarm(foundFarm);
      } else {
        setFarm(null);
        setNotFound(true);
      }
    } catch (loadError) {
      console.error("Failed to load extension farm:", loadError);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (value) => {
    if (!value) return t("dashboards.extension.notRecorded");
    try {
      return new Date(value).toLocaleDateString(i18n.language, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return t("dashboards.extension.notRecorded");
    }
  };

  const getLocationLabel = (location) => {
    if (!location) return t("dashboards.extension.locationNotSet");

    return (
      [location.village, location.district, location.state].filter(Boolean).join(", ") ||
      location.address ||
      (location.latitude && location.longitude
        ? `${Number(location.latitude).toFixed(6)}, ${Number(location.longitude).toFixed(6)}`
        : t("dashboards.extension.locationNotSet"))
    );
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <LoadingState variant="page" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <ErrorState
          title={t("dashboards.extension.unableLoadFarmersTitle")}
          description={t("dashboards.extension.unableLoadFarmersDesc")}
          onRetry={loadFarm}
        />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/extension/dashboard")}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("dashboards.extension.backToFarmers")}
        </Button>
        <div className="mt-4 rounded-md border border-border bg-card p-12 text-center">
          <Leaf className="mx-auto mb-4 h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-base font-semibold text-foreground">{t("dashboards.extension.farmNotFound")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("dashboards.extension.farmNotFoundDesc")}
          </p>
        </div>
      </div>
    );
  }

  const screening = farm.health?.latest_screening;
  const pest = farm.health?.latest_pest;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/extension/dashboard")}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("dashboards.extension.backToFarmers")}
        </Button>
      </div>

      <section className="rounded-md border border-border bg-card p-5 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              {t("dashboards.extension.caseViewLabel")}
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-foreground">
              {farm.farm_name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {farm.farmer_name} · {getLocationLabel(farm.location)}
            </p>
          </div>
          <StatusBadge status="neutral">
            {farm.monitoring?.status || t("dashboards.extension.noMonitoringCase")}
          </StatusBadge>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-md border border-border bg-card">
          <div className="border-b border-border p-5">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">{t("dashboards.extension.farmerLabel")}</h2>
            </div>
          </div>
          <dl className="divide-y divide-border/70">
            <div className="flex justify-between gap-4 p-4 text-sm">
              <dt className="text-muted-foreground">{t("dashboards.extension.farmerIdLabel")}</dt>
              <dd className="font-medium text-foreground">{farm.farmer_id}</dd>
            </div>
            <div className="flex justify-between gap-4 p-4 text-sm">
              <dt className="text-muted-foreground">{t("dashboards.extension.contactLabel")}</dt>
              <dd className="font-medium text-foreground">{farm.phone || t("dashboards.extension.contactNotProvided")}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-md border border-border bg-card">
          <div className="border-b border-border p-5">
            <div className="flex items-center gap-2">
              <Sprout className="h-4 w-4 text-primary" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">{t("dashboards.extension.farmLabel")}</h2>
            </div>
          </div>
          <dl className="divide-y divide-border/70">
            <div className="flex justify-between gap-4 p-4 text-sm">
              <dt className="text-muted-foreground">{t("dashboards.extension.farmIdLabel")}</dt>
              <dd className="font-medium text-foreground">{farm.farm_id}</dd>
            </div>
            <div className="flex justify-between gap-4 p-4 text-sm">
              <dt className="text-muted-foreground">{t("dashboards.extension.areaLabel")}</dt>
              <dd className="font-medium text-foreground">{farm.area} {farm.area_unit}</dd>
            </div>
            <div className="flex justify-between gap-4 p-4 text-sm">
              <dt className="text-muted-foreground">{t("dashboards.extension.locationLabel")}</dt>
              <dd className="font-medium text-foreground">{getLocationLabel(farm.location)}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-md border border-border bg-card">
          <div className="border-b border-border p-5">
            <div className="flex items-center gap-2">
              <Leaf className="h-4 w-4 text-primary" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">{t("dashboards.extension.cropsLabel")}</h2>
            </div>
          </div>
          {farm.crops.length ? (
            <ul className="divide-y divide-border/70">
              {farm.crops.map((crop) => (
                <li key={crop.crop_id} className="flex justify-between gap-4 p-4 text-sm">
                  <span className="font-medium text-foreground">
                    {crop.crop_name}{crop.variety ? ` · ${crop.variety}` : ""}
                  </span>
                  <span className="text-muted-foreground">
                    {crop.current_stage || t("dashboards.extension.stageNotRecorded")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("dashboards.extension.noActiveCrops")}</p>
          )}
        </section>

        <section className="rounded-md border border-border bg-card">
          <div className="border-b border-border p-5">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">{t("dashboards.extension.healthLabel")}</h2>
            </div>
          </div>
          <dl className="divide-y divide-border/70">
            <div className="flex justify-between gap-4 p-4 text-sm">
              <dt className="text-muted-foreground">{t("dashboards.extension.riskLabel")}</dt>
              <dd className="font-medium text-foreground">{farm.health?.risk_level || t("dashboards.extension.notRecorded")}</dd>
            </div>
            <div className="flex justify-between gap-4 p-4 text-sm">
              <dt className="text-muted-foreground">{t("dashboards.extension.latestScreeningLabel")}</dt>
              <dd className="font-medium text-foreground">
                {screening ? `${screening.condition} · ${formatDate(screening.screened_at)}` : t("dashboards.extension.notRecorded")}
              </dd>
            </div>
            <div className="flex justify-between gap-4 p-4 text-sm">
              <dt className="text-muted-foreground">{t("dashboards.extension.latestPestLabel")}</dt>
              <dd className="font-medium text-foreground">
                {pest ? `${pest.pest_name} · ${formatDate(pest.observed_at)}` : t("dashboards.extension.notRecorded")}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="rounded-md border border-border bg-card">
        <div className="border-b border-border p-5">
          <div className="flex items-center gap-2">
            <Bug className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-foreground">{t("dashboards.extension.monitoringLabel")}</h2>
          </div>
        </div>
        <dl className="divide-y divide-border/70">
          <div className="flex justify-between gap-4 p-4 text-sm">
            <dt className="text-muted-foreground">{t("dashboards.extension.caseLabel")}</dt>
            <dd className="font-medium text-foreground">{farm.monitoring?.case_id || t("dashboards.extension.noCase")}</dd>
          </div>
          <div className="flex justify-between gap-4 p-4 text-sm">
            <dt className="text-muted-foreground">{t("dashboards.extension.statusLabel")}</dt>
            <dd className="font-medium text-foreground">{farm.monitoring?.status || t("dashboards.extension.notRecorded")}</dd>
          </div>
          <div className="flex justify-between gap-4 p-4 text-sm">
            <dt className="text-muted-foreground">{t("dashboards.extension.lastActivity")}</dt>
            <dd className="font-medium text-foreground">{formatDate(farm.last_activity)}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}