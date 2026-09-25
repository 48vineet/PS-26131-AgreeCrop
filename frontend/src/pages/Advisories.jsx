import { BookOpen, ChevronRight, Leaf, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import AdvisoryStepPanel from "../components/ui/AdvisoryStepPanel";
import Alert from "../components/ui/Alert";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import LoadingState from "../components/ui/LoadingState";
import PageHeader from "../components/ui/PageHeader";
import SectionHeader from "../components/ui/SectionHeader";
import Select from "../components/ui/Select";
import Skeleton from "../components/ui/Skeleton";
import StatusBadge from "../components/ui/StatusBadge";
import { useAuth } from "../contexts/AuthContext";
import api from "../services/api";
import { buildSteps, categoryKey } from "../utils/advisoryHelpers";

export default function Advisories() {
  const { profile } = useAuth();
  const { t, i18n } = useTranslation();
  const isFarmer = profile?.role === "farmer";

  const [meta, setMeta] = useState({ status: "loading", data: null });
  const [farms, setFarms] = useState({ status: "idle", data: [] });
  const [advisories, setAdvisories] = useState({
    status: "loading",
    data: null,
  });

  const [crop, setCrop] = useState("");
  const [condition, setCondition] = useState("");
  const [category, setCategory] = useState("");

  const loadMeta = useCallback(async () => {
    setMeta((s) => ({ ...s, status: "loading" }));

    try {
      const res = await api.get("/advisories/meta", {
        params: { language: i18n.language },
      });

      setMeta({
        status: "ready",
        data: res.data,
      });
    } catch {
      setMeta({
        status: "error",
        data: null,
      });
    }
  }, [i18n.language]);

  const loadFarms = useCallback(async () => {
    setFarms((s) => ({
      ...s,
      status: "loading",
    }));

    try {
      const res = await api.get("/profile/farms");

      setFarms({
        status: "ready",
        data: res.data || [],
      });
    } catch {
      setFarms({
        status: "error",
        data: [],
      });
    }
  }, []);

  const loadAdvisories = useCallback(async () => {
    setAdvisories((s) => ({
      ...s,
      status: "loading",
    }));

    try {
      const res = await api.get("/advisories", {
        params: {
          crop: crop || undefined,
          condition: condition || undefined,
          category: category || undefined,
          language: i18n.language,
        },
      });

      setAdvisories({
        status: "ready",
        data: res.data,
      });
    } catch {
      setAdvisories({
        status: "error",
        data: null,
      });
    }
  }, [crop, condition, category, i18n.language]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    if (isFarmer) {
      loadFarms();
    }
  }, [isFarmer, loadFarms]);

  useEffect(() => {
    loadAdvisories();
  }, [loadAdvisories]);

  const farmerCrops = useMemo(() => {
    if (!isFarmer) return [];

    const names = new Set();

    farms.data.forEach((farm) =>
      (farm.crops || []).forEach((c) => {
        if (!c.crop_name) return;

        c.crop_name
          .split(/[,/]+/)
          .map((part) => part.trim())
          .filter(Boolean)
          .forEach((name) => names.add(name));
      }),
    );

    return Array.from(names);
  }, [farms.data, isFarmer]);

  const conditionsForCrop = useMemo(() => {
    if (!meta.data || !crop) return [];

    const seen = new Set();

    return meta.data.conditions_covered.filter((entry) => {
      if (entry.crop !== crop || seen.has(entry.condition)) {
        return false;
      }

      seen.add(entry.condition);
      return true;
    });
  }, [meta.data, crop]);

  const pickCrop = (name) => {
    setCrop(name);
    setCondition("");
  };

  const clearAll = () => {
    setCrop("");
    setCondition("");
    setCategory("");
  };

  const openCondition = (advisory) => {
    setCrop(advisory.crop);
    setCondition(advisory.condition);
  };

  const renderFilters = () => {
    if (meta.status === "loading") {
      return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      );
    }

    if (meta.status === "error") {
      return (
        <ErrorState
          title={t("advisories.filtersLoadFailed")}
          description={t("common.tryAgain")}
          onRetry={loadMeta}
          className="py-6"
        />
      );
    }

    return (
      <>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Select
            label={t("advisories.cropLabel")}
            value={crop}
            onChange={(e) => pickCrop(e.target.value)}
          >
            <option value="">{t("advisories.allCrops")}</option>

            {meta.data.crops_covered.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>

          <Select
            label={t("advisories.conditionLabel")}
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            disabled={!crop}
            hint={!crop ? t("advisories.chooseCropFirst") : undefined}
          >
            <option value="">{t("advisories.allConditions")}</option>

            {conditionsForCrop.map((entry) => (
              <option key={entry.condition} value={entry.condition}>
                {entry.condition}
              </option>
            ))}
          </Select>

          <Select
            label={t("advisories.categoryLabel")}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">{t("advisories.allCategories")}</option>

            {meta.data.categories.map((c) => (
              <option key={c.category} value={c.category}>
                {t(categoryKey(c.category))}
              </option>
            ))}
          </Select>
        </div>

        {isFarmer && farmerCrops.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t("advisories.yourCrops")}
            </span>

            {farmerCrops.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => pickCrop(name)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card ${
                  crop === name
                    ? "border-primary bg-primary text-white"
                    : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        {(crop || category) && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            {condition ? (
              <p className="text-sm text-muted-foreground">
                {t("advisories.showingGuidanceFor")}{" "}
                <span className="font-medium text-foreground">{crop}</span>
                {" · "}
                <span className="font-medium text-foreground">{condition}</span>
              </p>
            ) : (
              <span />
            )}

            <Button variant="ghost" size="sm" icon={X} onClick={clearAll}>
              {t("advisories.clearFilters")}
            </Button>
          </div>
        )}
      </>
    );
  };

  const renderBrowse = () => {
    if (advisories.status === "loading") {
      return <LoadingState variant="list" rows={4} />;
    }

    if (advisories.status === "error") {
      return (
        <ErrorState
          title={t("advisories.loadFailed")}
          description={t("common.tryAgain")}
          onRetry={loadAdvisories}
        />
      );
    }

    const groups = advisories.data?.groups || [];

    if (groups.length === 0) {
      return (
        <Card>
          <EmptyState
            icon={Leaf}
            title={t("advisories.noMatchTitle")}
            description={
              advisories.data?.no_match_reason ||
              t("advisories.noMatchDefault")
            }
            action={
              crop || category ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setCrop("");
                    setCategory("");
                  }}
                >
                  {t("advisories.clearFilters")}
                </Button>
              ) : undefined
            }
          />
        </Card>
      );
    }

    return (
      <div className="space-y-8">
        {groups.map((group) => (
          <div key={group.category}>
            <SectionHeader
              title={t(categoryKey(group.category))}
              subtitle={group.meaning}
            />

            <div className="space-y-3">
              {group.advisories.map((advisory) => (
                <Card
                  key={advisory.advisory_id}
                  interactive
                  role="button"
                  tabIndex={0}
                  onClick={() => openCondition(advisory)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openCondition(advisory);
                    }
                  }}
                  padding="p-4"
                  className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="primary">{advisory.crop}</Badge>

                        <span className="text-sm font-medium text-foreground">
                          {advisory.condition}
                        </span>

                        {advisory.safety?.applies && (
                          <StatusBadge status="warning">
                            {t("advisories.chemicalSafety")}
                          </StatusBadge>
                        )}
                      </div>

                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        {advisory.recommendation}
                      </p>

                      {advisory.source_name && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {t("advisories.sourceLabel")} {advisory.source_name}
                        </p>
                      )}
                    </div>

                    <ChevronRight
                      className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderConditionFocused = () => {
    if (advisories.status === "loading") {
      return <LoadingState variant="list" rows={3} />;
    }

    if (advisories.status === "error") {
      return (
        <ErrorState
          title={t("advisories.loadFailed")}
          description={t("common.tryAgain")}
          onRetry={loadAdvisories}
        />
      );
    }

    const data = advisories.data;

    if (!data) return null;

    const steps = buildSteps(data.groups || [], t);
    const general = data.general_for_crop;

    return (
      <div className="space-y-6">
        <AdvisoryStepPanel steps={steps} />

        {steps.length === 0 && data.no_match_reason && (
          <Alert
            variant="info"
            title={t("advisories.noAdvisoryMatched")}
          >
            {data.no_match_reason}
          </Alert>
        )}

        {general && general.total > 0 && (
          <div>
            <SectionHeader
              title={t("advisories.generalPracticeForCrop")}
              subtitle={general.note}
            />

            <div className="space-y-3">
              {general.advisories.map((advisory) => (
                <Card key={advisory.advisory_id} padding="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="warning">{t("advisories.generalPracticeBadge")}</Badge>

                    <Badge variant="neutral">
                      {t(categoryKey(advisory.category))}
                    </Badge>

                    <span className="text-sm font-medium text-foreground">
                      {advisory.condition}
                    </span>
                  </div>

                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {advisory.recommendation}
                  </p>

                  {advisory.source_name && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("advisories.source")}: {advisory.source_name}
                    </p>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )}

        {data.matched && data.matched.length > 0 && (
          <Card>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <BookOpen
                className="h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              {t("advisories.sources")}
            </h3>

            <ul className="mt-3 divide-y divide-border">
              {data.matched.map((advisory) => (
                <li
                  key={advisory.advisory_id}
                  className="pb-3 pt-3 text-sm first:pt-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="neutral">
                      {t(categoryKey(advisory.category))}
                    </Badge>

                    {advisory.source_url ? (
                      <a
                        href={advisory.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {advisory.source_name}
                      </a>
                    ) : (
                      <span className="font-medium text-foreground">
                        {advisory.source_name}
                      </span>
                    )}
                  </div>

                  {advisory.evidence_quote && (
                    <p className="mt-1 leading-relaxed text-muted-foreground">
                      &ldquo;{advisory.evidence_quote}&rdquo;
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6 lg:space-y-10 lg:px-8 lg:py-10">
      <PageHeader
        title={t("advisories.title")}
        subtitle={t("advisories.subtitle")}
      />

      <Card>
        <SectionHeader
          title={t("advisories.filterTitle")}
          subtitle={t("advisories.filterSubtitle")}
        />

        {renderFilters()}
      </Card>

      <section
        aria-label={
          condition
            ? t("advisories.guidanceFor", { crop, condition })
            : t("advisories.libraryLabel")
        }
      >
        {condition ? renderConditionFocused() : renderBrowse()}
      </section>
    </div>
  );
}
