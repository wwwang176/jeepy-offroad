export type Locale = "en" | "zh";

export const LOCALES: readonly Locale[] = ["en", "zh"] as const;

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_STORAGE_KEY = "jeepy.locale";
