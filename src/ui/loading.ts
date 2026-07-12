import { t } from "@/i18n";

export type LoadingHandles = {
  /** 0..1 progress fill. */
  setProgress: (ratio: number) => void;
  /** Status line under the bar. */
  setStatus: (text: string) => void;
  dispose: () => void;
  root: HTMLElement;
};

/**
 * Full-screen loading overlay with title, determinate progress bar, and status.
 */
export function mountLoading(
  parent: HTMLElement,
  opts: { biomeLabel: string; seed: number },
): LoadingHandles {
  const root = document.createElement("div");
  root.className = "loading-overlay";
  root.innerHTML = `
    <div class="panel loading-panel modal-panel">
      <div class="loading-title">${t("loading", {
        biome: opts.biomeLabel,
        seed: opts.seed,
      })}</div>
      <div class="loading-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div class="loading-bar-fill"></div>
      </div>
      <div class="loading-status">${t("loading.status.init")}</div>
    </div>
  `;
  parent.appendChild(root);

  const fill = root.querySelector<HTMLElement>(".loading-bar-fill")!;
  const bar = root.querySelector<HTMLElement>(".loading-bar")!;
  const statusEl = root.querySelector<HTMLElement>(".loading-status")!;

  return {
    root,
    setProgress: (ratio: number) => {
      const p = Math.max(0, Math.min(1, ratio));
      const pct = Math.round(p * 100);
      fill.style.width = `${pct}%`;
      bar.setAttribute("aria-valuenow", String(pct));
    },
    setStatus: (text: string) => {
      statusEl.textContent = text;
    },
    dispose: () => {
      root.remove();
    },
  };
}
