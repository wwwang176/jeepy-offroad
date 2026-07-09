import {
  listBiomes,
  RANDOM_BIOME_ID,
  resolveBiomeId,
  type BiomeSelectId,
} from "@/biome/registry";
import { normalizeSeed, parseSeedInput } from "@/shared/seed";
import type { BiomeId } from "@/shared/types";

export type MenuStartPayload = {
  biomeId: BiomeId;
  seed: number;
};

export type MenuHandlers = {
  onStart: (payload: MenuStartPayload) => void;
  onFlatTest?: () => void;
};

/**
 * Mount main menu: biome cards (含隨機) from listBiomes(), seed field, Start.
 * 「隨機」uses seed so the same seed always picks the same biome + level.
 */
export function mountMenu(parent: HTMLElement, handlers: MenuHandlers): () => void {
  const biomes = listBiomes();
  const root = document.createElement("div");
  root.className = "menu-overlay";
  root.innerHTML = `
    <div class="panel menu-panel">
      <h1 class="menu-title">Low-Poly Jeep Off-Road</h1>
      <p class="menu-sub">Pick a biome (or 隨機), set a seed (or leave blank for random), then Start.</p>
      <div class="menu-biomes" role="list"></div>
      <label class="menu-seed-label">
        Seed
        <input
          id="menu-seed-input"
          class="menu-seed-input"
          type="text"
          inputmode="numeric"
          placeholder="empty = random"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
      <p class="menu-seed-error" id="menu-seed-error" hidden></p>
      <div class="menu-actions">
        <button type="button" class="menu-start" id="menu-start" disabled>Start</button>
      </div>
      <p class="menu-hints">WASD / arrows · W+S brake · S reverse · Shift 4H/4L · drag look · C camera · R respawn</p>
      <div class="menu-dev" id="menu-dev"></div>
    </div>
  `;

  const biomeList = root.querySelector<HTMLElement>(".menu-biomes")!;
  const seedInput = root.querySelector<HTMLInputElement>("#menu-seed-input")!;
  const errorEl = root.querySelector<HTMLElement>("#menu-seed-error")!;
  const startBtn = root.querySelector<HTMLButtonElement>("#menu-start")!;
  const devEl = root.querySelector<HTMLElement>("#menu-dev")!;

  // Default: random biome at start
  let selectedId: BiomeSelectId | null = RANDOM_BIOME_ID;

  const cards: { id: BiomeSelectId; name: string; desc: string }[] = [
    {
      id: RANDOM_BIOME_ID,
      name: "隨機",
      desc: "開局隨機 沙地 / 雨林（同 seed 可重現）",
    },
    ...biomes.map((b) => ({
      id: b.id as BiomeSelectId,
      name: b.displayName,
      desc: b.description,
    })),
  ];

  for (const entry of cards) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "biome-card";
    card.setAttribute("role", "listitem");
    card.dataset.biomeId = entry.id;
    card.innerHTML = `
      <span class="biome-card-name">${entry.name}</span>
      <span class="biome-card-desc">${entry.desc}</span>
    `;
    if (entry.id === selectedId) {
      card.classList.add("is-selected");
    }
    card.onclick = () => {
      selectedId = entry.id;
      for (const el of biomeList.querySelectorAll(".biome-card")) {
        el.classList.toggle(
          "is-selected",
          (el as HTMLElement).dataset.biomeId === selectedId,
        );
      }
      startBtn.disabled = !selectedId;
      clearError();
    };
    biomeList.appendChild(card);
  }

  startBtn.disabled = !selectedId;

  const clearError = (): void => {
    errorEl.hidden = true;
    errorEl.textContent = "";
  };

  const showError = (msg: string): void => {
    errorEl.hidden = false;
    errorEl.textContent = msg;
  };

  const tryStart = (): void => {
    if (!selectedId) return;
    clearError();
    try {
      const seed = normalizeSeed(parseSeedInput(seedInput.value));
      const biomeId = resolveBiomeId(selectedId, seed);
      handlers.onStart({ biomeId, seed });
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    }
  };

  startBtn.onclick = tryStart;
  seedInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      tryStart();
    }
  });
  seedInput.addEventListener("input", clearError);

  if (handlers.onFlatTest) {
    const flat = document.createElement("button");
    flat.type = "button";
    flat.className = "menu-flat-test";
    flat.textContent = "Flat physics test";
    flat.onclick = () => handlers.onFlatTest?.();
    devEl.appendChild(flat);
  }

  parent.appendChild(root);

  return () => {
    root.remove();
  };
}
