export type GameState =
  | { name: "boot" }
  | { name: "menu" }
  | { name: "loading"; biomeId: string; seed: number }
  | { name: "playing"; biomeId: string; seed: number }
  | { name: "result"; biomeId: string; seed: number }
  | { name: "error"; message: string; retry?: "boot" | "menu" };

export type GameEvent =
  | { type: "BOOT_OK" }
  | { type: "BOOT_FAIL"; message: string }
  | { type: "START"; biomeId: string; seed: number }
  | { type: "LOADED" }
  | { type: "LOAD_FAIL"; message: string }
  | { type: "WIN" }
  | { type: "RETRY_SAME" }
  | { type: "RETRY_NEW"; seed: number }
  | { type: "TO_MENU" }
  | { type: "RETRY_BOOT" };

export function reduce(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case "BOOT_OK":
      return state.name === "boot" || state.name === "error"
        ? { name: "menu" }
        : state;
    case "BOOT_FAIL":
      return { name: "error", message: event.message, retry: "boot" };
    case "START":
      return state.name === "menu" || state.name === "result"
        ? { name: "loading", biomeId: event.biomeId, seed: event.seed }
        : state;
    case "LOADED":
      return state.name === "loading"
        ? { name: "playing", biomeId: state.biomeId, seed: state.seed }
        : state;
    case "LOAD_FAIL":
      return { name: "error", message: event.message, retry: "menu" };
    case "WIN":
      return state.name === "playing"
        ? { name: "result", biomeId: state.biomeId, seed: state.seed }
        : state;
    case "RETRY_SAME":
      return state.name === "result"
        ? { name: "loading", biomeId: state.biomeId, seed: state.seed }
        : state;
    case "RETRY_NEW":
      return state.name === "result"
        ? { name: "loading", biomeId: state.biomeId, seed: event.seed }
        : state;
    case "TO_MENU":
      return { name: "menu" };
    case "RETRY_BOOT":
      return { name: "boot" };
    default:
      return state;
  }
}
