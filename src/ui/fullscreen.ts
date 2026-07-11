/**
 * Request browser fullscreen for the game shell.
 * Must be called from a user gesture (tap "開始遊戲") when possible.
 * iOS Safari may ignore; failures are silent.
 */
export async function requestGameFullscreen(): Promise<void> {
  if (typeof document === "undefined") return;
  if (document.fullscreenElement) return;

  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => void;
    webkitRequestFullScreen?: () => void;
  };

  try {
    if (typeof el.requestFullscreen === "function") {
      await el.requestFullscreen();
      return;
    }
    if (typeof el.webkitRequestFullscreen === "function") {
      el.webkitRequestFullscreen();
      return;
    }
    if (typeof el.webkitRequestFullScreen === "function") {
      el.webkitRequestFullScreen();
    }
  } catch {
    // Not allowed / unsupported — continue windowed.
  }
}
