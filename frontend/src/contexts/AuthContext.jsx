import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { apiService } from "../services/api";
import { supabase } from "../services/supabase";

import { useLanguage } from "./LanguageContext";

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const { changeLanguage } = useLanguage();

  const fetchProfile = useCallback(async () => {
    try {
      const { data } = await apiService.getProfile();

      setProfile(data);

      // A visitor who never chose a language on the login or signup screen gets
      // the one stored on their profile, so the two sources cannot disagree.
      // If they did choose one, their explicit choice wins and nothing is sent.
      if (!localStorage.getItem("language") && data?.language) {
        changeLanguage(data.language);
      }
    } catch (error) {
      console.error("Error fetching profile:", error);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [changeLanguage]);

  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      try {
        const {
          data: { session: currentSession },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          throw error;
        }

        if (!mounted) return;

        setSession(currentSession);
        setUser(currentSession?.user ?? null);

        if (currentSession) {
          await fetchProfile();
        } else {
          setLoading(false);
        }
      } catch (error) {
        console.error("Error initializing authentication:", error);

        if (!mounted) return;

        setSession(null);
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
    };

    initializeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!mounted) return;

      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (nextSession) {
        await fetchProfile();
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signIn = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw error;
    }

    return data;
  }, []);
  const signUpFarmer = useCallback(async ({ name, phone, email, password }) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
          phone: phone || null,
          platform_role: "farmer",
        },
      },
    });

    if (error) {
      throw error;
    }

    return data;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      throw error;
    }

    setProfile(null);
    setUser(null);
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      profile,
      session,
      loading,
      signIn,
      signOut,
      signUpFarmer,
      refreshProfile: fetchProfile,
    }),
    [user, profile, session, loading, signIn, signOut, signUpFarmer, fetchProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
