export function uiRoot(): HTMLElement {
  const el = document.querySelector<HTMLElement>("#ui-root");
  if (!el) throw new Error("Missing #ui-root");
  return el;
}
