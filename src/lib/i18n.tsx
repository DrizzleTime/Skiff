import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import enUS from "../locales/en-US.json";
import zhCN from "../locales/zh-CN.json";
import type { LanguagePreference } from "../types/cleanup";

export type Locale = "zh-CN" | "en-US";
export type I18nKey = keyof typeof zhCN;

type TranslationParams = Record<string, string | number>;

const dictionaries: Record<Locale, Record<I18nKey, string>> = {
  "zh-CN": zhCN,
  "en-US": enUS,
};

type I18nContextValue = {
  locale: Locale;
  languagePreference: LanguagePreference;
  setLanguagePreference: (preference: LanguagePreference) => void;
  t: (key: I18nKey, params?: TranslationParams) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [languagePreference, setLanguagePreferenceState] =
    useState<LanguagePreference>("system");

  useEffect(() => {
    async function loadLanguage() {
      try {
        const settings = await invoke<{ language?: LanguagePreference }>("get_settings");
        setLanguagePreferenceState(settings.language ?? "system");
      } catch {
        setLanguagePreferenceState("system");
      }
    }

    void loadLanguage();
  }, []);

  const locale = resolveLocale(languagePreference);

  const setLanguagePreference = useCallback((preference: LanguagePreference) => {
    setLanguagePreferenceState(preference);
  }, []);

  const t = useCallback(
    (key: I18nKey, params: TranslationParams = {}) => {
      const template = dictionaries[locale][key] ?? dictionaries["zh-CN"][key];
      return interpolate(template, params);
    },
    [locale],
  );

  const value = useMemo(
    () => ({ languagePreference, locale, setLanguagePreference, t }),
    [languagePreference, locale, setLanguagePreference, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider");
  }

  return context;
}

export function resolveLocale(preference: LanguagePreference): Locale {
  if (preference === "zh-CN" || preference === "en-US") {
    return preference;
  }

  const languages = navigator.languages.length ? navigator.languages : [navigator.language];
  return languages.some((language) => language.toLowerCase().startsWith("zh"))
    ? "zh-CN"
    : "en-US";
}

function interpolate(template: string, params: TranslationParams) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}
