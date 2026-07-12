import type { Locale } from "./types";

/** Flat message catalog. Add keys here when new UI copy appears. */
export type MessageKey =
  | "menu.start"
  | "menu.selectTerrain"
  | "menu.back"
  | "menu.hints"
  | "menu.card.random.name"
  | "menu.card.random.desc"
  | "menu.card.seed.name"
  | "menu.card.seed.desc"
  | "menu.card.road.name"
  | "menu.card.road.desc"
  | "seed.title"
  | "seed.label"
  | "seed.placeholder"
  | "seed.go"
  | "seed.cancel"
  | "seed.invalid"
  | "biome.sand.name"
  | "biome.sand.desc"
  | "biome.rainforest.name"
  | "biome.rainforest.desc"
  | "biome.alpine.name"
  | "biome.alpine.desc"
  | "loading"
  | "loading.status.init"
  | "loading.status.terrain"
  | "loading.status.physics"
  | "loading.status.scene"
  | "loading.status.fx"
  | "loading.status.settle"
  | "loading.status.gpu"
  | "loading.status.ready"
  | "result.title"
  | "result.meta"
  | "result.copy"
  | "result.retrySame"
  | "result.retryNew"
  | "result.menu"
  | "error.title"
  | "error.retry"
  | "hud.finish"
  | "hud.range"
  | "hud.info"
  | "hud.info.fallback"
  | "touch.rotate"
  | "lang.aria";

export type MessageTable = Record<MessageKey, string>;

export const messages: Record<Locale, MessageTable> = {
  en: {
    "menu.start": "Start game",
    "menu.selectTerrain": "Choose terrain",
    "menu.back": "Back",
    "menu.hints":
      "WASD drive · release to coast · reverse W/S brake · Shift 4H/4L · drag look · C camera · R respawn",
    "menu.card.random.name": "Random",
    "menu.card.random.desc": "Sand / Rainforest / Alpine",
    "menu.card.seed.name": "SEED",
    "menu.card.seed.desc": "Custom seed",
    "menu.card.road.name": "ROAD",
    "menu.card.road.desc": "Flat practice",
    "seed.title": "SEED",
    "seed.label": "Custom seed",
    "seed.placeholder": "Blank = random",
    "seed.go": "Go",
    "seed.cancel": "Cancel",
    "seed.invalid": "Invalid seed: {raw}",
    "biome.sand.name": "Sand",
    "biome.sand.desc": "Dry ridges, cacti, and sandy tracks",
    "biome.rainforest.name": "Rainforest",
    "biome.rainforest.desc": "Wet mud, light rain, and coconut palms",
    "biome.alpine.name": "Alpine",
    "biome.alpine.desc": "Residual snow, bare rock, long descents",
    loading: "Loading {biome} · seed {seed}…",
    "loading.status.init": "Preparing…",
    "loading.status.terrain": "Generating terrain…",
    "loading.status.physics": "Building physics…",
    "loading.status.scene": "Building scene…",
    "loading.status.fx": "Effects…",
    "loading.status.settle": "Settling vehicle…",
    "loading.status.gpu": "Warming graphics…",
    "loading.status.ready": "Ready",
    "result.title": "Finish!",
    "result.meta": "{biome} · seed {seed}",
    "result.copy":
      "You reached the finish. Play again or try a new map.",
    "result.retrySame": "Play again",
    "result.retryNew": "New map",
    "result.menu": "Menu",
    "error.title": "Error",
    "error.retry": "Retry",
    "hud.finish": "FINISH",
    "hud.range": "RANGE",
    "hud.info": "{biome} · seed {seed}",
    "hud.info.fallback": "{biome} · seed {seed} · fallback path",
    "touch.rotate": "Rotate your device",
    "lang.aria": "Language",
  },
  zh: {
    "menu.start": "開始遊戲",
    "menu.selectTerrain": "選擇地形",
    "menu.back": "返回",
    "menu.hints":
      "WASD 駕駛 · 鬆鍵滑行 · 反向 W/S 剎車 · Shift 4H/4L · 拖曳視角 · C 鏡頭 · R 重生",
    "menu.card.random.name": "隨機",
    "menu.card.random.desc": "沙地 / 雨林 / 雪山",
    "menu.card.seed.name": "SEED",
    "menu.card.seed.desc": "自訂種子",
    "menu.card.road.name": "ROAD",
    "menu.card.road.desc": "平地練習",
    "seed.title": "SEED",
    "seed.label": "自訂種子",
    "seed.placeholder": "空白 = 隨機",
    "seed.go": "出發",
    "seed.cancel": "取消",
    "seed.invalid": "無效種子：{raw}",
    "biome.sand.name": "沙地",
    "biome.sand.desc": "乾燥岩脊、仙人掌與沙褐土徑",
    "biome.rainforest.name": "雨林",
    "biome.rainforest.desc": "潮濕綠泥、小雨與成片椰子樹",
    "biome.alpine.name": "雪山",
    "biome.alpine.desc": "殘雪、裸岩與長下坡",
    loading: "載入 {biome} · 種子 {seed}…",
    "loading.status.init": "準備中…",
    "loading.status.terrain": "生成地形…",
    "loading.status.physics": "建立物理…",
    "loading.status.scene": "建立場景…",
    "loading.status.fx": "特效…",
    "loading.status.settle": "穩定車輛…",
    "loading.status.gpu": "預熱畫面…",
    "loading.status.ready": "完成",
    "result.title": "抵達終點！",
    "result.meta": "{biome} · 種子 {seed}",
    "result.copy": "你已抵達終點。再玩一次，或換一張新地圖。",
    "result.retrySame": "再玩一次",
    "result.retryNew": "新地圖",
    "result.menu": "主選單",
    "error.title": "錯誤",
    "error.retry": "重試",
    "hud.finish": "終點",
    "hud.range": "RANGE",
    "hud.info": "{biome} · 種子 {seed}",
    "hud.info.fallback": "{biome} · 種子 {seed} · 備用路徑",
    "touch.rotate": "請旋轉畫面",
    "lang.aria": "語言",
  },
};
