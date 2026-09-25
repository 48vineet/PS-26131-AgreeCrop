import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Globe,
  Loader2,
  Mail,
  Phone,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../contexts/LanguageContext";
import api from "../services/api";

function getInitials(name) {
  if (!name) return "?";

  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) return "?";

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

/* ============================================================
   PROFILE PAGE
   ============================================================ */

const Profile = () => {
  const { t } = useTranslation();
  const { refreshProfile } = useAuth();
  const { languages, changeLanguage } = useLanguage();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [language, setLanguage] = useState("en");
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState(null);

  /* ==========================================================
     LOAD PROFILE
  ========================================================== */

  const loadProfile = async () => {
    setLoading(true);
    setLoadFailed(false);

    try {
      const { data } = await api.get("/profile/me");

      setProfile(data);
      setLanguage(data?.language || "en");
    } catch (error) {
      console.error("Failed to load profile:", error);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();

    // Profile should only load once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const languageChanged = !!profile && language !== (profile.language || "en");

  /* ==========================================================
     SAVE LANGUAGE
  ========================================================== */

  const handleSaveLanguage = async () => {
    setSaving(true);
    setSaveState(null);

    try {
      const { data } = await api.patch("/profile/language", { language });

      setProfile((prev) =>
        prev
          ? {
              ...prev,
              language: data.language,
            }
          : prev,
      );

      // The PATCH above already stored it; skip the context's own write.
      changeLanguage(data.language, { persist: false });

      await refreshProfile();

      setSaveState("success");
    } catch (error) {
      console.error("Failed to update language preference:", error);

      setSaveState("error");
    } finally {
      setSaving(false);
    }
  };

  /* ==========================================================
     LOADING STATE
  ========================================================== */

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:py-8">
        <div className="mb-7">
          <div className="h-3 w-20 animate-pulse rounded bg-muted" />

          <div className="mt-3 h-8 w-32 animate-pulse rounded bg-muted" />

          <div className="mt-2 h-4 w-72 max-w-full animate-pulse rounded bg-muted" />
        </div>

        <div
          className="overflow-hidden rounded-md border border-border bg-card"
          role="status"
          aria-label={t("profile.loading")}
          aria-live="polite"
        >
          <div className="flex items-center gap-4 px-5 py-6 sm:px-6">
            <div className="h-16 w-16 shrink-0 animate-pulse rounded-full bg-muted" />

            <div className="min-w-0 flex-1 space-y-3">
              <div className="h-4 w-40 animate-pulse rounded bg-muted" />

              <div className="h-3.5 w-56 max-w-full animate-pulse rounded bg-muted" />

              <div className="h-5 w-24 animate-pulse rounded-full bg-muted" />
            </div>
          </div>

          <div className="border-t border-border px-5 py-6 sm:px-6">
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />

            <div className="mt-3 h-10 w-full animate-pulse rounded-md bg-muted" />

            <div className="mt-3 h-10 w-32 animate-pulse rounded-md bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  /* ==========================================================
     ERROR STATE
  ========================================================== */

  if (loadFailed || !profile) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:py-8">
        <PageHeader
          eyebrow={t("profile.eyebrow")}
          title={t("profile.title")}
          subtitle={t("profile.loadFailedSubtitle")}
        />

        <div className="rounded-md border border-border bg-card px-6 py-14 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-destructive/10">
            <AlertCircle
              className="h-6 w-6 text-destructive"
              aria-hidden="true"
            />
          </div>

          <h2 className="mt-4 text-base font-semibold text-foreground">
            {t("profile.loadFailed")}
          </h2>

          <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {t("profile.checkConnection")}
          </p>

          <button
            type="button"
            onClick={loadProfile}
            className="mt-5 inline-flex h-10 items-center justify-center rounded-md border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {t("common.tryAgain")}
          </button>
        </div>
      </div>
    );
  }

  /* ==========================================================
     LOADED STATE
  ========================================================== */

  const roleLabel = profile.role
    ? t(`roles.${profile.role}`)
    : t("roles.farmer");

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:py-8">
      <PageHeader
        eyebrow={t("profile.eyebrow")}
        title={t("profile.title")}
        subtitle={t("profile.subtitle")}
      />

      <div className="overflow-hidden rounded-md border border-border bg-card">
        {/* ====================================================
            IDENTITY
        ===================================================== */}

        <section className="px-5 py-6 sm:px-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            {/* Avatar */}
            <div
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-lg font-semibold text-primary"
              aria-hidden="true"
            >
              {getInitials(profile.name)}
            </div>

            {/* Details */}
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold tracking-tight text-foreground">
                {profile.name || t("profile.unnamedUser")}
              </h2>

              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-5 sm:gap-y-2">
                <span className="inline-flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />

                  <span className="truncate">
                    {profile.email || t("profile.notProvided")}
                  </span>
                </span>

                <span className="inline-flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                  <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />

                  <span className="truncate">
                    {profile.phone || t("profile.phoneNotProvided")}
                  </span>
                </span>
              </div>

              <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                <span
                  className="h-1.5 w-1.5 rounded-full bg-primary"
                  aria-hidden="true"
                />

                {roleLabel}
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-start gap-3 rounded-md border border-border bg-background px-4 py-3">
            <ShieldCheck
              className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />

            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("profile.managedByOrg")}
            </p>
          </div>
        </section>

        {/* ====================================================
            LANGUAGE
        ===================================================== */}

        <section className="border-t border-border px-5 py-6 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
              <Globe className="h-4 w-4 text-primary" aria-hidden="true" />
            </div>

            <div>
              <h2 className="text-base font-semibold tracking-tight text-foreground">
                {t("profile.languagePreference")}
              </h2>

              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {t("profile.languagePreferenceBody")}
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-full sm:max-w-xs">
              <label
                htmlFor="profile-language"
                className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                {t("profile.applicationLanguage")}
              </label>

              <div className="relative">
                <select
                  id="profile-language"
                  value={language}
                  onChange={(event) => {
                    setLanguage(event.target.value);
                    setSaveState(null);
                  }}
                  disabled={saving}
                  className="h-10 w-full appearance-none rounded-md border border-border bg-card px-3 pr-10 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {languages.map((lng) => (
                    <option key={lng.code} value={lng.code}>
                      {lng.label}
                    </option>
                  ))}
                </select>

                <ChevronDown
                  className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleSaveLanguage}
              disabled={saving || !languageChanged}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-white transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              )}

              {saving ? t("common.saving") : t("profile.saveLanguage")}
            </button>
          </div>

          {/* Save feedback */}
          <div className="mt-4" aria-live="polite">
            {saveState === "success" && (
              <div className="flex items-start gap-3 rounded-md border border-primary/20 bg-primary/5 px-4 py-3">
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                  aria-hidden="true"
                />

                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t("profile.languageUpdated")}
                  </p>

                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t("profile.languageUpdatedBody")}
                  </p>
                </div>
              </div>
            )}

            {saveState === "error" && (
              <div className="flex items-start gap-3 rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3">
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                  aria-hidden="true"
                />

                <div>
                  <p className="text-sm font-medium text-destructive">
                    {t("profile.languageUpdateFailed")}
                  </p>

                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t("common.tryAgain")}
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ====================================================
            ACCOUNT STATUS
        ===================================================== */}

        <section className="border-t border-border bg-background/40 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
              <UserRound
                className="h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("profile.accountRole")}
              </p>

              <p className="mt-0.5 text-sm font-medium text-foreground">
                {roleLabel}
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

/* ============================================================
   PAGE HEADER
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
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground md:text-base">
          {subtitle}
        </p>
      )}
    </div>
  );
}

export default Profile;
