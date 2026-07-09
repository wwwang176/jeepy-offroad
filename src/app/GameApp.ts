import * as THREE from "three";
import { reduce, type GameState } from "./GameStateMachine";
import RAPIER from "@dimforge/rapier3d-compat";
import { showError, clearUi } from "@/ui/error";
import { mountMenu } from "@/ui/menu";
import { mountResult } from "@/ui/result";
import { PhysicsWorld } from "@/physics/PhysicsWorld";
import { VehicleController } from "@/physics/vehicle/VehicleController";
import { createTerrainCollider } from "@/physics/createTerrainCollider";
import { InputRouter } from "@/input/InputRouter";
import { KeyboardProvider } from "@/input/KeyboardProvider";
import { createRenderer } from "@/render/createRenderer";
import { createJeepMesh, syncJeepMesh } from "@/render/JeepMesh";
import {
  createGameScene,
  type GameSceneHandles,
} from "@/render/GameScene";
import { CameraRig } from "@/render/CameraRig";
import { generateLevel } from "@/levelgen/generateLevel";
import { sampleBilinear } from "@/levelgen/heightmap";
import type { LevelData } from "@/levelgen/types";
import { getBiome } from "@/biome/registry";
import { normalizeSeed } from "@/shared/seed";
import { VEHICLE_CAPABILITIES } from "@/shared/vehicleCapabilities";
import { chassisSpawnY } from "@/shared/vehicleConfig";
import { FinishSystem } from "@/gameplay/FinishSystem";
import { CheckpointSystem } from "@/gameplay/CheckpointSystem";
import { RespawnSystem } from "@/gameplay/RespawnSystem";
import {
  createHud,
  updateHud,
  updateHudDrive,
  type HudHandles,
} from "@/ui/hud";
import type { BiomeId } from "@/shared/types";
import type { InputActions } from "@/input/types";

const FIXED_DT = 1 / 60;

const ZERO_DRIVE: Pick<InputActions, "throttle" | "steer" | "brake"> = {
  throttle: 0,
  steer: 0,
  brake: 0,
  // driveRange intentionally not cleared — transfer case stays in last range
};

export class GameApp {
  private state: GameState = { name: "boot" };
  private running = false;

  // Session (sandbox or level)
  private physics: PhysicsWorld | null = null;
  private vehicle: VehicleController | null = null;
  private input: InputRouter | null = null;
  private jeepMesh: THREE.Group | null = null;
  private three: ReturnType<typeof createRenderer> | null = null;
  private gameScene: GameSceneHandles | null = null;
  private level: LevelData | null = null;
  private finishSystem: FinishSystem | null = null;
  private checkpointSystem: CheckpointSystem | null = null;
  private respawnSystem: RespawnSystem | null = null;
  private cameraRig: CameraRig | null = null;
  private hud: HudHandles | null = null;
  private uiUnmount: (() => void) | null = null;
  private acc = 0;
  private lastT = 0;
  private sessionActive = false;
  private sessionMode: "sandbox" | "level" | null = null;

  async start(): Promise<void> {
    this.running = true;
    if (import.meta.env.DEV) {
      // Playwright / console diagnostics — pose sample while session active
      const w = window as unknown as {
        __JEEP_DEBUG__?: () => unknown;
        __JEEP_ORBIT__?: (yaw: number, pitch?: number, dist?: number) => void;
      };
      w.__JEEP_DEBUG__ = () => {
        if (!this.vehicle) {
          return {
            state: this.state.name,
            session: this.sessionMode,
            active: this.sessionActive,
          };
        }
        const pose = this.vehicle.getPose();
        const body = this.vehicle.getChassisBody();
        const lv = body.linvel();
        return {
          state: this.state.name,
          session: this.sessionMode,
          active: this.sessionActive,
          pose,
          y: pose.position.y,
          x: pose.position.x,
          z: pose.position.z,
          yaw: pose.yaw,
          vy: lv.y,
          mass: body.mass(),
          comLocal: body.localCom?.() ?? null,
          grounded: this.vehicle.getGroundedCount?.() ?? -1,
          driveRange: this.vehicle.getDriveRange?.() ?? null,
          driveLabel: this.vehicle.getDriveLabel?.() ?? null,
          speedMps: this.vehicle.getSpeedMps?.() ?? null,
          availableEngine: this.vehicle.getAvailableEngineForce?.() ?? null,
          orbit: this.cameraRig?.getOrbit() ?? null,
        };
      };
      // Absolute orbit for visual QA (yaw/pitch rad, optional arm length m).
      w.__JEEP_ORBIT__ = (yaw: number, pitch?: number, dist?: number) => {
        this.cameraRig?.setOrbit(yaw, pitch, dist);
        if (this.cameraRig && this.vehicle) {
          this.cameraRig.update(0, this.vehicle.getPose(), { snap: true });
        }
      };
    }
    await this.enter(this.state);
    requestAnimationFrame((t) => this.frame(t));
  }

