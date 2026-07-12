import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  biomeDisplayName,
  getLocale,
  initLocale,
  setLocale,
  t,
} from "@/i18n";
import { messages } from "@/i18n/messages";

/** Minimal localStorage for node test env (no jsdom). */
function installMemoryStorage(): void {
  const map = new Map<string, string>();
  const store = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: store,
    configurable: true,
  });
}

describe("i18n", () => {
  beforeEach(() => {
    installMemoryStorage();
    localStorage.removeItem("jeepy.locale");
    setLocale(DEFAULT_LOCALE);
  });

  afterEach(() => {
    setLocale(DEFAULT_LOCALE);
  });

  it("defaults to English", () => {
    expect(getLocale()).toBe("en");
    expect(t("menu.start")).toBe("Start game");
    expect(biomeDisplayName("sand")).toBe("Sand");
  });

  it("switches to Chinese and back", () => {
    setLocale("zh");
    expect(t("menu.start")).toBe("開始遊戲");
    expect(biomeDisplayName("rainforest")).toBe("雨林");
    expect(biomeDisplayName("alpine")).toBe("雪山");
    expect(t("seed.placeholder")).toBe("空白 = 隨機");
    setLocale("en");
    expect(t("menu.start")).toBe("Start game");
    expect(biomeDisplayName("alpine")).toBe("Alpine");
  });

  it("interpolates placeholders", () => {
    setLocale("en");
    expect(t("loading", { biome: "Sand", seed: 42 })).toBe(
      "Loading Sand · seed 42…",
    );
    setLocale("zh");
    expect(t("hud.info", { biome: "沙地", seed: 7 })).toBe("沙地 · 種子 7");
  });

  it("persists locale to localStorage", () => {
    setLocale("zh");
    expect(localStorage.getItem("jeepy.locale")).toBe("zh");
    setLocale("en");
    localStorage.setItem("jeepy.locale", "zh");
    expect(initLocale()).toBe("zh");
    expect(getLocale()).toBe("zh");
  });

  it("en and zh catalogs share the same keys", () => {
    const enKeys = Object.keys(messages.en).sort();
    const zhKeys = Object.keys(messages.zh).sort();
    expect(zhKeys).toEqual(enKeys);
  });
});
