/**
 * Request browser fullscreen for the game shell.
 * Must be called from a user gesture (tap start / throttle pedals) when possible.
 * iOS Safari may ignore; failures are silent.
 */
export async function requestGameFullscreen(): Promise<void> {
  if (typeof document === "undefined") return;

  const doc = document as Document & {
    webkitFullscreenElement?: Element | null;
  };
  if (doc.fullscreenElement || doc.webkitFullscreenElement) return;

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