  private dispatch(event: Parameters<typeof reduce>[1]): void {
    const next = reduce(this.state, event);
    if (next !== this.state) {
      this.state = next;
      void this.enter(next);
    }
  }

  private unmountUi(): void {
    if (this.uiUnmount) {
      this.uiUnmount();
      this.uiUnmount = null;
    }
  }

  private teardownSession(): void {
    this.sessionActive = false;
    this.sessionMode = null;
    this.input?.dispose();
    this.input = null;
    this.vehicle?.dispose();
    this.vehicle = null;
    this.physics?.destroy();
    this.physics = null;
    this.jeepMesh = null;
    this.three = null;
    this.level = null;
    this.finishSystem = null;
    this.checkpointSystem = null;
    this.respawnSystem = null;
    this.cameraRig = null;
    if (this.hud) {
      this.hud.dispose();
      this.hud = null;
    }
    if (this.gameScene) {
      this.gameScene.dispose();
      this.gameScene = null;
    }
    this.acc = 0;
  }

  private async enter(state: GameState): Promise<void> {
    this.unmountUi();
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
        this.teardownSession();
        const root = document.querySelector<HTMLElement>("#ui-root");
        if (root) {
          this.uiUnmount = mountMenu(root, {
            onStart: ({ biomeId, seed }) => {
              this.dispatch({ type: "START", biomeId, seed });
            },
            // Dev-only flat sandbox; never exposed in production builds
            ...(import.meta.env.DEV
              ? {
                  onFlatTest: () => {
                    void this.startFlatSandbox();
                  },
                }
              : {}),
          });
        }
        break;
      }
      case "loading": {
        const root = document.querySelector<HTMLElement>("#ui-root");
        if (root) {
          const panel = document.createElement("div");
          panel.className = "loading-overlay";
          panel.innerHTML = `
            <div class="panel loading-panel">
              Loading <strong>${state.biomeId}</strong> · seed ${state.seed}…
            </div>
          `;
          root.appendChild(panel);
          this.uiUnmount = () => panel.remove();
        }
        try {
          await this.loadLevel(state.biomeId, state.seed);
          this.dispatch({ type: "LOADED" });
        } catch (e) {
          this.teardownSession();
          this.dispatch({
            type: "LOAD_FAIL",
            message: e instanceof Error ? e.message : String(e),
          });
        }
        break;
      }
      case "playing": {
        this.unmountUi();
        clearUi();
        if (this.hud) {
          this.hud.dispose();
          this.hud = null;
        }
        const root = document.querySelector<HTMLElement>("#ui-root");
        if (root && this.level) {
          this.hud = createHud(root, {
            biomeId: this.level.biomeId,
            seed: this.level.seed,
            usedFallback: this.level.meta.usedFallback,
          });
        }
        this.sessionActive = true;
        this.lastT = performance.now();
        this.acc = 0;
        break;
      }
      case "result": {
        this.sessionActive = false;
        if (this.hud) {
          this.hud.dispose();
          this.hud = null;
        }
        // Keep 3D scene visible behind result overlay for polish.
        const root = document.querySelector<HTMLElement>("#ui-root");
        if (root) {
          this.uiUnmount = mountResult(
            root,
            { biomeId: state.biomeId, seed: state.seed },
            {
              onRetrySame: () => this.dispatch({ type: "RETRY_SAME" }),
              onRetryNew: (seed) =>
                this.dispatch({ type: "RETRY_NEW", seed }),
              onMenu: () => this.dispatch({ type: "TO_MENU" }),
            },
          );
        }
        break;
      }
      case "error":
        this.teardownSession();
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

