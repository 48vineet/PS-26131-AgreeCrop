import {
  ArrowRight,
  Bug,
  Camera,
  CheckCircle2,
  ChevronDown,
  Leaf,
  Map,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import Alert from "../components/ui/Alert";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import LanguageSelector from "../components/ui/LanguageSelector";
import { useAuth } from "../contexts/AuthContext";

const CAPABILITIES = [
  { icon: Camera, key: "screening" },
  { icon: Bug, key: "pest" },
  { icon: Map, key: "hotspot" },
  { icon: CheckCircle2, key: "validation" },
];

const Login = () => {
  const { t } = useTranslation();
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();

    setError("");
    setLoading(true);

    try {
      await signIn(email, password);
      navigate("/");
    } catch (err) {
      setError(err.message || t("auth.signInFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Mobile brand bar */}
      <div className="flex items-center justify-between border-b border-border bg-card px-5 py-4 lg:hidden">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary">
            <Leaf className="h-5 w-5 text-white" aria-hidden="true" />
          </div>

          <div>
            <p className="text-sm font-semibold tracking-tight text-foreground">
              {t("app.name")}
            </p>

            <p className="text-xs text-muted-foreground">{t("app.tagline")}</p>
          </div>
        </div>

        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("auth.agriIntelligence")}
        </div>
      </div>

      <div className="flex min-h-screen flex-col lg:flex-row">
        {/* Brand / product panel */}
        <aside className="relative hidden overflow-hidden bg-secondary text-white lg:flex lg:w-[45%] lg:flex-col lg:justify-between lg:p-12 xl:p-14">
          <div className="relative">
            {/* Restrained decorative geometry */}
            <div
              className="pointer-events-none absolute -right-28 -top-28 h-72 w-72 rounded-full border border-white/10"
              aria-hidden="true"
            />

            <div
              className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full border border-white/10"
              aria-hidden="true"
            />

            {/* Brand */}
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/10">
                <Leaf className="h-5.5 w-5.5 text-white" aria-hidden="true" />
              </div>

              <div>
                <p className="text-lg font-semibold tracking-tight text-white">
                  {t("app.name")}
                </p>

                <p className="text-sm text-white/60">{t("app.tagline")}</p>
              </div>
            </div>

            {/* Hero */}
            <div className="mt-16 max-w-lg">
              <p className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-primary-foreground/70">
                {t("auth.platformEyebrow")}
              </p>

              <h1 className="text-3xl font-semibold leading-tight tracking-tight text-white xl:text-[2.7rem]">
                {t("auth.heroTitle")}
              </h1>

              <p className="mt-5 max-w-md text-[15px] leading-7 text-white/65">
                {t("auth.heroBody")}
              </p>
            </div>

            {/* Capabilities */}
            <div className="mt-12 space-y-0">
              {CAPABILITIES.map(({ icon: Icon, key }, index) => (
                <div
                  key={key}
                  className={[
                    "flex items-start gap-4 py-5",
                    index === 0
                      ? "border-t border-white/10"
                      : "border-t border-white/10",
                  ].join(" ")}
                >
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/8">
                    <Icon className="h-4 w-4 text-white" aria-hidden="true" />
                  </div>

                  <div>
                    <p className="text-sm font-medium text-white">
                      {t(`auth.capabilities.${key}.label`)}
                    </p>

                    <p className="mt-1 max-w-sm text-sm leading-relaxed text-white/55">
                      {t(`auth.capabilities.${key}.description`)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Product facts */}
          <div className="relative mt-12 border-t border-white/10 pt-7">
            <div className="grid grid-cols-3 gap-5">
              <div>
                <p className="text-xl font-semibold tabular-nums text-white">
                  38
                </p>
                <p className="mt-1 text-xs text-white/50">
                  {t("auth.diseaseClasses")}
                </p>
              </div>

              <div>
                <p className="text-xl font-semibold tabular-nums text-white">
                  14
                </p>
                <p className="mt-1 text-xs text-white/50">
                  {t("auth.supportedCrops")}
                </p>
              </div>

              <div>
                <p className="text-xl font-semibold tabular-nums text-white">
                  3
                </p>
                <p className="mt-1 text-xs text-white/50">
                  {t("auth.userRoles")}
                </p>
              </div>
            </div>
          </div>
        </aside>

        {/* Authentication panel */}
        <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8 lg:px-12 xl:px-16">
          <div className="w-full max-w-md">
            {/* Language */}
            <div className="mb-12 flex justify-end">
              <LanguageSelector variant="panel" />
            </div>

            {/* Heading */}
            <div className="mb-8">
              <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-md border border-primary/20 bg-primary/10 lg:hidden">
                <Leaf className="h-5 w-5 text-primary" aria-hidden="true" />
              </div>

              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-primary">
                {t("auth.welcomeBack")}
              </p>

              <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                {t("auth.welcome")}
              </h2>

              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t("auth.welcomeMessage")}
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && <Alert variant="danger">{error}</Alert>}

              <Input
                label={t("auth.email")}
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />

              <Input
                label={t("auth.password")}
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />

              <Button
                type="submit"
                size="lg"
                loading={loading}
                className="group w-full"
              >
                <span>{t("auth.signIn")}</span>

                {!loading && (
                  <ArrowRight
                    className="ml-1 h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                )}
              </Button>
            </form>

            {/* Test accounts */}
            <details className="mt-10 border-t border-border pt-5">
              <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <span className="inline-flex items-center gap-2">
                  {t("auth.testAccounts")}
                  <ChevronDown className="h-3.5 w-3.5" />
                </span>
              </summary>

              <div className="mt-4 rounded-md border border-border bg-card p-4">
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">
                      {t("roles.farmer")}
                    </span>
                    <span className="font-mono text-foreground">
                      farmer@email.com
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">
                      {t("roles.extensionOfficer")}
                    </span>
                    <span className="font-mono text-foreground">
                      extension@email.com
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">
                      {t("roles.official")}
                    </span>
                    <span className="font-mono text-foreground">
                      official@email.com
                    </span>
                  </div>

                  <div className="mt-3 border-t border-border pt-3">
                    <span className="text-muted-foreground">
                      {t("auth.passwordLabel")}{" "}
                    </span>
                    <span className="font-mono text-foreground">Pass@123</span>
                  </div>
                </div>
              </div>
            </details>

            {/* Footer */}
            <div className="mt-4 text-center text-sm">
              <span className="text-muted-foreground">
                {t("auth.newFarmer")}{" "}
              </span>
              <Link to="/signup" className="font-medium text-primary transition-colors hover:text-secondary">
                {t("auth.createFarmerAccount")}
              </Link>
            </div>
            <p className="mt-10 text-center text-xs leading-relaxed text-muted-foreground">
              {t("auth.secureAccess")}
            </p>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Login;
