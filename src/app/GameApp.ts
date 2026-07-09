import * as THREE from "three";
import { reduce, type GameState } from "./GameStateMachine";
import RAPIER from "@dimforge/rapier3d-compat";
import { showError, clearUi } from "@/ui/error";
import { PhysicsWorld } from "@/physics/PhysicsWorld";
import { VehicleController } from "@/physics/vehicle/VehicleController";
import { InputRouter } from "@/input/InputRouter";
import { KeyboardProvider } from "@/input/KeyboardProvider";
import { createRenderer } from "@/render/createRenderer";
import { createJeepMesh, syncJeepMesh } from "@/render/JeepMesh";

export class GameApp {
  private state: GameState = { name: "boot" };
  private running = false;

  // Flat sandbox session
  private physics: PhysicsWorld | null = null;
  private vehicle: VehicleController | null = null;
  private input: InputRouter | null = null;
  private jeepMesh: THREE.Group | null = null;
  private three: ReturnType<typeof createRenderer> | null = null;
  private acc = 0;
  private lastT = 0;
  private sandboxActive = false;

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
        const root = document.querySelector("#ui-root");
        if (root) {
          root.innerHTML = `
            <div class="panel" style="padding:16px">
              <div style="margin-bottom:12px">Menu stub — cliffs ready later</div>
              <button type="button" id="flat-test">Flat test</button>
            </div>
          `;
          const btn = root.querySelector<HTMLButtonElement>("#flat-test");
          if (btn) {
            btn.onclick = () => {
              void this.startFlatSandbox();
            };
          }
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

  private async startFlatSandbox(): Promise<void> {
    const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
    if (!canvas) throw new Error("Missing canvas");

    this.physics = await PhysicsWorld.create();
    this.physics.createGroundPlane(0);
    this.vehicle = new VehicleController(this.physics.getWorld(), {
      position: { x: 0, y: 2, z: 0 },
      yaw: 0,
    });
    this.input = new InputRouter(new KeyboardProvider());
    this.three = createRenderer(canvas);
    // flat visual ground
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(200, 0.2, 200),
      new THREE.MeshLambertMaterial({ color: 0x5a6a4a }),
    );
    ground.position.y = 0;
    this.three.scene.add(ground);
    this.jeepMesh = createJeepMesh();
    this.three.scene.add(this.jeepMesh);
    this.sandboxActive = true;
    this.lastT = performance.now();
    this.acc = 0;

    // Hide menu UI while sandbox is active
    clearUi();
  }

  private frame(t: number): void {
    if (!this.running) return;
    if (
      this.sandboxActive &&
      this.physics &&
      this.vehicle &&
      this.input &&
      this.three &&
      this.jeepMesh
    ) {
      const dt = Math.min(0.05, (t - this.lastT) / 1000);
      this.lastT = t;
      this.acc += dt;
      const fixed = 1 / 60;
      while (this.acc >= fixed) {
        const actions = this.input.sample();
        this.vehicle.update(fixed, actions, this.physics.getWorld());
        this.physics.step();
        this.acc -= fixed;
      }
      const pose = this.vehicle.getPose();
      syncJeepMesh(this.jeepMesh, pose);
      // simple chase cam for sandbox
      const yaw = pose.yaw;
      this.three.camera.position.set(
        pose.position.x - Math.sin(yaw) * 8,
        pose.position.y + 3.5,
        pose.position.z - Math.cos(yaw) * 8,
      );
      this.three.camera.lookAt(
        pose.position.x,
        pose.position.y + 1.2,
        pose.position.z,
      );
      this.three.renderer.render(this.three.scene, this.three.camera);
    }
    requestAnimationFrame((nt) => this.frame(nt));
  }
}