  private async loadLevel(biomeId: string, seed: number): Promise<void> {
    this.teardownSession();
    const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
    if (!canvas) throw new Error("Missing canvas");

    const biome = getBiome(biomeId as BiomeId);
    const normalized = normalizeSeed(seed);
    const level = generateLevel({
      seed: normalized,
      biome,
      vehicle: VEHICLE_CAPABILITIES,
    });
    this.level = level;

    this.physics = await PhysicsWorld.create();
    createTerrainCollider(this.physics.getWorld(), level);
    // Warm broadphase so raycasts hit heightfield on first vehicle update.
    this.physics.step();

    // Sample actual heightmap (not path polyline Y) so we never spawn buried in terrain.
    const groundY = sampleBilinear(
      level.heightmap,
      level.resolution,
      level.worldSize,
      level.start.position.x,
      level.start.position.z,
    );
    const spawnPose = {
      position: {
        x: level.start.position.x,
        y: chassisSpawnY(groundY),
        z: level.start.position.z,
      },
      yaw: level.start.yaw,
    };
    this.vehicle = new VehicleController(this.physics.getWorld(), spawnPose);

    this.finishSystem = new FinishSystem(level.finish);
    this.checkpointSystem = new CheckpointSystem(spawnPose, level.checkpoints);
    this.respawnSystem = new RespawnSystem(
      level.killY,
      this.checkpointSystem,
      this.vehicle,
    );
    this.input = new InputRouter(new KeyboardProvider(window, canvas));
    this.gameScene = createGameScene(canvas, level, biome);
    this.jeepMesh = this.gameScene.jeepMesh;
    this.cameraRig = new CameraRig(this.gameScene.camera);
    // Snap third-person follow to spawn so first frame is not lerping from origin.
    this.cameraRig.update(1, spawnPose);
    this.sessionMode = "level";
  }

