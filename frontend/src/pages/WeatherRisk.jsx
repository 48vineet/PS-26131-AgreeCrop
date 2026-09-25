import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Cloud,
  Droplets,
  Eye,
  Info,
  Leaf,
  MapPin,
  ShieldCheck,
  Thermometer,
  TrendingUp,
  Wind,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Select from "../components/ui/Select";
import { useAuth } from "../contexts/AuthContext";
import api from "../services/api";

// Labels and descriptions are translation keys rather than text: this map
// is module scope and cannot call `t`.
const RISK_CONFIG = {
  insufficient_data: {
    labelKey: "weather.riskUnavailableLabel",
    shortKey: "weather.resultUnavailable",
    icon: Info,
    iconColor: "text-muted-foreground",
    bg: "bg-muted/40",
    border: "border-border",
    bar: "bg-muted-foreground",
    score: 0,
    descKey: "weather.riskUnavailableDesc",
  },
  high: {
    labelKey: "weather.riskHighLabel",
    shortKey: "weather.high",
    icon: AlertTriangle,
    iconColor: "text-destructive",
    bg: "bg-destructive/10",
    border: "border-destructive/20",
    bar: "bg-destructive",
    score: 95,
    descKey: "weather.riskHighDesc",
  },
  medium: {
    labelKey: "weather.riskModerateLabel",
    shortKey: "weather.medium",
    icon: AlertCircle,
    iconColor: "text-accent-foreground",
    bg: "bg-accent/10",
    border: "border-accent/25",
    bar: "bg-accent",
    score: 65,
    descKey: "weather.riskModerateDesc",
  },
  low: {
    labelKey: "weather.riskLowLabel",
    shortKey: "weather.low",
    icon: ShieldCheck,
    iconColor: "text-primary",
    bg: "bg-primary/10",
    border: "border-primary/20",
    bar: "bg-primary",
    score: 35,
    descKey: "weather.riskLowDesc",
  },
};

const WEATHER_META = {
  Sunny: {
    icon: Zap,
    color: "text-accent-foreground",
    bg: "bg-accent/10",
  },
  Cloudy: {
    icon: Cloud,
    color: "text-muted-foreground",
    bg: "bg-muted/60",
  },
  Foggy: {
    icon: Cloud,
    color: "text-muted-foreground",
    bg: "bg-muted/60",
  },
  Rainy: {
    icon: Cloud,
    color: "text-primary",
    bg: "bg-primary/10",
  },
  Snowy: {
    icon: Cloud,
    color: "text-muted-foreground",
    bg: "bg-muted/60",
  },
};

