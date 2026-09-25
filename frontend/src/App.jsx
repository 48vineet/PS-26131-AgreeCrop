import { useEffect, useRef } from "react";
import {
  Navigate,
  Route,
  BrowserRouter as Router,
  Routes,
  useNavigate,
} from "react-router-dom";

import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { LanguageProvider } from "./contexts/LanguageContext";

import Login from "./pages/Login";
import FarmerSignup from "./pages/FarmerSignup";

import ExtensionDashboard from "./pages/ExtensionDashboard";
import ExtensionFarmDetail from "./pages/ExtensionFarmDetail";
import FarmerDashboard from "./pages/FarmerDashboard";
import OfficialDashboard from "./pages/OfficialDashboard";

import Advisories from "./pages/Advisories";
import Analytics from "./pages/Analytics";
import DiseaseMap from "./pages/DiseaseMap";
import DiseaseScreening from "./pages/DiseaseScreening";
import ExpertValidation from "./pages/ExpertValidation";
import FarmDetail from "./pages/FarmDetail";
import FarmerFarms from "./pages/FarmerFarms";
import FieldMonitoring from "./pages/FieldMonitoring";
import OfficialMap from "./pages/OfficialMap";
import PestMonitoring from "./pages/PestMonitoring";
import Profile from "./pages/Profile";
import WeatherRisk from "./pages/WeatherRisk";

import Layout from "./components/Layout";

/* ============================================================
   PREMIUM LOADING SCREEN
   ============================================================ */

const LoadingScreen = () => {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="relative flex h-10 w-10 items-center justify-center">
          <div className="absolute inset-0 rounded-full border-2 border-muted" />

          <div className="h-10 w-10 animate-spin rounded-full border-2 border-transparent border-t-primary" />
        </div>

        <p className="text-sm text-muted-foreground">
          Loading your workspace...
        </p>
      </div>
    </div>
  );
};

/* ============================================================
   ROLE-BASED PROTECTED ROUTE
   ============================================================ */

const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    const userDashboard =
      profile.role === "extension_officer"
        ? "/extension/dashboard"
        : profile.role === "official"
          ? "/official/dashboard"
          : "/farmer/dashboard";

    return <Navigate to={userDashboard} replace />;
  }

  return children;
};

/* ============================================================
   ROLE-BASED ROOT REDIRECT
   ============================================================ */

const RoleBasedRedirect = () => {
  const { profile, loading } = useAuth();
  const navigate = useNavigate();
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (!loading && profile && !hasRedirected.current) {
      hasRedirected.current = true;

      const path =
        profile.role === "extension_officer"
          ? "/extension/dashboard"
          : profile.role === "official"
            ? "/official/dashboard"
            : "/farmer/dashboard";

      navigate(path, { replace: true });
    }
  }, [profile, loading, navigate]);

  if (loading) {
    return <LoadingScreen />;
  }

  return null;
};

/* ============================================================
   APPLICATION ROUTES
   ============================================================ */

function AppRoutes() {
  return (
    <Router>
      <Routes>
        {/* =====================================================
            AUTHENTICATION
            ===================================================== */}

        <Route path="/login" element={<Login />} />

        <Route path="/signup" element={<FarmerSignup />} />

        {/* =====================================================
            ROOT
            ===================================================== */}

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <RoleBasedRedirect />
            </ProtectedRoute>
          }
        />

        {/* =====================================================
            FARMER
            ===================================================== */}

        <Route
          path="/farmer/*"
          element={
            <ProtectedRoute allowedRoles={["farmer"]}>
              <Layout role="farmer">
                <Routes>
                  <Route path="dashboard" element={<FarmerDashboard />} />

                  <Route path="screening" element={<DiseaseScreening />} />

                  <Route path="pest-monitoring" element={<PestMonitoring />} />

                  <Route path="weather" element={<WeatherRisk />} />

                  <Route path="advisories" element={<Advisories />} />

                  <Route path="monitoring" element={<FieldMonitoring />} />

                  <Route path="farms" element={<FarmerFarms />} />

                  <Route path="farms/:farmId" element={<FarmDetail />} />

                  <Route path="profile" element={<Profile />} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          }
        />

        {/* =====================================================
            EXTENSION OFFICER
            ===================================================== */}

        <Route
          path="/extension/*"
          element={
            <ProtectedRoute allowedRoles={["extension_officer"]}>
              <Layout role="extension_officer">
                <Routes>
                  <Route path="dashboard" element={<ExtensionDashboard />} />

                  <Route path="farmers/:farmId" element={<ExtensionFarmDetail />} />
                  <Route path="validation" element={<ExpertValidation />} />

                  <Route path="map" element={<DiseaseMap />} />

                  <Route path="pest-monitoring" element={<PestMonitoring />} />

                  <Route path="weather" element={<WeatherRisk />} />

                  <Route path="advisories" element={<Advisories />} />

                  <Route path="monitoring" element={<FieldMonitoring />} />

                  <Route path="profile" element={<Profile />} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          }
        />

        {/* =====================================================
            OFFICIAL
            ===================================================== */}

        <Route
          path="/official/*"
          element={
            <ProtectedRoute allowedRoles={["official"]}>
              <Layout role="official">
                <Routes>
                  <Route path="dashboard" element={<OfficialDashboard />} />

                  <Route path="map" element={<OfficialMap />} />

                  <Route path="analytics" element={<Analytics />} />

                  <Route path="advisories" element={<Advisories />} />

                  <Route path="profile" element={<Profile />} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </Router>
  );
}

/* ============================================================
   APPLICATION ROOT
   ============================================================ */

function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </LanguageProvider>
  );
}

export default App;
