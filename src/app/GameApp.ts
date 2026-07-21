import * as THREE from "three";
import { reduce, type GameState } from "./GameStateMachine";
import RAPIER from "@dimforge/rapier3d-compat";
import { showError, clearUi } from "@/ui/error";
import { mountMenu } from "@/ui/menu";
import { mountResult } from "@/ui/result";
import { PhysicsWorld } from "@/physics/PhysicsWorld";
import { VehicleController } from "@/physics/vehicle/VehicleController";
import { createTerrainCollider } from "@/physics/createTerrainCollider";
import { createPropColliders } from "@/physics/propColliders";
import { InputRouter } from "@/input/InputRouter";
import { KeyboardProvider } from "@/input/KeyboardProvider";
import { TouchProvider } from "@/input/TouchProvider";
import { createRenderer } from "@/render/createRenderer";
import {
  createJeepMesh,
  setJeepBrakeLights,
  setJeepGlassVisible,
  syncJeepMesh,
} from "@/render/JeepMesh";
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
  type HudHandlers,
} from "@/ui/hud";
import { requestGameFullscreen } from "@/ui/fullscreen";
import { mountLoading, type LoadingHandles } from "@/ui/loading";
import type { BiomeId } from "@/shared/types";
import type { InputActions } from "@/input/types";
import { biomeDisplayName, t } from "@/i18n";
import {
  OffroadFx,
  SANDBOX_DUST_COLOR,
} from "@/render/particles/OffroadFx";
import { TireTrackSystem } from "@/render/TireTrackSystem";

const FIXED_DT = 1 / 60;
/** Fixed steps of zero-input physics so spawn suspension settles under loading. */
const SPAWN_SETTLE_STEPS = 48;
/** Extra GPU frames under loading so first playing frame is not a shader hitch. */
const LOAD_WARM_RENDER_FRAMES = 2;
/** How often settle loop yields so the progress bar can paint. */
const SETTLE_PROGRESS_EVERY = 6;

const ZERO_DRIVE: Pick<InputActions, "throttle" | "steer" | "brake"> = {
  throttle: 0,
  steer: 0,
  brake: 0,
  // driveRange intentionally not cleared — transfer case stays in last range
};

const IDLE_INPUT: InputActions = {
  throttle: 0,
  steer: 0,
  brake: 0,
  driveRange: "H",
  cameraToggle: false,
  respawn: false,
  lookDeltaX: 0,
  lookDeltaY: 0,
};

/** Double-rAF so the browser can layout + paint loading UI before heavy work. */
function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

/** Single rAF — enough for progress bar width to paint between load phases. */
function yieldFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

type LoadProgress = {
  set: (ratio: number, statusKey?: Parameters<typeof t>[0]) => Promise<void>;
};

export class GameApp {
  private state: GameState = { name: "boot" };
  private running = false;

  // Session (sandbox or level)
  private physics: PhysicsWorld | null = null;
  private vehicle: VehicleController | null = null;
  private input: InputRouter | null = null;
  private touchProvider: TouchProvider | null = null;
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
  private offroadFx: OffroadFx | null = null;
  private tireTracks: TireTrackSystem | null = null;
  private acc = 0;
  private lastT = 0;
  private sessionActive = false;
  private sessionMode: "sandbox" | "level" | null = null;
  /**
   * True while quit-confirm modal is open — freeze physics / drive, keep render.
   */
  private drivePaused = false;
  /** Last drive inputs (for VFX). */
  private lastDriveActions: {
    throttle: number;
    brake: number;
  } = { throttle: 0, brake: 0 };
  /**
   * Respawn is only consumed inside the fixed-step loop. Latch so a press on a
   * high-refresh frame with 0 physics steps is not dropped before the next step.
   */
  private latchedRespawn = false;

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

  /** Keyboard always on; on-screen pad when RWD width ≤ touch breakpoint. */
  private createInputRouter(canvas: HTMLCanvasElement): InputRouter {
    const uiRoot = document.querySelector<HTMLElement>("#ui-root");
    if (!uiRoot) throw new Error("Missing #ui-root");
    this.touchProvider = new TouchProvider(uiRoot);
    return new InputRouter([
      new KeyboardProvider(window, canvas),
      this.touchProvider,
    ]);
  }

  /** HUD quit button + confirm modal → main menu. */
  private makeHudHandlers(): HudHandlers {
    return {
      onQuitToMenu: () => this.dispatch({ type: "TO_MENU" }),
      onQuitModalChange: (open) => {
        this.drivePaused = open;
        this.touchProvider?.setSuppressed(open);
        if (open) {
          this.acc = 0;
          this.latchedRespawn = false;
        } else if (this.sessionActive) {
          // Avoid a large catch-up step after the modal held the clock.
          this.lastT = performance.now();
        }
      },
    };
  }

