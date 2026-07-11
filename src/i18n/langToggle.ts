import { getLocale, setLocale, t, type Locale } from "@/i18n";

function labelFor(locale: Locale): string {
  return locale === "zh" ? "中" : "EN";
}

function otherLocale(locale: Locale): Locale {
  return locale === "en" ? "zh" : "en";
}

/**
 * Single language button (EN ↔ 中). Shows current locale; click toggles.
 * Caller places it (e.g. menu top-right).
 */
export function createLangToggle(onChange?: (locale: Locale) => void): HTMLElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "lang-toggle menu-lang-toggle";

  const sync = (): void => {
    const cur = getLocale();
    // Show the language you switch *to* (EN → "中", 中 → "EN").
    const target = otherLocale(cur);
    btn.textContent = labelFor(target);
    btn.dataset.locale = cur;
    btn.setAttribute("aria-label", t("lang.aria"));
    btn.title = `${t("lang.aria")}: ${labelFor(target)}`;
  };

  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const next = otherLocale(getLocale());
    setLocale(next);
    sync();
    onChange?.(next);
  });

  sync();
  (btn as HTMLButtonElement & { syncLangToggle?: () => void }).syncLangToggle =
    sync;
  return btn;
}

export function syncLangToggle(el: HTMLElement): void {
  const sync = (el as HTMLElement & { syncLangToggle?: () => void })
    .syncLangToggle;
  sync?.();
}
