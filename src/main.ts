import { GameApp } from "@/app/GameApp";
import { initLocale } from "@/i18n";

// Default EN; restore last choice from localStorage when present.
initLocale();

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
if (!canvas) throw new Error("Missing #game-canvas");

void new GameApp().start();
