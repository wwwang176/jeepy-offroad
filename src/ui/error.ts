export function clearUi(): void {
  const root = document.querySelector("#ui-root");
  if (root) root.innerHTML = "";
}

export function showError(message: string, onRetry: () => void): void {
  const root = document.querySelector("#ui-root");
  if (!root) return;
  root.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "modal-overlay";
  wrap.innerHTML = `
    <div class="panel error-panel modal-panel">
      <h2>Error</h2>
      <p></p>
      <div class="error-actions">
        <button type="button" id="error-retry">Retry</button>
      </div>
    </div>
  `;
  wrap.querySelector("p")!.textContent = message;
  wrap.querySelector<HTMLButtonElement>("#error-retry")!.onclick = onRetry;
  root.appendChild(wrap);
}