export default function WeatherRisk() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const isExtension = profile?.role === "extension_officer";

  const [selectedFarm, setSelectedFarm] = useState(null);
  const [selectedCrop, setSelectedCrop] = useState(null);
  const [farms, setFarms] = useState([]);
  const [weather, setWeather] = useState(null);
  const [risk, setRisk] = useState(null);
  const [forecast, setForecast] = useState([]);
  const [loading, setLoading] = useState(true);
  const [weatherError, setWeatherError] = useState("");
  const [activeDay, setActiveDay] = useState(0);

  useEffect(() => {
    loadFarms();
  }, [isExtension]);

  useEffect(() => {
    if (selectedFarm && selectedCrop) {
      loadWeatherAndRisk();
    }
  }, [selectedFarm, selectedCrop]);

  const loadFarms = async () => {
    try {
      const response = await api.get(
        isExtension ? "/extension/farmers" : "/profile/farms",
      );

      const farmData = isExtension
        ? (response.data.items || []).map((farm) => ({
            ...farm,
            id: farm.farm_id,
            crops: (farm.crops || []).map((crop) => ({
              ...crop,
              id: crop.crop_id,
            })),
          }))
        : response.data || [];

      setFarms(farmData);

      if (farmData.length > 0) {
        const farm = farmData[0];

        setSelectedFarm(farm);

        if (farm.crops && farm.crops.length > 0) {
          setSelectedCrop(farm.crops[0]);
        } else {
          setLoading(false);
        }
      } else {
        setLoading(false);
      }
    } catch (err) {
      console.error("Failed to load farms:", err);
      setLoading(false);
    }
  };

  const loadWeatherAndRisk = async () => {
    setLoading(true);
    setWeatherError("");

    try {
      /* ======================================================
         WEATHER
      ======================================================= */

      try {
        const weatherRes = await api.get(
          `${isExtension ? "/extension" : ""}/weather/farms/${selectedFarm.id}/current`,
        );

        const data = weatherRes.data;

        setWeather({
          temperature: Math.round(data.current?.temperature_2m || 27),
          condition: getWeatherCondition(data.current?.weather_code),
          humidity: data.current?.relative_humidity_2m || 78,
          rainfall: data.current?.precipitation || 0,
          wind_speed: Math.round(data.current?.wind_speed_10m || 12),
          updated_ago: data.updated_ago,
        });

        if (data.hourly?.time && data.hourly?.temperature_2m) {
          const times = data.hourly.time;
          const temps = data.hourly.temperature_2m;
          const precip = data.hourly.precipitation || [];
          const weatherCodes = data.hourly.weather_code || [];

          const dailyForecast = [];

          for (let day = 0; day < 7; day++) {
            const dayStart = day * 24;
            const dayEnd = dayStart + 24;

            const dayTemps = temps.slice(dayStart, dayEnd);

            const dayPrecip = precip.slice(dayStart, dayEnd);

            const dayWeatherCodes = weatherCodes.slice(dayStart, dayEnd);

            if (dayTemps.length > 0) {
              dailyForecast.push({
                condition: getWeatherCondition(dayWeatherCodes[0] || 0),
                temp_max: Math.round(Math.max(...dayTemps)),
                temp_min: Math.round(Math.min(...dayTemps)),
                precipitation:
                  dayPrecip.length > 0 ? Math.max(...dayPrecip) : 0,
              });
            }
          }

          setForecast(dailyForecast);
        } else {
          setForecast([]);
        }
      } catch (err) {
        console.error("Failed to load weather:", err);
        setWeather(null);
        setWeatherError(
          err.response?.data?.detail || t("weather.forecastUnavailable"),
        );
        setForecast([]);
      }

      /* ======================================================
         RISK
      ======================================================= */

      try {
        const riskRes = await api.get(
          `${isExtension ? "/extension" : ""}/risk/farms/${selectedFarm.id}/crops/${selectedCrop.id}/current`,
        );

        setRisk({
          level: riskRes.data.risk_level?.toLowerCase() || "insufficient_data",
        });
      } catch (err) {
        console.error("Failed to load risk assessment:", err);
        setRisk(null);
      }
    } finally {
      setLoading(false);
    }
  };

  /* ========================================================
     WEATHER HELPERS
  ========================================================= */

  const getWeatherCondition = (weatherCode) => {
    if (!weatherCode) return "Cloudy";

    if (weatherCode === 0 || weatherCode === 1) {
      return "Sunny";
    }

    if (weatherCode === 2 || weatherCode === 3) {
      return "Cloudy";
    }

    if (weatherCode === 45 || weatherCode === 48) {
      return "Foggy";
    }

    if (weatherCode >= 51 && weatherCode <= 67) {
      return "Rainy";
    }

    if (weatherCode >= 71 && weatherCode <= 77) {
      return "Snowy";
    }

    if (weatherCode >= 80 && weatherCode <= 82) {
      return "Rainy";
    }

    if (weatherCode >= 85 && weatherCode <= 86) {
      return "Snowy";
    }

    return "Cloudy";
  };

  // `condition` is a raw API enum (Cloudy/Sunny/…); map it to a key rather
  // than interpolating the English enum into Hindi/Marathi prose.
  const getConditionLabel = (condition) =>
    t(`dashboards.farmer.condition${condition || "Cloudy"}`, "Cloudy");

  const getWeatherIcon = (condition, size = "md") => {
    const meta = WEATHER_META[condition] || WEATHER_META.Cloudy;

    const Icon = meta.icon;

    const sizes = {
      sm: "h-5 w-5",
      md: "h-7 w-7",
      lg: "h-10 w-10",
    };

    return (
      <Icon className={`${sizes[size]} ${meta.color}`} aria-hidden="true" />
    );
  };

  const getRiskConfig = (level) => {
    return RISK_CONFIG[level?.toLowerCase()] || RISK_CONFIG.medium;
  };

  const currentRisk = getRiskConfig(risk?.level || "insufficient_data");

  const getDayName = (idx) => {
    if (idx === 0) return "Today";

    const date = new Date();
    date.setDate(date.getDate() + idx);

    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    return days[date.getDay()];
  };

  const days = Array.from({ length: 7 }, (_, index) => getDayName(index));

  const getForecastRisk = (idx) => {
    if (idx > 4) return "low";
    if (idx > 1) return "high";
    return "medium";
  };

  /* ========================================================
     LOADING
  ========================================================= */

  if (loading && !weather && !weatherError) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
        <div className="mb-7 space-y-3">
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="h-8 w-64 animate-pulse rounded bg-muted" />
          <div className="h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="h-80 animate-pulse rounded-md border border-border bg-card" />
          <div className="h-80 animate-pulse rounded-md border border-border bg-card" />
        </div>

        <div className="mt-5 h-64 animate-pulse rounded-md border border-border bg-card" />
      </div>
    );
  }

  /* ========================================================
     NO FARMS
  ========================================================= */

  if (farms.length === 0) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:py-8">
        <PageHeader
          eyebrow={t("weather.farmIntelligence")}
          title={t("weather.title")}
          subtitle={t("weather.overviewSubtitle")}
        />

        <div className="rounded-md border border-border bg-card px-6 py-14 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-primary/10">
            <MapPin className="h-6 w-6 text-primary" />
          </div>

          <h2 className="mt-4 text-lg font-semibold tracking-tight text-foreground">
            {t("weather.noFarmsFound")}
          </h2>

          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            {isExtension
              ? t("weather.noCoordinateFarms")
              : t("weather.addFarmFirst")}
          </p>

          <a
            href={isExtension ? "/extension/dashboard" : "/farmer/farms"}
            className="mt-6 inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-white transition-colors hover:bg-secondary"
          >
            {isExtension ? t("weather.backToDirectory") : t("weather.goToFarms")}
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </div>
    );
  }

  /* ========================================================
     NO CROP
  ========================================================= */

  if (!selectedFarm || !selectedCrop) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:py-8">
        <PageHeader
          eyebrow={t("weather.farmIntelligence")}
          title={t("weather.title")}
          subtitle={t("weather.selectFarmSubtitle")}
        />

        <div className="rounded-md border border-accent/25 bg-accent/5 px-6 py-14 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-accent/10">
            <Leaf className="h-6 w-6 text-accent-foreground" />
          </div>

          <h2 className="mt-4 text-lg font-semibold text-foreground">
            {t("weather.selectCrop")}
          </h2>

          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            {t("weather.selectCropHelp")}
          </p>
        </div>
      </div>
    );
  }

  const activeForecast = forecast[activeDay] || forecast[0];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
      {/* ====================================================
          HEADER
      ===================================================== */}

      <div className="mb-7">
        <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-primary">
          <Leaf className="h-4 w-4" />
          {t("weather.farmIntelligence")}
        </p>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
              {t("weather.title")}
            </h1>

            <p className="mt-2 text-sm leading-relaxed text-muted-foreground md:text-base">
              {t("weather.localFieldSubtitle")}
            </p>
          </div>

          {isExtension && (
            <div className="mt-5 grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
              <Select
                label={t("weather.farmerLabel")}
                value={selectedFarm?.farmer_id || ""}
                onChange={(event) => {
                  const farm = farms.find(
                    (item) =>
                      String(item.farmer_id) === String(event.target.value),
                  );
                  setSelectedFarm(farm || null);
                  setSelectedCrop(farm?.crops?.[0] || null);
                }}
              >
                {Array.from(
                  new Map(
                    farms.map((farm) => [farm.farmer_id, farm.farmer_name]),
                  ),
                ).map(([farmerId, farmerName]) => (
                  <option key={farmerId} value={farmerId}>
                    {farmerName || t("weather.farmerFallback", { id: farmerId })}
                  </option>
                ))}
              </Select>

              <Select
                label={t("weather.farmLabel")}
                value={selectedFarm?.id || ""}
                onChange={(event) => {
                  const farm = farms.find(
                    (item) => String(item.id) === String(event.target.value),
                  );
                  setSelectedFarm(farm || null);
                  setSelectedCrop(farm?.crops?.[0] || null);
                }}
              >
                {farms
                  .filter(
                    (farm) =>
                      String(farm.farmer_id) ===
                      String(selectedFarm?.farmer_id),
                  )
                  .map((farm) => (
                    <option key={farm.id} value={farm.id}>
                      {farm.farm_name}
                    </option>
                  ))}
              </Select>

              <Select
                label={t("common.crop")}
                value={selectedCrop?.id || ""}
                disabled={!selectedFarm?.crops?.length}
                onChange={(event) =>
                  setSelectedCrop(
                    selectedFarm?.crops?.find(
                      (crop) => String(crop.id) === String(event.target.value),
                    ) || null,
                  )
                }
              >
                {!selectedFarm?.crops?.length && (
                  <option value="">{t("weather.noCropRecorded")}</option>
                )}
                {selectedFarm?.crops?.map((crop) => (
                  <option key={crop.id} value={crop.id}>
                    {crop.crop_name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {weatherError && (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {weatherError}
            </p>
          )}

          {/* Farm / crop context */}
          <div className="flex flex-wrap gap-2">
            <ContextPill icon={MapPin} label={selectedFarm.farm_name} />

            <ContextPill icon={Leaf} label={selectedCrop.crop_name} />

            <ContextPill
              icon={CalendarDays}
              label={selectedCrop.current_stage || t("farms.vegetativeStage")}
            />
          </div>
        </div>
      </div>

      {/* ====================================================
          CURRENT WEATHER + RISK
      ===================================================== */}

      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Current weather */}
        <section className="rounded-md border border-border bg-card p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("weather.currentConditions")}
              </p>

              <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
                {t("weather.currentWeather")}
              </h2>
            </div>

            <div className="rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground">
              Updated {weather?.updated_ago || "recently"}
            </div>
          </div>

          <div className="mt-7 flex items-center gap-5">
            <div
              className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-md ${
                WEATHER_META[weather?.condition]?.bg || "bg-muted"
              }`}
            >
              {getWeatherIcon(weather?.condition, "lg")}
            </div>

            <div>
              <div className="flex items-start">
                <span className="text-5xl font-semibold tracking-tight text-foreground">
                  {weather?.temperature ?? "—"}
                </span>

                <span className="mt-1 text-xl text-muted-foreground">°</span>
              </div>

              <p className="mt-1 text-sm font-medium text-foreground">
                {weather ? getConditionLabel(weather.condition) : t("weather.riskUnavailableLabel")}
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                {weather
                  ? t("weather.feelsLike", { temp: weather.temperature + 2 })
                  : t("weather.noLiveReading")}
              </p>
            </div>
          </div>

          <div className="mt-7 grid grid-cols-3 divide-x divide-border rounded-md border border-border bg-background">
            <WeatherMetric
              icon={Droplets}
              label={t("weather.metricHumidity")}
              value={weather ? `${weather.humidity}%` : "—"}
            />

            <WeatherMetric
              icon={Cloud}
              label={t("weather.metricRain")}
              value={weather ? `${weather.rainfall} mm` : "—"}
            />

            <WeatherMetric
              icon={Wind}
              label={t("weather.metricWind")}
              value={weather ? `${weather.wind_speed} km/h` : "—"}
            />
          </div>
        </section>

        {/* Risk */}
        <section
          className={`rounded-md border ${currentRisk.border} ${currentRisk.bg} p-5 sm:p-6`}
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("weather.cropHealthIntelligence")}
              </p>

              <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
                {t("weather.riskLevel")}
              </h2>
            </div>

            <div className="rounded-md bg-card/70 p-2">
              <currentRisk.icon
                className={`h-5 w-5 ${currentRisk.iconColor}`}
                aria-hidden="true"
              />
            </div>
          </div>

          <div className="mt-7">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p
                  className={`text-3xl font-semibold tracking-tight ${currentRisk.iconColor}`}
                >
                  {t(currentRisk.labelKey)}
                </p>

                <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  {t(currentRisk.descKey)}
                </p>
              </div>

              <span
                className={`text-3xl font-semibold tabular-nums ${currentRisk.iconColor}`}
              >
                {currentRisk.score}
              </span>
            </div>

            <div className="mt-6">
              <div className="mb-2 flex justify-between text-xs text-muted-foreground">
                <span>{t("weather.riskLevel")}</span>
                <span>{currentRisk.score}%</span>
              </div>

              <div className="h-2 overflow-hidden rounded-full bg-card">
                <div
                  className={`h-full rounded-full ${currentRisk.bar} transition-all duration-700`}
                  style={{
                    width: `${currentRisk.score}%`,
                  }}
                />
              </div>
            </div>
          </div>

          <div className="mt-6 flex items-start gap-3 rounded-md border border-border/70 bg-card/60 p-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />

            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("weather.riskContextNote")}
            </p>
          </div>
        </section>
      </div>

      {/* ====================================================
          7 DAY FORECAST
      ===================================================== */}

      <section className="mt-5 rounded-md border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("weather.sevenDayOutlook")}
            </p>

            <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
              {t("weather.forecast")}
            </h2>
          </div>

          <p className="text-xs text-muted-foreground">
            {t("weather.selectDayHelp")}
          </p>
        </div>

        {/* Day selector */}
        <div className="mt-5 grid grid-cols-7 gap-1 rounded-md border border-border bg-background p-1">
          {days.map((day, idx) => {
            const isActive = activeDay === idx;

            return (
              <button
                key={day + idx}
                type="button"
                onClick={() => setActiveDay(idx)}
                className={`rounded-md px-2 py-3 text-center transition-colors ${
                  isActive
                    ? "bg-primary text-white"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <span className="block text-[10px] font-medium uppercase tracking-wider">
                  {day}
                </span>

                <span
                  className={`mt-1 block text-xs ${
                    isActive ? "text-white/80" : "text-muted-foreground"
                  }`}
                >
                  {forecast[idx] ? `${forecast[idx].temp_max}°` : "—"}
                </span>
              </button>
            );
          })}
        </div>

        {/* Selected day */}
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <ForecastHighlight
            icon={Cloud}
            label={t("weather.conditionsLabel")}
            value={getConditionLabel(activeForecast?.condition)}
          />

          <ForecastHighlight
            icon={Thermometer}
            label={t("weather.temperatureLabel")}
            value={
              activeForecast
                ? `${activeForecast.temp_max}° / ${activeForecast.temp_min}°`
                : "—"
            }
          />

          <ForecastHighlight
            icon={Droplets}
            label={t("weather.metricRainfall")}
            value={
              activeForecast
                ? `${Number(activeForecast.precipitation || 0).toFixed(1)} mm`
                : "—"
            }
          />
        </div>

        {/* Forecast table */}
        <div className="mt-5 overflow-x-auto">
          <div className="min-w-[680px] rounded-md border border-border">
            <div className="grid grid-cols-7 border-b border-border bg-background">
              {days.map((day, idx) => (
                <button
                  key={`forecast-day-${idx}`}
                  type="button"
                  onClick={() => setActiveDay(idx)}
                  className={`border-r border-border px-3 py-3 text-center last:border-r-0 ${
                    activeDay === idx ? "bg-primary/5" : ""
                  }`}
                >
                  <p className="text-xs font-semibold text-foreground">{day}</p>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {days.map((day, idx) => {
                const forecastDay = forecast[idx];

                const forecastRisk = getForecastRisk(idx);

                const config = getRiskConfig(forecastRisk);

                return (
                  <div
                    key={`forecast-${idx}`}
                    className={`border-r border-border p-4 text-center last:border-r-0 ${
                      activeDay === idx ? "bg-primary/5" : ""
                    }`}
                  >
                    <div className="flex justify-center">
                      {getWeatherIcon(forecastDay?.condition || "Cloudy", "md")}
                    </div>

                    <p className="mt-3 text-sm font-semibold text-foreground">
                      {forecastDay?.temp_max ?? 27}°
                    </p>

                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {forecastDay?.temp_min ?? 19}°
                    </p>

                    <div
                      className={`mx-auto mt-4 h-1.5 w-1.5 rounded-full ${config.bar}`}
                    />

                    <p
                      className={`mt-1.5 text-[10px] font-medium ${config.iconColor}`}
                    >
                      {t(config.shortKey)}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================
          WHY + WHAT
      ===================================================== */}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {/* Why */}
        <section className="rounded-md border border-border bg-card p-5 sm:p-6">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("weather.riskDrivers")}
          </p>

          <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
            {t("weather.preventiveActions")}
          </h2>

          <div className="mt-5 divide-y divide-border">
            {[
              {
                icon: Cloud,
                label: t("weather.rainfallLabel"),
                desc: t("weather.rainfallDesc"),
              },
              {
                icon: Droplets,
                label: t("weather.humidityLabel"),
                desc: t("weather.humidityDesc"),
              },
              {
                icon: TrendingUp,
                label: t("weather.growthLabel"),
                desc: t("weather.growthDesc"),
              },
              {
                icon: AlertCircle,
                label: t("weather.historyLabel"),
                desc: t("weather.historyDesc"),
              },
            ].map((item, idx) => {
              const Icon = item.icon;

              return (
                <div key={idx} className="flex gap-4 py-4 first:pt-0 last:pb-0">
                  <span className="w-6 shrink-0 pt-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
                    0{idx + 1}
                  </span>

                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Icon
                      className="h-4 w-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </div>

                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {item.label}
                    </p>

                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {item.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Actions */}
        <section className="rounded-md border border-border bg-card p-5 sm:p-6">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("weather.fieldResponse")}
          </p>

          <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
            {t("screening.whatToDo")}
          </h2>

          <div className="mt-5 divide-y divide-border">
            {[
              {
                icon: Eye,
                label: t("weather.inspectLabel"),
                desc: t("weather.inspectDesc"),
              },
              {
                icon: TrendingUp,
                label: t("weather.monitorLabel"),
                desc: t("weather.monitorDesc"),
              },
              {
                icon: AlertCircle,
                label: t("weather.advisoryLabel"),
                desc: t("weather.advisoryDesc"),
              },
              {
                icon: Zap,
                label: t("weather.actionLabel"),
                desc: t("weather.actionDesc"),
              },
            ].map((item, idx) => {
              const Icon = item.icon;

              return (
                <div key={idx} className="flex gap-4 py-4 first:pt-0 last:pb-0">
                  <span className="w-6 shrink-0 pt-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
                    0{idx + 1}
                  </span>

                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
                    <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
                  </div>

                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {item.label}
                    </p>

                    {item.desc && (
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {item.desc}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-secondary"
          >
            {t("common.view")}
            <ArrowRight className="h-4 w-4" />
          </button>
        </section>
      </div>

      {/* ====================================================
          WEATHER ALERT
      ===================================================== */}

      <section className="mt-5 rounded-md border border-accent/25 bg-accent/5 p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent/10">
            <AlertTriangle className="h-5 w-5 text-accent-foreground" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-accent-foreground">
                {t("weather.alertLabel")}
              </p>

              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent-foreground">
                {t("weather.alertAttention")}
              </span>
            </div>

            <h3 className="mt-1 text-base font-semibold text-foreground">
              {t("weather.title")}
            </h3>

            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {t("weather.heavyRainAlert")}
            </p>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-background"
              >
                {t("common.view")}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                className="h-9 rounded-md px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ============================================================
   SUPPORTING COMPONENTS
   ============================================================ */

function PageHeader({ eyebrow, title, subtitle }) {
  return (
    <div className="mb-7">
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-primary">
        {eyebrow}
      </p>

      <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
        {title}
      </h1>

      {subtitle && (
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
          {subtitle}
        </p>
      )}
    </div>
  );
}

function ContextPill({ icon: Icon, label }) {
  return (
    <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground">
      <Icon className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />

      <span className="truncate">{label}</span>
    </div>
  );
}

function WeatherMetric({ icon: Icon, label, value }) {
  return (
    <div className="px-3 py-4 text-center">
      <Icon
        className="mx-auto h-5 w-5 text-muted-foreground"
        aria-hidden="true"
      />

      <p className="mt-2 text-sm font-semibold tabular-nums text-foreground">
        {value}
      </p>

      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function ForecastHighlight({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-background p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </div>

      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>

        <p className="mt-0.5 truncate text-sm font-semibold text-foreground">
          {value}
        </p>
      </div>
    </div>
  );
}
