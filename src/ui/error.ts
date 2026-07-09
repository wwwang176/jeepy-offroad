export function clearUi(): void {
  const root = document.querySelector("#ui-root");
  if (root) root.innerHTML = "";
}

export function showError(message: string, onRetry: () => void): void {
  const root = document.querySelector("#ui-root");
  if (!root) return;
  root.innerHTML = "";
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.style.cssText =
    "padding:24px;margin:24px;background:#333;max-width:420px";
  panel.innerHTML = `<h2>Error</h2><p></p><button type="button">Retry</button>`;
  panel.querySelector("p")!.textContent = message;
  panel.querySelector("button")!.onclick = onRetry;
  root.appendChild(panel);
}