  private teardownSession(): void {
    this.sessionActive = false;
    this.sessionMode = null;
    this.drivePaused = false;
    this.input?.dispose();
    this.input = null;
    this.touchProvider = null;
    this.latchedRespawn = false;
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
    if (this.offroadFx) {
      this.offroadFx.dispose();
      this.offroadFx = null;
    }
    if (this.tireTracks) {
      this.tireTracks.dispose();
      this.tireTracks = null;
    }
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
              // Must run in the tap gesture so mobile browsers allow fullscreen.
              void requestGameFullscreen();
              this.dispatch({ type: "START", biomeId, seed });
            },
            // ROAD card → flat paved practice sandbox
            onRoad: () => {
              void requestGameFullscreen();
              void this.startFlatSandbox();
            },
          });
        }
        break;
      }
      case "loading": {
        const root = document.querySelector<HTMLElement>("#ui-root");
        let loading: LoadingHandles | null = null;
        if (root) {
          loading = mountLoading(root, {
            biomeLabel: biomeDisplayName(state.biomeId),
            seed: state.seed,
          });
          this.uiUnmount = () => {
            loading?.dispose();
            loading = null;
          };
        }
        const progress: LoadProgress = {
          set: async (ratio, statusKey) => {
            if (!loading) return;
            loading.setProgress(ratio);
            if (statusKey) loading.setStatus(t(statusKey));
            await yieldFrame();
          },
        };
        try {
          // Let the loading overlay + empty bar paint before heavy work.
          await waitForPaint();
          await this.loadLevel(state.biomeId, state.seed, progress);
          // Zero-input settle so suspension is planted before playing starts.
          await this.quietSettleVehicle(progress);
          // Compile shaders / fill GPU pipelines under the overlay.
          await progress.set(0.96, "loading.status.gpu");
          this.warmLevelRender();
          await progress.set(1, "loading.status.ready");
          await waitForPaint();
          // Brief hold at 100% so the full bar is readable before dismiss.
          await new Promise<void>((r) => setTimeout(r, 300));
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
          this.hud = createHud(
            root,
            {
              biomeId: this.level.biomeId,
              seed: this.level.seed,
              usedFallback: this.level.meta.usedFallback,
            },
            this.makeHudHandlers(),
          );
        }
        // clearUi() wiped TouchProvider DOM mounted during loadLevel — put it back.
        if (root) this.touchProvider?.reattach(root);
        this.sessionActive = true;
        this.drivePaused = false;
        this.lastT = performance.now();
        this.acc = 0;
        break;
      }
      case "result": {
        this.sessionActive = false;
        // Hide on-screen controls so they do not float above the result panel.
        this.touchProvider?.setSuppressed(true);
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

  private async loadLevel(
    biomeId: string,
    seed: number,
    progress?: LoadProgress,
  ): Promise<void> {
    this.teardownSession();
    const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
    if (!canvas) throw new Error("Missing canvas");

    const report =
      progress?.set.bind(progress) ??
      (async () => {
        /* no-op when loading without UI */
      });

    await report(0.04, "loading.status.init");

    const biome = getBiome(biomeId as BiomeId);
    const normalized = normalizeSeed(seed);
    await report(0.08, "loading.status.terrain");
    const level = generateLevel({
      seed: normalized,
      biome,
      vehicle: VEHICLE_CAPABILITIES,
    });
    this.level = level;
    await report(0.38, "loading.status.physics");

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
    this.vehicle = new VehicleController(this.physics.getWorld(), spawnPose, {
      traction: biome.traction,
    });

    this.finishSystem = new FinishSystem(level.finish);
    this.checkpointSystem = new CheckpointSystem(spawnPose, level.checkpoints, {
      heightmap: level.heightmap,
      resolution: level.resolution,
      worldSize: level.worldSize,
    });
    this.respawnSystem = new RespawnSystem(
      level.killY,
      this.checkpointSystem,
      this.vehicle,
    );
    this.input = this.createInputRouter(canvas);
    await report(0.5, "loading.status.scene");
    this.gameScene = createGameScene(canvas, level, biome);
    // Fixed rock colliders share terrain groups (chassis + suspension rays).
    createPropColliders(
      this.physics.getWorld(),
      this.gameScene.collidableRockPlacements,
    );
    this.jeepMesh = this.gameScene.jeepMesh;
    this.cameraRig = new CameraRig(this.gameScene.camera);
    // Biome-specific chase cam (alpine: higher pitch for downhill overview)
    if (biome.camera) {
      this.cameraRig.setThirdPersonDefaults({
        pitch: biome.camera.thirdPitch,
        dist: biome.camera.thirdDist,
      });
    } else {
      this.cameraRig.setThirdPersonDefaults();
    }
    // Snap third-person follow to spawn so first frame is not lerping from origin.
    this.cameraRig.update(1, spawnPose);
    await report(0.78, "loading.status.fx");
    const terrainFx = {
      heightmap: level.heightmap,
      resolution: level.resolution,
      worldSize: level.worldSize,
      pathPolyline: level.pathPolyline,
      groundPalette: biome.groundPalette,
      pathWidth: biome.pathWidth,
      terrainColorMode: biome.terrainColorMode,
      seed: level.seed,
      snowCover: biome.snowCover,
    };
    this.offroadFx = new OffroadFx(this.gameScene.scene, {
      streams: level.streams,
      ponds: level.ponds,
      waterColor: biome.waterColor,
      // Dust samples same height/path blend as TerrainMesh vertex colors
      terrain: terrainFx,
    });
    this.tireTracks = new TireTrackSystem(this.gameScene.scene, {
      streams: level.streams,
      ponds: level.ponds,
      terrain: terrainFx,
    });
    this.sessionMode = "level";
    await report(0.84, "loading.status.settle");
  }

  /**
   * Run fixed zero-input physics so raycast suspension finds equilibrium under
   * the loading overlay. Call after vehicle + terrain (+ props) exist.
   */
  private async quietSettleVehicle(progress?: LoadProgress): Promise<void> {
    if (!this.physics || !this.vehicle) return;
    const world = this.physics.getWorld();
    const settleLo = 0.84;
    const settleHi = 0.95;
    for (let i = 0; i < SPAWN_SETTLE_STEPS; i++) {
      this.vehicle.update(FIXED_DT, IDLE_INPUT, world);
      this.physics.step();
      if (
        progress &&
        (i % SETTLE_PROGRESS_EVERY === 0 || i === SPAWN_SETTLE_STEPS - 1)
      ) {
        const t01 = (i + 1) / SPAWN_SETTLE_STEPS;
        await progress.set(settleLo + (settleHi - settleLo) * t01);
      }
    }
    // Kill residual bounce so the first playing frame is still.
    const body = this.vehicle.getChassisBody();
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.vehicle.snapRenderState();

    const pose = this.vehicle.getPose();
    if (this.jeepMesh) {
      syncJeepMesh(this.jeepMesh, pose, this.vehicle.getWheelVisuals());
    }
    if (this.cameraRig) {
      this.cameraRig.update(1, pose, { snap: true });
    }
  }

  /** Draw a few frames while loading is still up (shader compile / first-draw hitch). */
  private warmLevelRender(): void {
    if (!this.gameScene || !this.jeepMesh || !this.vehicle) return;
    const pose = this.vehicle.getPose();
    const wheels = this.vehicle.getWheelVisuals();
    syncJeepMesh(this.jeepMesh, pose, wheels);
    if (this.cameraRig) {
      this.cameraRig.update(0, pose, { snap: true });
    }
    for (let i = 0; i < LOAD_WARM_RENDER_FRAMES; i++) {
      this.gameScene.updateShadows(this.gameScene.camera.position);
      this.gameScene.renderer.render(
        this.gameScene.scene,
        this.gameScene.camera,
      );
    }
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
    this.input = this.createInputRouter(canvas);
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
    this.offroadFx = new OffroadFx(this.three.scene, {
      fallbackDustColor: SANDBOX_DUST_COLOR,
      waterColor: "#4a7a8c",
    });
    this.tireTracks = new TireTrackSystem(this.three.scene, {
      flatGroundY: 0.1,
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
      this.hud = createHud(
        root,
        {
          biomeId: "flat-test",
          seed: 0,
          driveLabel: "4H",
        },
        this.makeHudHandlers(),
      );
      this.hud.infoEl.textContent =
        "Flat test · Shift 4H/4L · drag look · C camera · Menu to exit";
      // Hide level-only widgets in sandbox (keep menu button).
      this.hud.root.querySelector(".hud-goal")?.setAttribute("hidden", "");
      this.hud.minimapCanvas.style.display = "none";
      this.uiUnmount = () => {
        this.hud?.dispose();
        this.hud = null;
      };
      // clearUi() removed touch DOM created just above — reattach.
      this.touchProvider?.reattach(root);
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

      if (this.drivePaused) {
        // Drain input buffers so look/respawn do not pile up under the modal.
        this.input.sample();
        this.acc = 0;
      } else {
        this.acc += dt;

        // Sample once per render frame so look is never stuck waiting on fixed steps.
        // (Previously sample+applyLook lived only inside the while — skip a step and
        // drag deltas sat uncleared / unapplied until the next physics tick.)
        const actions = this.input.sample();
        this.touchProvider?.setDriveRange(actions.driveRange);
        if (actions.respawn) this.latchedRespawn = true;
        if (actions.cameraToggle && this.cameraRig) {
          this.cameraRig.toggle();
          // FP cabin view: hide windshield / side / rear glass
          if (this.jeepMesh) {
            setJeepGlassVisible(
              this.jeepMesh,
              this.cameraRig.mode !== "first",
            );
          }
        }
        if (this.cameraRig) {
          this.cameraRig.applyLookDelta(
            actions.lookDeltaX,
            actions.lookDeltaY,
          );
        }

        while (this.acc >= FIXED_DT) {
          const poseBefore = this.vehicle.getPose();
          // Deliver latched respawn only on a real physics step (then clear).
          const stepActions: InputActions = {
            ...actions,
            respawn: this.latchedRespawn,
          };
          this.latchedRespawn = false;

          if (this.sessionMode === "level" && this.checkpointSystem) {
            this.checkpointSystem.update(poseBefore.position);
          }
          if (this.sessionMode === "level" && this.respawnSystem) {
            this.respawnSystem.update(
              FIXED_DT,
              poseBefore.position,
              stepActions,
            );
          }

          const drive: InputActions =
            this.respawnSystem?.inputLocked()
              ? {
                  ...stepActions,
                  ...ZERO_DRIVE,
                }
              : stepActions;

          this.lastDriveActions = {
            throttle: drive.throttle,
            brake: drive.brake,
          };

          this.vehicle.update(FIXED_DT, drive, this.physics.getWorld());
          this.physics.step();
          // Advance render double-buffer after each fixed tick (Fix Your Timestep).
          this.vehicle.commitRenderSnapshot();
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
      }

      // Render between prev/curr physics states so 60Hz physics stays smooth
      // on high-refresh displays (and when rAF dt jitters around 1/60).
      const renderAlpha = this.drivePaused ? 1 : this.acc / FIXED_DT;
      const pose = this.vehicle.getRenderPose(renderAlpha);
      const wheelVisuals = this.vehicle.getRenderWheelVisuals(renderAlpha);
      syncJeepMesh(this.jeepMesh, pose, wheelVisuals);
      // Keep glass visibility in sync if mode changed elsewhere
      if (this.cameraRig) {
        setJeepGlassVisible(this.jeepMesh, this.cameraRig.mode !== "first");
      }
      // Brake lamps: service intent only (not 4L coast engine-brake / 檔煞)
      setJeepBrakeLights(this.jeepMesh, this.vehicle.isServiceBraking());

      // Speed + range badges (level + sandbox).
      const speedMps = this.vehicle.getSpeedMps();
      if (this.hud) {
        updateHudDrive(this.hud, {
          driveLabel: this.vehicle.getDriveLabel(),
          speedMps,
        });
      }

      const contacts = this.vehicle.getWheelContacts();
      const wheels = wheelVisuals.map((wv, i) => ({
        contact: contacts[i] ?? false,
        suspensionLength: wv.suspensionLength,
        rotation: wv.rotation,
        steering: wv.steering,
      }));
      const linvel = this.vehicle.getLinvel();
      const bodyContacts = this.vehicle.getBodyContactPoints();
      if (this.offroadFx) {
        this.offroadFx.update(dt, {
          position: pose.position,
          yaw: pose.yaw,
          rotation: pose.rotation,
          linvel,
          throttle: this.lastDriveActions.throttle,
          brake: this.lastDriveActions.brake,
          driveRange: this.vehicle.getDriveRange(),
          wheels,
          bodyContacts,
        });
      }
      if (this.tireTracks) {
        this.tireTracks.update(dt, {
          position: pose.position,
          yaw: pose.yaw,
          rotation: pose.rotation,
          linvel,
          throttle: this.lastDriveActions.throttle,
          brake: this.lastDriveActions.brake,
          wheels: wheels.map((w) => ({
            contact: w.contact,
            suspensionLength: w.suspensionLength,
          })),
        });
      }

      const cameraOpts = {
        speedMps,
        linvel,
        wheelContacts: contacts,
        bodyContactCount: bodyContacts.length,
      };

      if (this.sessionMode === "level" && this.gameScene) {
        if (this.cameraRig) {
          this.cameraRig.update(dt, pose, cameraOpts);
        }
        // Palm wind (island-conquest style vertex sway)
        this.gameScene.updatePalmSway(t * 0.001);
        // Rainforest light rain + ground splash (camera-local)
        this.gameScene.updateRain(dt, this.gameScene.camera.position);
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
            path: this.level.pathPolyline.map((p) => ({ x: p.x, z: p.z })),
          });
        }
        this.gameScene.renderer.render(
          this.gameScene.scene,
          this.gameScene.camera,
        );
      } else if (this.three) {
        if (this.cameraRig) {
          this.cameraRig.update(dt, pose, cameraOpts);
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
      this.gameScene.updatePalmSway(t * 0.001);
      this.gameScene.renderer.render(
        this.gameScene.scene,
        this.gameScene.camera,
      );
    }

    requestAnimationFrame((nt) => this.frame(nt));
  }
}
