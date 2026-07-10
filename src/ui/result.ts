import { normalizeSeed, parseSeedInput } from "@/shared/seed";

export type ResultHandlers = {
  onRetrySame: () => void;
  onRetryNew: (seed: number) => void;
  onMenu: () => void;
};

/**
 * Success / result overlay: show seed, retry same, new random seed, menu.
 */
export function mountResult(
  parent: HTMLElement,
  opts: { biomeId: string; seed: number },
  handlers: ResultHandlers,
): () => void {
  const root = document.createElement("div");
  root.className = "result-overlay";
  root.innerHTML = `
    <div class="panel result-panel modal-panel">
      <h2 class="result-title">Finish!</h2>
      <p class="result-meta">
        <span class="result-biome">${opts.biomeId}</span>
        · seed <span class="result-seed">${opts.seed}</span>
      </p>
      <p class="result-copy">You reached the finish volume. Replay or pick a new route.</p>
      <div class="result-actions">
        <button type="button" id="result-retry-same">Retry same</button>
        <button type="button" id="result-retry-new">New seed</button>
        <button type="button" class="btn-ghost" id="result-menu">Menu</button>
      </div>
    </div>
  `;

  root.querySelector<HTMLButtonElement>("#result-retry-same")!.onclick = () =>
    handlers.onRetrySame();

  root.querySelector<HTMLButtonElement>("#result-retry-new")!.onclick = () => {
    // Empty field = random uint32 per seed contract.
    const seed = normalizeSeed(parseSeedInput(""));
    handlers.onRetryNew(seed);
  };

  root.querySelector<HTMLButtonElement>("#result-menu")!.onclick = () =>
    handlers.onMenu();

  parent.appendChild(root);

  return () => {
    root.remove();
  };
}
