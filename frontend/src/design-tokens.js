// CROP Platform Design Tokens
// Premium minimalist agricultural surveillance design system.
// Keep these tokens synchronized with the global CSS and Tailwind configuration.

export const colors = {
  /* ============================================
     PRIMARY — AGRICULTURAL GREEN
     ============================================ */

  primary: {
    50: "#E8F7F1",
    100: "#D1EFE3",
    200: "#A5DFC7",
    300: "#79CFAB",
    400: "#4DBF8F",
    500: "#1D9F76",
    600: "#168463",
    700: "#0F7058",
    800: "#0B5947",
    900: "#073D31",
  },

  /* ============================================
     EARTH / NEUTRAL
     ============================================ */

  neutral: {
    50: "#F4EFE4",
    100: "#E9E4D8",
    200: "#E3DDCF",
    300: "#D2CBBB",
    400: "#CFC8B8",
    500: "#A89F8F",
    600: "#837C70",
    700: "#5E5A52",
    800: "#2E2E2E",
    900: "#1E1E1E",
  },

  /* ============================================
     ACCENT
     ============================================ */

  accent: {
    50: "#FFF7E8",
    100: "#FDEBC8",
    200: "#F9D695",
    300: "#F5BC5D",
    400: "#EFA02A",
    500: "#D98B14",
    600: "#B9700D",
    700: "#92570B",
    800: "#704209",
    900: "#4A2B05",
  },

  /* ============================================
     CHART / DATA COLORS
     ============================================ */

  chart: {
    1: "#F26A4B",
    2: "#1E1E1E",
    3: "#5E5A52",
    4: "#A89F8F",
    5: "#CFC8B8",
  },

  /* ============================================
     SEMANTIC STATUS COLORS
     ============================================ */

  alert: {
    danger: "#DC2626",
    warning: "#EFA02A",
    success: "#1D9F76",
    info: "#5E5A52",
  },

  /* ============================================
     APPLICATION SURFACES
     ============================================ */

  surface: {
    background: "#E9E4D8",
    card: "#F4EFE4",
    sidebar: "#E3DDCF",
    border: "#D2CBBB",
    muted: "#CFC8B8",
  },
};

/* ============================================
   TYPOGRAPHY
   ============================================ */

export const typography = {
  pageTitle:
    "text-2xl md:text-3xl font-semibold tracking-tight text-foreground",

  pageSubtitle: "text-sm md:text-base text-muted-foreground leading-relaxed",

  sectionTitle:
    "text-lg md:text-xl font-semibold tracking-tight text-foreground",

  cardTitle: "text-base font-semibold tracking-tight text-foreground",

  label: "text-sm font-medium text-muted-foreground",

  body: "text-base text-foreground leading-relaxed",

  bodySmall: "text-sm text-muted-foreground leading-relaxed",

  caption: "text-xs text-muted-foreground",

  metric: "text-3xl font-semibold tracking-tight text-foreground tabular-nums",
};

/* ============================================
   COMPONENT TOKENS
   ============================================ */

export const components = {
  /* --------------------------------------------
     CARD
     -------------------------------------------- */

  card: {
    base: "bg-card text-card-foreground border border-border rounded-md",

    hover: "hover:border-muted-foreground/30 transition-colors duration-150",

    interactive:
      "cursor-pointer hover:border-primary/50 transition-colors duration-150",
  },

  /* --------------------------------------------
     STAT CARD
     -------------------------------------------- */

  statCard: {
    base: "bg-card text-card-foreground border border-border rounded-md",

    primary: "border-l-2 border-l-primary",

    accent: "border-l-2 border-l-accent",

    danger: "border-l-2 border-l-destructive",

    neutral: "border-l-2 border-l-muted-foreground",
  },

  /* --------------------------------------------
     BUTTONS
     -------------------------------------------- */

  button: {
    primary:
      "bg-primary text-white hover:bg-secondary active:bg-secondary font-medium px-4 py-2 h-10 rounded-md transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed",

    secondary:
      "bg-card border border-border text-foreground hover:bg-background hover:border-muted-foreground/40 active:bg-muted font-medium px-4 py-2 h-10 rounded-md transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed",

    danger:
      "bg-destructive text-white hover:bg-red-700 active:bg-red-800 font-medium px-4 py-2 h-10 rounded-md transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed",

    ghost:
      "text-muted-foreground hover:bg-muted hover:text-foreground active:bg-border font-medium px-3 py-2 h-10 rounded-md transition-colors duration-150",
  },

  /* --------------------------------------------
     INPUT
     -------------------------------------------- */

  input: {
    base: "w-full px-3 py-2 h-10 bg-card border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/25 focus:border-primary focus:outline-none transition-colors duration-150",

    error:
      "border-destructive focus:ring-destructive/20 focus:border-destructive",
  },

  /* --------------------------------------------
     BADGES
     -------------------------------------------- */

  badge: {
    healthy:
      "inline-flex items-center px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded-full",

    warning:
      "inline-flex items-center px-2 py-0.5 text-xs font-medium bg-accent/15 text-accent-foreground rounded-full",

    danger:
      "inline-flex items-center px-2 py-0.5 text-xs font-medium bg-destructive/10 text-destructive rounded-full",

    info: "inline-flex items-center px-2 py-0.5 text-xs font-medium bg-muted text-foreground rounded-full",

    neutral:
      "inline-flex items-center px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground rounded-full",
  },

  /* --------------------------------------------
     PAGE LAYOUT
     -------------------------------------------- */

  pageContainer: "max-w-[1400px] mx-auto px-4 py-6 sm:px-6 lg:px-8 lg:py-8",

  section: "mb-8 md:mb-10",
};

/* ============================================
   ICON SIZES
   ============================================ */

export const iconSizes = {
  xs: "w-4 h-4",
  sm: "w-5 h-5",
  md: "w-6 h-6",
  lg: "w-8 h-8",
  xl: "w-10 h-10",
};

/* ============================================
   CARD HELPER
   ============================================ */

export const cardClasses = (variant = "base", interactive = false) => {
  const classes = [components.card.base];

  if (interactive) {
    classes.push(components.card.interactive);
  }

  if (variant !== "base" && components.statCard[variant]) {
    classes.push(components.statCard[variant]);
  }

  return classes.join(" ");
};

/* ============================================
   STATUS → VISUAL VARIANT
   ============================================ */

export const statusColor = (status) => {
  const statusMap = {
    healthy: "healthy",
    good: "healthy",
    low: "healthy",

    moderate: "warning",
    medium: "warning",

    high: "danger",
    danger: "danger",
    critical: "danger",

    info: "info",
  };

  return statusMap[status?.toLowerCase()] || "info";
};