  private async startFlatSandbox(): Promise<void> {
    this.unmountUi();
    this.teardownSession();
    const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
    if (!canvas) throw new Error("Missing canvas");

    this.physics = await PhysicsWorld.create();
    this.physics.createGroundPlane(0);
    this.physics.step();
    this.vehicle = new VehicleController(this.physics.getWorld(), {
      position: { x: 0, y: 2, z: 0 },
      yaw: 0,
    });
    this.input = new InputRouter(new KeyboardProvider(window, canvas));
    this.three = createRenderer(canvas);
    // Neutral desert-ish ground for mesh review (matches reference vibe)
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(200, 0.2, 200),
      new THREE.MeshLambertMaterial({ color: 0x9a8f78 }),
    );
    ground.position.y = 0;
    ground.receiveShadow = true;
    this.three.scene.add(ground);
    // Soft fill so white body reads like the photo
    const hemi = new THREE.HemisphereLight(0xddeeff, 0x8a7a60, 0.55);
    this.three.scene.add(hemi);
    this.jeepMesh = createJeepMesh();
    this.jeepMesh.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    this.three.scene.add(this.jeepMesh);
    this.cameraRig = new CameraRig(this.three.camera);
    this.cameraRig.update(1, {
      position: { x: 0, y: 2, z: 0 },
      yaw: 0,
    });
    this.sessionMode = "sandbox";
    this.sessionActive = true;
    this.lastT = performance.now();
    this.acc = 0;
    clearUi();
    if (this.hud) {
      this.hud.dispose();
      this.hud = null;
    }
    const root = document.querySelector<HTMLElement>("#ui-root");
    if (root) {
      // Reuse play HUD chrome so RANGE badge is visible in flat test too.
      this.hud = createHud(root, {
        biomeId: "flat-test",
        seed: 0,
        driveLabel: "4H",
      });
      this.hud.infoEl.textContent =
        "Flat test · Shift 4H/4L · drag look · C camera · reload for menu";
      // Hide level-only widgets in sandbox.
      this.hud.root.querySelector(".hud-goal")?.setAttribute("hidden", "");
      this.hud.minimapCanvas.style.display = "none";
      this.uiUnmount = () => {
        this.hud?.dispose();
        this.hud = null;
      };
    }
  }

  private frame(t: number): void {
    if (!this.running) return;

    // Keep rendering the level scene under the result overlay.
    const renderLevelScene =
      this.gameScene &&
      (this.sessionActive || this.state.name === "result") &&
      this.sessionMode === "level";

    if (
      this.sessionActive &&
      this.physics &&
      this.vehicle &&
      this.input &&
      this.jeepMesh
    ) {
      const dt = Math.min(0.05, (t - this.lastT) / 1000);
      this.lastT = t;
      this.acc += dt;
      while (this.acc >= FIXED_DT) {
        const actions = this.input.sample();
        const poseBefore = this.vehicle.getPose();

        if (this.sessionMode === "level" && this.checkpointSystem) {
          this.checkpointSystem.update(poseBefore.position);
        }
        if (this.sessionMode === "level" && this.respawnSystem) {
          this.respawnSystem.update(
            FIXED_DT,
            poseBefore.position,
            actions,
          );
        }

        if (actions.cameraToggle && this.cameraRig) {
          this.cameraRig.toggle();
        }
        if (this.cameraRig) {
          this.cameraRig.applyLookDelta(
            actions.lookDeltaX,
            actions.lookDeltaY,
          );
        }

        const drive: InputActions =
          this.respawnSystem?.inputLocked()
            ? {
                ...actions,
                ...ZERO_DRIVE,
              }
            : actions;

        this.vehicle.update(FIXED_DT, drive, this.physics.getWorld());
        this.physics.step();
        if (
          this.sessionMode === "level" &&
          this.finishSystem &&
          this.state.name === "playing"
        ) {
          const pose = this.vehicle.getPose();
          if (this.finishSystem.isFinished(pose.position)) {
            this.dispatch({ type: "WIN" });
            this.acc = 0;
            break;
          }
        }
        this.acc -= FIXED_DT;
      }

      const pose = this.vehicle.getPose();
      syncJeepMesh(this.jeepMesh, pose, this.vehicle.getWheelVisuals());

      // Speed + range badges (level + sandbox).
      const speedMps = this.vehicle.getSpeedMps();
      if (this.hud) {
        updateHudDrive(this.hud, {
          driveLabel: this.vehicle.getDriveLabel(),
          speedMps,
        });
      }

      if (this.sessionMode === "level" && this.gameScene) {
        if (this.cameraRig) {
          this.cameraRig.update(dt, pose);
        }
        // Local shadow cascade tracks camera (cheap open-world shadows)
        this.gameScene.updateShadows(this.gameScene.camera.position);
        if (this.hud && this.level && this.state.name === "playing") {
          updateHud(this.hud, {
            biomeId: this.level.biomeId,
            seed: this.level.seed,
            usedFallback: this.level.meta.usedFallback,
            driveLabel: this.vehicle.getDriveLabel(),
            speedMps,
            worldSize: this.level.worldSize,
            player: {
              x: pose.position.x,
              z: pose.position.z,
              yaw: pose.yaw,
            },
            finish: {
              x: this.level.finish.position.x,
              z: this.level.finish.position.z,
            },
            checkpoints: this.level.checkpoints.map((c) => ({
              x: c.position.x,
              z: c.position.z,
            })),
          });
        }
        this.gameScene.renderer.render(
          this.gameScene.scene,
          this.gameScene.camera,
        );
      } else if (this.three) {
        if (this.cameraRig) {
          this.cameraRig.update(dt, pose);
        } else {
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
        }
        this.three.updateShadows(this.three.camera.position);
        this.three.renderer.render(this.three.scene, this.three.camera);
      }
    } else if (renderLevelScene && this.gameScene) {
      this.gameScene.renderer.render(
        this.gameScene.scene,
        this.gameScene.camera,
      );
    }

    requestAnimationFrame((nt) => this.frame(nt));
  }
}
