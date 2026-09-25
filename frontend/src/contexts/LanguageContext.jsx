import { createContext, useCallback, useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";

import api from "../services/api";
import { supabase } from "../services/supabase";

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी" },
  { code: "mr", label: "मराठी" },
];

const LanguageContext = createContext(null);

export const useLanguage = () => {
  const context = useContext(LanguageContext);

  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }

  return context;
};

/* The one place a language ever changes. Every selector calls this; nothing
   else writes localStorage or PATCHes the profile. A failed profile write is
   deliberately swallowed: the interface language is a client concern that must
   never be blocked by the network, and the next change retries the write. */
const persistPreference = async (language) => {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.access_token) {
      await api.patch("/profile/language", { language });
    }
  } catch (error) {
    console.warn("Could not persist language preference:", error);
  }
};

export const LanguageProvider = ({ children }) => {
  const { i18n } = useTranslation();

  /* `persist: false` is for a caller that is about to PATCH the profile itself
     (Profile.jsx's save button) and would otherwise write it twice. */
  const changeLanguage = useCallback(
    (language, { persist = true } = {}) => {
      if (!LANGUAGES.some((item) => item.code === language)) return;

      i18n.changeLanguage(language);
      localStorage.setItem("language", language);

      if (persist) persistPreference(language);
    },
    [i18n],
  );

  const value = useMemo(
    () => ({
      languages: LANGUAGES,
      currentLanguage: i18n.resolvedLanguage || i18n.language || "en",
      changeLanguage,
    }),
    [i18n.resolvedLanguage, i18n.language, changeLanguage],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};
