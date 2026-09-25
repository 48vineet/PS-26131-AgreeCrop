import { ArrowLeft, Leaf } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import Alert from "../components/ui/Alert";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import LanguageSelector from "../components/ui/LanguageSelector";
import { useAuth } from "../contexts/AuthContext";

const FarmerSignup = () => {
  const { t } = useTranslation();
  const { signUpFarmer } = useAuth();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const handleChange = (event) => {
    setFormData((previous) => ({
      ...previous,
      [event.target.id]: event.target.value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccessMessage("");

    if (formData.password.length < 8) {
      setError(t("auth.passwordTooShort"));
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError(t("auth.passwordsDoNotMatch"));
      return;
    }

    setLoading(true);

    try {
      const result = await signUpFarmer({
        name: formData.name.trim(),
        phone: formData.phone.trim(),
        email: formData.email.trim(),
        password: formData.password,
      });

      if (result?.session) {
        navigate("/");
        return;
      }

      setSuccessMessage(t("auth.signUpSuccess"));
      setFormData((previous) => ({
        ...previous,
        password: "",
        confirmPassword: "",
      }));
    } catch (signupError) {
      setError(signupError.message || t("auth.signUpFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background px-4 py-10 text-foreground sm:px-6 lg:py-14">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary">
              <Leaf className="h-5 w-5 text-white" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {t("app.name")}
              </p>
              <p className="text-xs text-muted-foreground">{t("app.tagline")}</p>
            </div>
          </div>

          <LanguageSelector variant="topbar" />
        </div>

        <section className="rounded-md border border-border bg-card p-6">
          <p className="text-xs font-medium uppercase tracking-wider text-primary">
            {t("auth.farmerRegistration")}
          </p>

          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
            {t("auth.signUp")}
          </h1>

          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {t("auth.signUpMessage")}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            {error && <Alert variant="danger">{error}</Alert>}
            {successMessage && <Alert variant="success">{successMessage}</Alert>}

            <Input
              label={t("auth.fullName")}
              id="name"
              type="text"
              required
              autoComplete="name"
              value={formData.name}
              onChange={handleChange}
              placeholder={t("auth.fullNamePlaceholder")}
            />

            <Input
              label={t("auth.phone")}
              id="phone"
              type="tel"
              autoComplete="tel"
              value={formData.phone}
              onChange={handleChange}
              placeholder={t("auth.phonePlaceholder")}
            />

            <Input
              label={t("auth.email")}
              id="email"
              type="email"
              required
              autoComplete="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="you@example.com"
            />

            <Input
              label={t("auth.password")}
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={formData.password}
              onChange={handleChange}
              placeholder={t("auth.passwordPlaceholder")}
            />

            <Input
              label={t("auth.confirmPassword")}
              id="confirmPassword"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder={t("auth.confirmPasswordPlaceholder")}
            />

            <Button type="submit" size="lg" loading={loading} className="w-full">
              {t("auth.signUp")}
            </Button>
          </form>

          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
            {t("auth.signUpNote")}
          </p>
        </section>

        <Link
          to="/login"
          className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary transition-colors hover:text-secondary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("auth.backToSignIn")}
        </Link>
      </div>
    </div>
  );
};

export default FarmerSignup;