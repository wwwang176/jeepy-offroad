import {
  listBiomes,
  RANDOM_BIOME_ID,
  resolveBiomeId,
  type BiomeSelectId,
} from "@/biome/registry";
import { normalizeSeed, parseSeedInput } from "@/shared/seed";
import type { BiomeId } from "@/shared/types";
import { createMenuBackdrop } from "@/render/MenuBackdrop";

export type MenuStartPayload = {
  biomeId: BiomeId;
  seed: number;
};

export type MenuHandlers = {
  onStart: (payload: MenuStartPayload) => void;
  /** Flat / paved practice (ROAD card). */
  onRoad?: () => void;
  /** @deprecated use onRoad — kept for callers that still pass flat-test. */
  onFlatTest?: () => void;
};

/**
 * Cinematic main menu:
 * - Full-bleed 3D jeep backdrop (front close-up, always driving)
 * - Stage home: title + 開始遊戲
 * - Stage select: terrain cards 隨機 / 沙地 / 雨林 / 自訂 SEED / ROAD
 */
export function mountMenu(parent: HTMLElement, handlers: MenuHandlers): () => void {
  const biomes = listBiomes();
  const sand = biomes.find((b) => b.id === "sand");
  const rain = biomes.find((b) => b.id === "rainforest");

  const root = document.createElement("div");
  root.className = "menu-overlay menu-cinematic";
  root.innerHTML = `
    <div class="menu-shell">
      <div class="menu-left">
        <div class="menu-brand">
          <h1 class="menu-title">
            <span class="menu-title-main">Jeepy</span>
            <span class="menu-title-sub">offroad</span>
          </h1>
          <div class="menu-title-rule" aria-hidden="true"></div>
        </div>

        <div class="menu-center">
          <div class="menu-stage menu-stage-home is-active" data-stage="home">
            <button type="button" class="menu-cta" id="menu-start-game">
              開始遊戲
            </button>
          </div>

          <div class="menu-stage menu-stage-select" data-stage="select">
            <p class="menu-select-label">選擇地形</p>
            <div class="menu-cards" role="list"></div>

            <div class="menu-seed-panel" id="menu-seed-panel">
              <label class="menu-seed-label" for="menu-seed-input">SEED</label>
              <input
                id="menu-seed-input"
                class="menu-seed-input"
                type="text"
                inputmode="numeric"
                placeholder="空白 = 隨機"
                autocomplete="off"
                spellcheck="false"
              />
              <div class="menu-seed-actions">
                <button type="button" class="menu-seed-go" id="menu-seed-go">出發</button>
                <button type="button" class="menu-seed-cancel" id="menu-seed-cancel">取消</button>
              </div>
            </div>

            <p class="menu-seed-error" id="menu-seed-error"></p>

            <button type="button" class="menu-back" id="menu-back">返回</button>
          </div>
        </div>

        <p class="menu-hints">WASD 駕駛 · 鬆鍵滑行 · 反向 W/S 剎車 · Shift 4H/4L · 拖曳視角 · C 鏡頭 · R 重生</p>
      </div>
    </div>
  `;

  const homeStage = root.querySelector<HTMLElement>(".menu-stage-home")!;
  const selectStage = root.querySelector<HTMLElement>(".menu-stage-select")!;
  const cardsEl = root.querySelector<HTMLElement>(".menu-cards")!;
  const seedPanel = root.querySelector<HTMLElement>("#menu-seed-panel")!;
  const seedInput = root.querySelector<HTMLInputElement>("#menu-seed-input")!;
  const errorEl = root.querySelector<HTMLElement>("#menu-seed-error")!;
  const startGameBtn = root.querySelector<HTMLButtonElement>("#menu-start-game")!;
  const backBtn = root.querySelector<HTMLButtonElement>("#menu-back")!;
  const seedGo = root.querySelector<HTMLButtonElement>("#menu-seed-go")!;
  const seedCancel = root.querySelector<HTMLButtonElement>("#menu-seed-cancel")!;

  const setStage = (next: "home" | "select"): void => {
    // Class-based show/hide — CSS `display:flex` on .menu-stage was overriding [hidden]
    homeStage.classList.toggle("is-active", next === "home");
    selectStage.classList.toggle("is-active", next === "select");
    if (next === "home") {
      seedPanel.classList.remove("is-open");
      clearError();
    }
  };

  const clearError = (): void => {
    errorEl.classList.remove("is-visible");
    errorEl.textContent = "";
  };

  const showError = (msg: string): void => {
    errorEl.classList.add("is-visible");
    errorEl.textContent = msg;
  };

  const startWith = (selection: BiomeSelectId, seedRaw: string): void => {
    clearError();
    try {
      const seed = normalizeSeed(parseSeedInput(seedRaw));
      const biomeId = resolveBiomeId(selection, seed);
      handlers.onStart({ biomeId, seed });
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    }
  };

  type CardDef = {
    id: string;
    icon: string;
    name: string;
    desc: string;
    kind: "biome" | "seed" | "road";
    biomeId?: BiomeSelectId;
  };

  const cards: CardDef[] = [
    {
      id: "random",
      icon: "🎲",
      name: "隨機",
      desc: "沙地 / 雨林",
      kind: "biome",
      biomeId: RANDOM_BIOME_ID,
    },
    {
      id: "sand",
      icon: "🏜",
      name: sand?.displayName ?? "沙地",
      desc: sand?.description ?? "乾燥沙丘",
      kind: "biome",
      biomeId: "sand",
    },
    {
      id: "rainforest",
      icon: "🌴",
      name: rain?.displayName ?? "雨林",
      desc: rain?.description ?? "潮濕密林",
      kind: "biome",
      biomeId: "rainforest",
    },
    {
      id: "seed",
      icon: "#",
      name: "SEED",
      desc: "自訂種子",
      kind: "seed",
    },
    {
      id: "road",
      icon: "🛣",
      name: "ROAD",
      desc: "平地練習",
      kind: "road",
    },
  ];

  for (const entry of cards) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "menu-card";
    card.setAttribute("role", "listitem");
    card.dataset.cardId = entry.id;
    card.innerHTML = `
      <span class="menu-card-icon" aria-hidden="true">${entry.icon}</span>
      <span class="menu-card-name">${entry.name}</span>
      <span class="menu-card-desc">${entry.desc}</span>
    `;
    card.onclick = () => {
      clearError();
      // Deselect visual
      for (const el of cardsEl.querySelectorAll(".menu-card")) {
        el.classList.remove("is-selected");
      }
      card.classList.add("is-selected");

      if (entry.kind === "biome" && entry.biomeId) {
        seedPanel.classList.remove("is-open");
        startWith(entry.biomeId, "");
        return;
      }
      if (entry.kind === "seed") {
        seedPanel.classList.add("is-open");
        seedInput.focus();
        seedInput.select();
        return;
      }
      if (entry.kind === "road") {
        seedPanel.classList.remove("is-open");
        const road = handlers.onRoad ?? handlers.onFlatTest;
        if (road) {
          road();
        } else {
          showError("ROAD 尚未開放");
        }
      }
    };
    cardsEl.appendChild(card);
  }

  startGameBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    setStage("select");
  });
  backBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    seedPanel.classList.remove("is-open");
    for (const el of cardsEl.querySelectorAll(".menu-card")) {
      el.classList.remove("is-selected");
    }
    setStage("home");
  });

  seedGo.addEventListener("click", () =>
    startWith(RANDOM_BIOME_ID, seedInput.value),
  );
  seedCancel.addEventListener("click", () => {
    seedPanel.classList.remove("is-open");
    seedInput.value = "";
    clearError();
    for (const el of cardsEl.querySelectorAll(".menu-card")) {
      el.classList.remove("is-selected");
    }
  });
  seedInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      startWith(RANDOM_BIOME_ID, seedInput.value);
    }
  });
  seedInput.addEventListener("input", clearError);

  // Menu 3D backdrop (async). Abort on unmount so we never double-bind WebGL.
  const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
  let backdrop: { dispose: () => void } | null = null;
  const backdropAbort = new AbortController();
  if (canvas) {
    void createMenuBackdrop(canvas, { signal: backdropAbort.signal })
      .then((handles) => {
        if (!handles) return;
        if (backdropAbort.signal.aborted) {
          handles.dispose();
          return;
        }
        backdrop = handles;
      })
      .catch((e) => {
        console.warn("[menu] backdrop failed", e);
      });
  }

  parent.appendChild(root);

  return () => {
    backdropAbort.abort();
    backdrop?.dispose();
    backdrop = null;
    root.remove();
  };
}
