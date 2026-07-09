import { listBiomes } from "@/biome/registry";
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
 * Mount main menu: biome cards from listBiomes(), seed field, Start.
 * Invalid seed shows inline error; does not throw to the host.
 */
export function mountMenu(parent: HTMLElement, handlers: MenuHandlers): () => void {
  const biomes = listBiomes();
  const root = document.createElement("div");
  root.className = "menu-overlay";
  root.innerHTML = `
    <div class="panel menu-panel">
      <h1 class="menu-title">Low-Poly Jeep Off-Road</h1>
      <p class="menu-sub">Pick a biome, set a seed (or leave blank for random), then Start.</p>
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

  let selectedId: BiomeId | null = biomes[0]?.id ?? null;

  for (const biome of biomes) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "biome-card";
    card.setAttribute("role", "listitem");
    card.dataset.biomeId = biome.id;
    card.innerHTML = `
      <span class="biome-card-name">${biome.displayName}</span>
      <span class="biome-card-desc">${biome.description}</span>
    `;
    if (biome.id === selectedId) {
      card.classList.add("is-selected");
    }
    card.onclick = () => {
      selectedId = biome.id;
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
      handlers.onStart({ biomeId: selectedId, seed });
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
