"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { en } from "./i18n.en";

export type Locale = "fa" | "en";

interface I18n {
  locale: Locale;
  setLocale(locale: Locale): void;
  tr(fa: string): string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("fa");

  useEffect(() => {
    try {
      if (localStorage.getItem("locale") === "en") setLocaleState("en");
    } catch {}
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "fa" ? "rtl" : "ltr";
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem("locale", next);
    } catch {}
  }, []);

  const tr = useCallback((fa: string) => (locale === "en" ? (en[fa] ?? fa) : fa), [locale]);

  return <I18nContext.Provider value={{ locale, setLocale, tr }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}
