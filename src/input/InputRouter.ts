import type { InputActions, InputProvider } from "./types";

export class InputRouter {
  constructor(private provider: InputProvider) {}
  sample(): InputActions {
    return this.provider.sample();
  }
  dispose(): void {
    this.provider.dispose();
  }
}
