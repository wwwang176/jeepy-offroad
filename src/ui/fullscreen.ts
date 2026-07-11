import { prefersTouchUi } from "@/input/touchMath";

/**
 * Request browser fullscreen for the game shell.
 * Mobile / narrow RWD only (same breakpoint as on-screen controls).
 * Desktop stays windowed. Must be called from a user gesture when possible.
 * iOS Safari may ignore; failures are silent.
 */
export async function requestGameFullscreen(): Promise<void> {
  if (typeof document === "undefined") return;
  // Computer / wide layout: never enter browser fullscreen.
  if (!prefersTouchUi()) return;

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
