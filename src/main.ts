import { GameApp } from "@/app/GameApp";

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
if (!canvas) throw new Error("Missing #game-canvas");

void new GameApp().start();
