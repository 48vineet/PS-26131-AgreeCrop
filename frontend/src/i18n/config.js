import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import hi from "./locales/hi.json";
import mr from "./locales/mr.json";

const resources = {
  en: {
    translation: en,
  },
  hi: {
    translation: hi,
  },
  mr: {
    translation: mr,
  },
};

const savedLanguage = localStorage.getItem("language");

i18n.use(initReactI18next).init({
  resources,

  lng: savedLanguage || "en",

  fallbackLng: "en",

  supportedLngs: ["en", "hi", "mr"],

  interpolation: {
    escapeValue: false,
  },

  react: {
    useSuspense: false,
  },
});

export default i18n;
