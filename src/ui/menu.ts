import {
  RANDOM_BIOME_ID,
  resolveBiomeId,
  type BiomeSelectId,
} from "@/biome/registry";
import { normalizeSeed, parseSeedInput } from "@/shared/seed";
import type { BiomeId } from "@/shared/types";
import { createMenuBackdrop } from "@/render/MenuBackdrop";
import {
  biomeDescription,
  biomeDisplayName,
  t,
} from "@/i18n";
import { createLangToggle, syncLangToggle } from "@/i18n/langToggle";

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
 * - Stage home: title + Start game
 * - Stage select: terrain cards Random / Sand / Rainforest / SEED / ROAD
 * - SEED card opens a centered modal (blank = random, Go / Cancel)
 * - EN|中 toggle (menu only; not during play)
 */
export function mountMenu(parent: HTMLElement, handlers: MenuHandlers): () => void {
  const root = document.createElement("div");
  root.className = "menu-overlay menu-cinematic";
  root.innerHTML = `
    <div class="menu-shell">
      <div class="menu-left">
        <div class="menu-center">
          <div class="menu-stage menu-stage-home is-active" data-stage="home">
            <div class="menu-brand">
              <h1 class="menu-title">
                <span class="menu-title-main">Jeepy</span>
                <span class="menu-title-sub">offroad</span>
              </h1>
              <div class="menu-title-rule" aria-hidden="true"></div>
            </div>
            <button type="button" class="menu-cta" id="menu-start-game"></button>
          </div>

          <div class="menu-stage menu-stage-select" data-stage="select">
            <p class="menu-select-label" id="menu-select-label"></p>
            <div class="menu-cards" role="list"></div>

            <button type="button" class="menu-back" id="menu-back"></button>
          </div>
        </div>

        <p class="menu-hints" id="menu-hints"></p>
      </div>
    </div>

    <div
      class="menu-seed-modal"
      id="menu-seed-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="menu-seed-title"
      hidden
    >
      <div class="menu-seed-modal-panel panel modal-panel">
        <h2 class="modal-title" id="menu-seed-title"></h2>
        <label class="menu-seed-label" for="menu-seed-input" id="menu-seed-label"></label>
        <input
          id="menu-seed-input"
          class="menu-seed-input"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          spellcheck="false"
        />
        <p class="menu-seed-error" id="menu-seed-error" role="alert"></p>
        <div class="menu-seed-actions">
          <button type="button" class="menu-seed-go" id="menu-seed-go"></button>
          <button type="button" class="menu-seed-cancel btn-ghost" id="menu-seed-cancel"></button>
        </div>
      </div>
    </div>
  `;

  const langToggle = createLangToggle(() => applyLocale());
  root.appendChild(langToggle);

  const homeStage = root.querySelector<HTMLElement>(".menu-stage-home")!;
  const selectStage = root.querySelector<HTMLElement>(".menu-stage-select")!;
  const cardsEl = root.querySelector<HTMLElement>(".menu-cards")!;
  const seedModal = root.querySelector<HTMLElement>("#menu-seed-modal")!;
  const seedInput = root.querySelector<HTMLInputElement>("#menu-seed-input")!;
  const errorEl = root.querySelector<HTMLElement>("#menu-seed-error")!;
  const startGameBtn = root.querySelector<HTMLButtonElement>("#menu-start-game")!;
  const backBtn = root.querySelector<HTMLButtonElement>("#menu-back")!;
  const seedGo = root.querySelector<HTMLButtonElement>("#menu-seed-go")!;
  const seedCancel = root.querySelector<HTMLButtonElement>("#menu-seed-cancel")!;
  const selectLabel = root.querySelector<HTMLElement>("#menu-select-label")!;
  const hintsEl = root.querySelector<HTMLElement>("#menu-hints")!;
  const seedTitle = root.querySelector<HTMLElement>("#menu-seed-title")!;
  const seedLabel = root.querySelector<HTMLElement>("#menu-seed-label")!;

  const clearError = (): void => {
    errorEl.classList.remove("is-visible");
    errorEl.textContent = "";
  };

  const showError = (msg: string): void => {
    errorEl.classList.add("is-visible");
    errorEl.textContent = msg;
  };

  const closeSeedModal = (): void => {
    seedModal.classList.remove("is-open");
    seedModal.hidden = true;
    seedInput.value = "";
    clearError();
    for (const el of cardsEl.querySelectorAll(".menu-card")) {
      el.classList.remove("is-selected");
    }
  };

  const openSeedModal = (): void => {
    clearError();
    seedModal.hidden = false;
    seedModal.classList.add("is-open");
    requestAnimationFrame(() => {
      seedInput.focus();
      seedInput.select();
    });
  };

  const setStage = (next: "home" | "select"): void => {
    homeStage.classList.toggle("is-active", next === "home");
    selectStage.classList.toggle("is-active", next === "select");
    if (next === "home") {
      closeSeedModal();
    }
  };

  const startWith = (selection: BiomeSelectId, seedRaw: string): void => {
    clearError();
    try {
      const seed = normalizeSeed(parseSeedInput(seedRaw));
      const biomeId = resolveBiomeId(selection, seed);
      handlers.onStart({ biomeId, seed });
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Invalid seed:")) {
        showError(t("seed.invalid", { raw: seedRaw }));
      } else {
        showError(e instanceof Error ? e.message : String(e));
      }
    }
  };

  type CardDef = {
    id: string;
    icon: string;
    kind: "biome" | "seed" | "road";
    biomeId?: BiomeSelectId;
    nameKey?: "menu.card.random.name" | "menu.card.seed.name" | "menu.card.road.name";
    descKey?: "menu.card.random.desc" | "menu.card.seed.desc" | "menu.card.road.desc";
    /** biome id for name/desc via i18n */
    localeBiome?: BiomeId;
  };

  const cards: CardDef[] = [
    {
      id: "random",
      icon: "🎲",
      kind: "biome",
      biomeId: RANDOM_BIOME_ID,
      nameKey: "menu.card.random.name",
      descKey: "menu.card.random.desc",
    },
    {
      id: "sand",
      icon: "🏜",
      kind: "biome",
      biomeId: "sand",
      localeBiome: "sand",
    },
    {
      id: "rainforest",
      icon: "🌴",
      kind: "biome",
      biomeId: "rainforest",
      localeBiome: "rainforest",
    },
    {
      id: "seed",
      icon: "#",
      kind: "seed",
      nameKey: "menu.card.seed.name",
      descKey: "menu.card.seed.desc",
    },
    {
      id: "road",
      icon: "🛣",
      kind: "road",
      nameKey: "menu.card.road.name",
      descKey: "menu.card.road.desc",
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
      <span class="menu-card-name"></span>
      <span class="menu-card-desc"></span>
    `;
    card.onclick = () => {
      clearError();
      for (const el of cardsEl.querySelectorAll(".menu-card")) {
        el.classList.remove("is-selected");
      }
      card.classList.add("is-selected");

      if (entry.kind === "biome" && entry.biomeId) {
        closeSeedModal();
        startWith(entry.biomeId, "");
        return;
      }
      if (entry.kind === "seed") {
        openSeedModal();
        return;
      }
      if (entry.kind === "road") {
        closeSeedModal();
        const road = handlers.onRoad ?? handlers.onFlatTest;
        if (road) {
          road();
        }
      }
    };
    cardsEl.appendChild(card);
  }

  const applyLocale = (): void => {
    startGameBtn.textContent = t("menu.start");
    selectLabel.textContent = t("menu.selectTerrain");
    backBtn.textContent = t("menu.back");
    hintsEl.textContent = t("menu.hints");
    seedTitle.textContent = t("seed.title");
    seedLabel.textContent = t("seed.label");
    seedInput.placeholder = t("seed.placeholder");
    seedGo.textContent = t("seed.go");
    seedCancel.textContent = t("seed.cancel");
    syncLangToggle(langToggle);

    for (const entry of cards) {
      const card = cardsEl.querySelector<HTMLElement>(
        `[data-card-id="${entry.id}"]`,
      );
      if (!card) continue;
      const nameEl = card.querySelector(".menu-card-name");
      const descEl = card.querySelector(".menu-card-desc");
      if (!nameEl || !descEl) continue;
      if (entry.localeBiome) {
        nameEl.textContent = biomeDisplayName(entry.localeBiome);
        descEl.textContent = biomeDescription(entry.localeBiome);
      } else if (entry.nameKey && entry.descKey) {
        nameEl.textContent = t(entry.nameKey);
        descEl.textContent = t(entry.descKey);
      }
    }
  };

  applyLocale();

  startGameBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    setStage("select");
  });
  backBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    closeSeedModal();
    setStage("home");
  });

  seedGo.addEventListener("click", () =>
    startWith(RANDOM_BIOME_ID, seedInput.value),
  );
  seedCancel.addEventListener("click", () => closeSeedModal());
  seedModal.addEventListener("click", (ev) => {
    if (ev.target === seedModal) closeSeedModal();
  });
  seedInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      startWith(RANDOM_BIOME_ID, seedInput.value);
    }
  });
  seedInput.addEventListener("input", clearError);

  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape" && seedModal.classList.contains("is-open")) {
      ev.preventDefault();
      closeSeedModal();
    }
  };
  window.addEventListener("keydown", onKeyDown);

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
    window.removeEventListener("keydown", onKeyDown);
    backdropAbort.abort();
    backdrop?.dispose();
    backdrop = null;
    root.remove();
  };
}
