import { en } from "./en";
import { ja } from "./ja";
import type { AgentLocale } from "../types";

const dictionaries = { en, ja } as const;

export function detectInitialLocale(): AgentLocale {
  if (typeof window === "undefined") {
    return "ja";
  }

  const stored = window.localStorage.getItem("mao.locale");
  if (stored === "en" || stored === "ja") {
    return stored;
  }

  return window.navigator.language?.startsWith("ja") ? "ja" : "en";
}

export function getTranslations(locale: AgentLocale): typeof en {
  return dictionaries[locale];
}

export function setStoredLocale(locale: AgentLocale): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem("mao.locale", locale);
  }
}
