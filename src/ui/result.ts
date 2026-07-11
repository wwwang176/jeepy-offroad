import { normalizeSeed, parseSeedInput } from "@/shared/seed";
import { biomeDisplayName, t } from "@/i18n";

export type ResultHandlers = {
  onRetrySame: () => void;
  onRetryNew: (seed: number) => void;
  onMenu: () => void;
};

/**
 * Success / result overlay: show seed, retry same, new random seed, menu.
 * Uses locale at mount (no live toggle on this screen).
 */
export function mountResult(
  parent: HTMLElement,
  opts: { biomeId: string; seed: number },
  handlers: ResultHandlers,
): () => void {
  const root = document.createElement("div");
  root.className = "result-overlay";
  const biome = biomeDisplayName(opts.biomeId);
  root.innerHTML = `
    <div class="panel result-panel modal-panel">
      <h2 class="result-title">${t("result.title")}</h2>
      <p class="result-meta">${t("result.meta", { biome, seed: opts.seed })}</p>
      <p class="result-copy">${t("result.copy")}</p>
      <div class="result-actions">
        <button type="button" id="result-retry-same">${t("result.retrySame")}</button>
        <button type="button" id="result-retry-new">${t("result.retryNew")}</button>
        <button type="button" class="btn-ghost" id="result-menu">${t("result.menu")}</button>
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
