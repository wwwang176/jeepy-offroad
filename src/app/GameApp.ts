import { reduce, type GameState } from "./GameStateMachine";
import RAPIER from "@dimforge/rapier3d-compat";
import { showError, clearUi } from "@/ui/error";

export class GameApp {
  private state: GameState = { name: "boot" };
  private running = false;

  async start(): Promise<void> {
    this.running = true;
    await this.enter(this.state);
    requestAnimationFrame((t) => this.frame(t));
  }

  private dispatch(
    event: Parameters<typeof reduce>[1],
  ): void {
    const next = reduce(this.state, event);
    if (next !== this.state) {
      this.state = next;
      void this.enter(next);
    }
  }

  private async enter(state: GameState): Promise<void> {
    clearUi();
    switch (state.name) {
      case "boot": {
        try {
          await RAPIER.init();
          this.dispatch({ type: "BOOT_OK" });
        } catch (e) {
          this.dispatch({
            type: "BOOT_FAIL",
            message: e instanceof Error ? e.message : String(e),
          });
        }
        break;
      }
      case "menu": {
        // Task 13 fills full menu; stub label for now
        const root = document.querySelector("#ui-root");
        if (root) {
          root.innerHTML =
            `<div class="panel" style="padding:16px">Menu stub — cliffs ready later</div>`;
        }
        break;
      }
      case "error":
        showError(state.message, () => {
          this.dispatch(
            state.retry === "boot"
              ? { type: "RETRY_BOOT" }
              : { type: "TO_MENU" },
          );
        });
        break;
      default:
        break;
    }
  }

  private frame(_t: number): void {
    if (!this.running) return;
    // later tasks: step playing simulation
    requestAnimationFrame((t) => this.frame(t));
  }
}
