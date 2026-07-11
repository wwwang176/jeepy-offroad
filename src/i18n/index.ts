import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, type Locale } from "./types";
import { messages, type MessageKey } from "./messages";

export type { Locale, MessageKey };
export { DEFAULT_LOCALE, LOCALES, LOCALE_STORAGE_KEY } from "./types";
export { messages } from "./messages";

let current: Locale = DEFAULT_LOCALE;
const listeners = new Set<(locale: Locale) => void>();

function isLocale(v: string | null | undefined): v is Locale {
  return v === "en" || v === "zh";
}

/** Load persisted locale (default en). Safe without window/localStorage. */
export function initLocale(): Locale {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
      if (isLocale(raw)) {
        current = raw;
      }
    }
  } catch {
    // private mode / blocked storage
  }
  applyDocumentLang(current);
  return current;
}

export function getLocale(): Locale {
  return current;
}

export function setLocale(next: Locale): void {
  if (next === current) {
    applyDocumentLang(next);
    return;
  }
  current = next;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    }
  } catch {
    // ignore
  }
  applyDocumentLang(next);
  for (const fn of listeners) fn(next);
}

/** Subscribe to locale changes. Returns unsubscribe. */
export function onLocaleChange(fn: (locale: Locale) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function applyDocumentLang(locale: Locale = current): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale === "zh" ? "zh-Hant" : "en";
}

/**
 * Translate a message key. Optional `{name}` placeholders via vars.
 * Falls back to English, then the key string.
 */
export function t(
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const table = messages[current] ?? messages.en;
  let s = table[key] ?? messages.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

/** Biome id → localized display name (unknown ids pass through). */
export function biomeDisplayName(biomeId: string): string {
  if (biomeId === "sand") return t("biome.sand.name");
  if (biomeId === "rainforest") return t("biome.rainforest.name");
  return biomeId;
}

export function biomeDescription(biomeId: string): string {
  if (biomeId === "sand") return t("biome.sand.desc");
  if (biomeId === "rainforest") return t("biome.rainforest.desc");
  return "";
}
