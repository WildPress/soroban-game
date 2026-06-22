import * as pc from 'playcanvas';
import sorobanCadSource from '../public/soroban-cad.jscad.js?raw';
import * as jscadModeling from '@jscad/modeling';
import { geometries, primitives } from '@jscad/modeling';
import {
  createSorobanModel,
  type BeadModel,
  type SorobanState
} from './soroban.js';
import type { NumberBoardState } from './numberBoardGame.js';

export type ThemeName = 'walnut' | 'ash' | 'slate';
export type AppearanceName = 'dark' | 'light';
export type BeadShapeStyle = Readonly<{
  tipRadius: number;
  shoulderRadius: number;
  waistRadius: number;
  roundness?: number;
  smoothness?: number;
}>;

export type RenderedBeadHit = Readonly<{
  bead: BeadModel;
}>;

type Geom3 = ReturnType<typeof primitives.cuboid>;
type Vec3Tuple = [number, number, number];
type CadGeometry = Geom3 & {
  color?: readonly [number, number, number, number];
};
type CadModule = Readonly<{
  main: (params: Record<string, unknown>) => CadGeometry | readonly CadGeometry[];
}>;
type CadBounds = Readonly<{
  min: Vec3Tuple;
  max: Vec3Tuple;
  width: number;
  height: number;
  depth: number;
}>;
type CadRenderLayout = Readonly<{
  centerX: number;
  centerY: number;
  centerZ: number;
  modelBottomY: number;
  width: number;
  height: number;
}>;
type CadMaterialKind = 'frame' | 'bead' | 'placeBead' | 'brass' | 'rod';
type BeadEntity = Readonly<{
  bead: BeadModel;
  entity: pc.Entity;
  meshInstance: pc.MeshInstance;
  isPlaceBead: boolean;
}>;
const horizontalPagePadding = 44;
const minCanvasHeight = 620;
const maxCanvasHeight = 780;
const gameCanvasVerticalPadding = 24;
const numberBubbleSpacing = 0.96;
const numberBubbleDiameter = 0.78;
const numberBubbleDepth = 0.22;
const numberBoardGap = 0.54;
const beadCenterZ = 0;
const jscadOutputScale = 18;
const defaultBeadShape = {
  tipRadius: 0.045,
  shoulderRadius: 0.33,
  waistRadius: 0.5
} as const satisfies BeadShapeStyle;

export class PlayCanvasSorobanRenderer {
  private readonly app: pc.Application;
  private readonly camera: pc.Entity;
  private readonly keyLight: pc.Entity;
  private readonly fillLight: pc.Entity;
  private readonly accentLight: pc.Entity;
  private readonly rimLight: pc.Entity;
  private readonly topLight: pc.Entity;
  private readonly leftBounceLight: pc.Entity;
  private readonly rightBounceLight: pc.Entity;
  private readonly root: pc.Entity;
  private readonly numberBoardRoot: pc.Entity;
  private materials: ReturnType<typeof createMaterials>;
  private readonly numberBoardMaterials: ReturnType<typeof createNumberBoardMaterials>;
  private readonly numberLabelMaterials = new Map<string, pc.StandardMaterial>();
  private beadShape: BeadShapeStyle = defaultBeadShape;
  private readonly screenPoint = new pc.Vec3();
  private readonly worldPoint = new pc.Vec3();
  private logicalBeads: readonly BeadModel[] = [];
  private beadEntities = new Map<string, BeadEntity>();
  private cadMeshes: pc.Mesh[] = [];
  private renderLayout: CadRenderLayout | null = null;
  private numberBoardState: NumberBoardState | null = null;
  private renderedState: SorobanState | null = null;
  private animationFrame: number | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.app = new pc.Application(canvas, {
      graphicsDeviceOptions: {
        alpha: true,
        antialias: true
      }
    });
    this.app.setCanvasFillMode(pc.FILLMODE_NONE);
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO);
    this.app.graphicsDevice.maxPixelRatio = getRenderPixelRatio();
    this.app.scene.ambientLight = new pc.Color(0.46, 0.46, 0.46);
    this.app.scene.exposure = 1.14;
    this.app.scene.skyboxIntensity = 0.58;

    this.materials = createMaterials(this.app.graphicsDevice, 'walnut');
    this.numberBoardMaterials = createNumberBoardMaterials();
    this.root = new pc.Entity('parametric-soroban');
    this.numberBoardRoot = new pc.Entity('number-board-bubbles', this.app);

    this.camera = new pc.Entity('camera');
    this.camera.addComponent('camera', {
      clearColor: new pc.Color(0.067, 0.078, 0.09, 1),
      farClip: 40,
      fov: 24,
      nearClip: 0.05
    });
    if (this.camera.camera) {
      this.camera.camera.shaderParams.toneMapping = pc.TONEMAP_ACES;
      this.camera.camera.shaderParams.gammaCorrection = pc.GAMMA_SRGB;
    }
    this.camera.setLocalPosition(0, -0.52, 8.9);
    this.camera.lookAt(0, -0.22, 0);
    this.app.root.addChild(this.camera);

    this.keyLight = new pc.Entity('key-light');
    this.keyLight.addComponent('light', {
      castShadows: true,
      color: new pc.Color(1, 1, 1),
      intensity: 1.52,
      normalOffsetBias: 0.035,
      shadowBias: 0.18,
      shadowDistance: 16,
      shadowIntensity: 0.16,
      shadowResolution: 1024,
      shadowType: pc.SHADOW_PCF5,
      type: 'directional'
    });
    this.keyLight.setLocalEulerAngles(42, -34, 18);
    this.app.root.addChild(this.keyLight);

    this.fillLight = new pc.Entity('fill-light');
    this.fillLight.addComponent('light', {
      castShadows: false,
      color: new pc.Color(1, 1, 1),
      intensity: 0.58,
      type: 'directional'
    });
    this.fillLight.setLocalEulerAngles(-18, 44, 0);
    this.app.root.addChild(this.fillLight);

    this.accentLight = new pc.Entity('accent-light');
    this.accentLight.addComponent('light', {
      color: new pc.Color(1, 1, 1),
      intensity: 0.16,
      range: 5.8,
      type: 'omni'
    });
    this.accentLight.setLocalPosition(-2.4, 1.2, 3.5);
    this.app.root.addChild(this.accentLight);

    this.rimLight = new pc.Entity('rim-light');
    this.rimLight.addComponent('light', {
      castShadows: false,
      color: new pc.Color(1, 1, 1),
      intensity: 0.44,
      type: 'directional'
    });
    this.rimLight.setLocalEulerAngles(-36, 138, 0);
    this.app.root.addChild(this.rimLight);

    this.topLight = new pc.Entity('top-softbox-light');
    this.topLight.addComponent('light', {
      castShadows: false,
      color: new pc.Color(1, 1, 1),
      intensity: 0.58,
      type: 'directional'
    });
    this.topLight.setLocalEulerAngles(80, 8, 0);
    this.app.root.addChild(this.topLight);

    this.leftBounceLight = new pc.Entity('left-bounce-light');
    this.leftBounceLight.addComponent('light', {
      castShadows: false,
      color: new pc.Color(1, 1, 1),
      intensity: 0.28,
      type: 'directional'
    });
    this.leftBounceLight.setLocalEulerAngles(18, 82, -8);
    this.app.root.addChild(this.leftBounceLight);

    this.rightBounceLight = new pc.Entity('right-bounce-light');
    this.rightBounceLight.addComponent('light', {
      castShadows: false,
      color: new pc.Color(1, 1, 1),
      intensity: 0.24,
      type: 'directional'
    });
    this.rightBounceLight.setLocalEulerAngles(18, -104, 8);
    this.app.root.addChild(this.rightBounceLight);
    this.app.root.addChild(this.root);
    this.app.root.addChild(this.numberBoardRoot);
    this.applyLightingPreset('dark');
    this.app.start();
  }

  rebuild(state: SorobanState, numberBoard?: NumberBoardState): void {
    const model = createSorobanModel(state);
    const canvasSize = getDisplayCanvasSize(model.config.columns);
    const nextNumberBoard = numberBoard ?? this.numberBoardState;

    this.canvas.style.setProperty('--columns', model.config.columns.toString());
    this.canvas.style.width = `${canvasSize.width}px`;
    this.canvas.style.height = `${canvasSize.height}px`;
    this.app.resizeCanvas(canvasSize.width, canvasSize.height);
    this.cadMeshes.forEach((mesh) => mesh.destroy());
    this.cadMeshes = [];
    this.root.children.slice().forEach((child) => child.destroy());
    this.logicalBeads = model.beads;
    this.beadEntities = new Map<string, BeadEntity>();
    const boardTilt = -8;
    this.root.setLocalEulerAngles(boardTilt, 0, 0);
    this.numberBoardRoot.setLocalEulerAngles(boardTilt, 0, 0);
    this.renderLayout = addJscadSorobanMeshes(
      this.root,
      this.app.graphicsDevice,
      this.materials,
      state,
      this.beadShape,
      this.cadMeshes,
      this.beadEntities
    );
    this.numberBoardState = nextNumberBoard;
    this.rebuildNumberBoard();
    this.renderedState = state;
    const combinedLayout = getCombinedRenderLayout(this.renderLayout, nextNumberBoard);
    this.fitCamera(combinedLayout.width, combinedLayout.height, combinedLayout.centerY);
  }

  update(state: SorobanState, animate = false): void {
    if (animate) {
      this.animateToState(state);
      return;
    }

    this.stopAnimation();
    this.rebuild(state);
  }

  previewBeads(
    currentState: SorobanState,
    nextState: SorobanState,
    beadIds: readonly string[],
    progress: number
  ): void {
    this.stopAnimation();
    this.moveBeadsBetweenStates(currentState, nextState, beadIds, easeOutCubic(progress), true);
  }

  setTheme(theme: ThemeName, state: SorobanState): void {
    this.materials = createMaterials(this.app.graphicsDevice, theme);
    this.rebuild(state);
  }

  setAppearance(appearance: AppearanceName): void {
    const color = appearance === 'light'
      ? new pc.Color(0.94, 0.96, 0.95, 1)
      : new pc.Color(0.067, 0.078, 0.09, 1);

    if (this.camera.camera) {
      this.camera.camera.clearColor = color;
    }

    this.applyLightingPreset(appearance);
  }

  setBeadShape(shape: BeadShapeStyle, state: SorobanState): void {
    if (isSameBeadShape(this.beadShape, shape)) {
      return;
    }

    this.beadShape = shape;
    this.rebuild(state);
  }

  setNumberBoard(state: NumberBoardState): void {
    this.numberBoardState = state;
    this.rebuildNumberBoard();
  }

  setGrabbedBead(beadId: string | null): void {
    for (const beadEntity of this.beadEntities.values()) {
      beadEntity.meshInstance.material =
        beadEntity.bead.id === beadId
          ? getGrabbedBeadMaterial(beadEntity.isPlaceBead, this.materials)
          : getBeadMaterial(beadEntity.isPlaceBead, this.materials);
    }
  }

  hitTest(clientX: number, clientY: number): RenderedBeadHit | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const layout = this.renderLayout;
    let nearest: { bead: BeadModel; distance: number } | null = null;

    if (!layout) {
      return null;
    }

    for (const bead of this.logicalBeads) {
      const localPoint = new pc.Vec3(
        bead.position.x - layout.centerX,
        bead.position.y - layout.modelBottomY - layout.centerY,
        beadCenterZ - layout.centerZ
      );
      this.root.getWorldTransform().transformPoint(localPoint, this.worldPoint);
      this.camera.camera?.worldToScreen(this.worldPoint, this.screenPoint);
      const dx = this.screenPoint.x - x;
      const dy = this.screenPoint.y - y;
      const distance = Math.hypot(dx, dy);

      if (distance <= 32 && (!nearest || distance < nearest.distance)) {
        nearest = { bead, distance };
      }
    }

    return nearest ? { bead: nearest.bead } : null;
  }

  destroy(): void {
    this.stopAnimation();
    this.cadMeshes.forEach((mesh) => mesh.destroy());
    this.cadMeshes = [];
    this.numberLabelMaterials.forEach((material) => {
      material.diffuseMap?.destroy();
      material.destroy();
    });
    this.numberLabelMaterials.clear();
    this.app.destroy();
  }

  private fitCamera(width: number, height: number, centerY: number): void {
    const aspect = Math.max(1, this.canvas.width / Math.max(1, this.canvas.height));
    const verticalFov = 24 * Math.PI / 180;
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const distanceForHeight = height / (2 * Math.tan(verticalFov / 2));
    const distanceForWidth = width / (2 * Math.tan(horizontalFov / 2));
    const padding = width < 4 ? 0.96 : 1.02;
    const distance = Math.max(distanceForHeight, distanceForWidth) * padding;

    this.camera.setLocalPosition(0, centerY - 0.55, distance);
    this.camera.lookAt(0, centerY - 0.02, 0);
  }

  private rebuildNumberBoard(): void {
    const state = this.numberBoardState;
    const layout = this.renderLayout;

    this.numberBoardRoot.children.slice().forEach((child) => child.destroy());

    if (!state || !layout) {
      return;
    }

    const highlightedIds = new Set(state.highlightedCellIds);
    const bubbleLayout = getNumberBoardRenderLayout(layout, state);

    for (const cell of state.cells) {
      const entity = new pc.Entity(cell.id, this.app);
      const highlighted = highlightedIds.has(cell.id);
      const removed = cell.status === 'removed';
      const material = removed
        ? this.numberBoardMaterials.removed
        : highlighted
          ? this.numberBoardMaterials.highlighted
          : this.numberBoardMaterials.active[(cell.row * state.width + cell.column) % this.numberBoardMaterials.active.length];
      const x = (cell.column - (state.width - 1) / 2) * numberBubbleSpacing;
      const y = bubbleLayout.centerY + ((state.height - 1) / 2 - cell.row) * numberBubbleSpacing;
      const scale = removed ? 0.34 : highlighted ? 0.74 : 0.68;

      this.numberBoardRoot.addChild(entity);
      entity.addComponent('render', {
        type: 'sphere',
        material
      });
      entity.setLocalPosition(x, y, highlighted ? 0.16 : 0.08);
      entity.setLocalScale(scale, scale, numberBubbleDepth);

      if (!removed) {
        const label = new pc.Entity(`${cell.id}-label`, this.app);
        const labelMaterial = this.getNumberLabelMaterial(cell.value, highlighted);
        const labelMesh = createNumberLabelMesh(this.app.graphicsDevice);
        const labelMeshInstance = new pc.MeshInstance(labelMesh, labelMaterial);

        this.numberBoardRoot.addChild(label);
        label.addComponent('render', {
          meshInstances: [labelMeshInstance]
        });
        label.setLocalPosition(x, y, highlighted ? 0.28 : 0.24);
        label.setLocalScale(scale, scale, numberBubbleDepth);
      }
    }
  }

  private getNumberLabelMaterial(value: number, highlighted: boolean): pc.StandardMaterial {
    const key = `${value}-${highlighted ? 'highlighted' : 'normal'}`;
    const cached = this.numberLabelMaterials.get(key);

    if (cached) {
      return cached;
    }

    const material = createNumberLabelMaterial(this.app.graphicsDevice, String(value), highlighted);
    this.numberLabelMaterials.set(key, material);
    return material;
  }

  private animateToState(state: SorobanState): void {
    this.stopAnimation();

    if (this.beadEntities.size === 0) {
      this.rebuild(state);
      return;
    }

    const currentState = this.renderedState ?? state;
    const movingBeadIds = getMovingBeadIdsFromModels(createSorobanModel(currentState).beads, createSorobanModel(state).beads);
    const starts = new Map<string, Vec3Tuple>();
    const durationMs = 150;
    const startTime = performance.now();

    for (const [id, beadEntity] of this.beadEntities) {
      const position = beadEntity.entity.getLocalPosition();
      starts.set(id, [position.x, position.y, position.z]);
    }

    const tick = (time: number) => {
      const progress = Math.min(1, (time - startTime) / durationMs);
      const eased = easeOutCubic(progress);

      this.moveBeadsBetweenStates(currentState, state, movingBeadIds, eased, false, starts);

      if (progress < 1) {
        this.animationFrame = window.requestAnimationFrame(tick);
        return;
      }

      this.animationFrame = null;
      this.rebuild(state);
    };

    this.animationFrame = window.requestAnimationFrame(tick);
  }

  private moveBeadsBetweenStates(
    currentState: SorobanState,
    nextState: SorobanState,
    beadIds: readonly string[],
    progress: number,
    liftMovingBeads: boolean,
    starts?: ReadonlyMap<string, Vec3Tuple>
  ): void {
    if (this.beadEntities.size === 0) {
      this.rebuild(progress >= 0.5 ? nextState : currentState);
      return;
    }

    const currentBeads = createSorobanModel(currentState).beads;
    const nextBeads = new Map(createSorobanModel(nextState).beads.map((bead) => [bead.id, bead]));
    const movingBeads = new Set(beadIds);
    const clampedProgress = Math.min(1, Math.max(0, progress));

    for (const currentBead of currentBeads) {
      const beadEntity = this.beadEntities.get(currentBead.id);
      const nextBead = nextBeads.get(currentBead.id);

      if (!beadEntity || !nextBead) {
        continue;
      }

      const isMoving = movingBeads.has(currentBead.id);
      const targetY = isMoving ? nextBead.position.y - currentBead.position.y : 0;
      const start = starts?.get(currentBead.id);
      const startY = start ? start[1] : 0;
      const startZ = start ? start[2] : 0;
      const y = startY + (targetY - startY) * clampedProgress;
      const zLift = liftMovingBeads && isMoving
        ? Math.sin(clampedProgress * Math.PI) * 0.035
        : 0;
      const z = startZ + (zLift - startZ) * clampedProgress;

      beadEntity.entity.setLocalPosition(0, y, z);
    }
  }


  private stopAnimation(): void {
    if (this.animationFrame === null) {
      return;
    }

    window.cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
  }

  private applyLightingPreset(appearance: AppearanceName): void {
    const preset = getLightingPreset(appearance);

    this.app.scene.ambientLight = preset.ambient;
    this.app.scene.exposure = preset.exposure;
    this.app.scene.skyboxIntensity = preset.skyboxIntensity;
    setLight(this.keyLight, preset.key);
    setLight(this.fillLight, preset.fill);
    setLight(this.accentLight, preset.accent);
    setLight(this.rimLight, preset.rim);
    setLight(this.topLight, preset.top);
    setLight(this.leftBounceLight, preset.leftBounce);
    setLight(this.rightBounceLight, preset.rightBounce);
  }
}

type LightPreset = Readonly<{
  color: pc.Color;
  intensity: number;
}>;

type LightingPreset = Readonly<{
  ambient: pc.Color;
  exposure: number;
  skyboxIntensity: number;
  key: LightPreset;
  fill: LightPreset;
  accent: LightPreset;
  rim: LightPreset;
  top: LightPreset;
  leftBounce: LightPreset;
  rightBounce: LightPreset;
}>;

function getLightingPreset(appearance: AppearanceName): LightingPreset {
  if (appearance === 'light') {
    return {
      ambient: new pc.Color(0.7, 0.7, 0.7),
      exposure: 1.08,
      skyboxIntensity: 0.7,
      key: { color: new pc.Color(1, 1, 1), intensity: 1.2 },
      fill: { color: new pc.Color(1, 1, 1), intensity: 0.7 },
      accent: { color: new pc.Color(1, 1, 1), intensity: 0.1 },
      rim: { color: new pc.Color(1, 1, 1), intensity: 0.38 },
      top: { color: new pc.Color(1, 1, 1), intensity: 0.7 },
      leftBounce: { color: new pc.Color(1, 1, 1), intensity: 0.36 },
      rightBounce: { color: new pc.Color(1, 1, 1), intensity: 0.32 }
    };
  }

  return {
    ambient: new pc.Color(0.46, 0.46, 0.46),
    exposure: 1.14,
    skyboxIntensity: 0.58,
    key: { color: new pc.Color(1, 1, 1), intensity: 1.52 },
    fill: { color: new pc.Color(1, 1, 1), intensity: 0.58 },
    accent: { color: new pc.Color(1, 1, 1), intensity: 0.12 },
    rim: { color: new pc.Color(1, 1, 1), intensity: 0.44 },
    top: { color: new pc.Color(1, 1, 1), intensity: 0.58 },
    leftBounce: { color: new pc.Color(1, 1, 1), intensity: 0.28 },
    rightBounce: { color: new pc.Color(1, 1, 1), intensity: 0.24 }
  };
}

function setLight(entity: pc.Entity, preset: LightPreset): void {
  if (!entity.light) {
    return;
  }

  entity.light.color = preset.color;
  entity.light.intensity = preset.intensity;
}

function createMaterials(device: pc.GraphicsDevice, themeName: ThemeName) {
  const theme = getTheme(themeName);
  const frameTexture = createGrainTexture(device, `${themeName}-frame`, theme.frameTexture, 512, 256);
  const beadTexture = createGrainTexture(device, `${themeName}-bead`, theme.beadTexture, 384, 192);
  const placeTexture = createGrainTexture(device, `${themeName}-place`, theme.placeTexture, 192, 96);
  const frameTiling: [number, number] = [4.4, 1.6];
  const beadTiling: [number, number] = [2.6, 1.4];

  return {
    frame: material('frame', theme.frame, theme.frameGloss, 0, frameTexture, frameTiling, {
      clearCoat: 0.14,
      clearCoatGloss: 0.28,
      specularityFactor: 0.38,
      textureEmissiveIntensity: 0.22
    }),
    bead: material('bead', theme.bead, theme.beadGloss, 0, beadTexture, beadTiling, {
      clearCoat: 0.2,
      clearCoatGloss: 0.34,
      specularityFactor: 0.44,
      textureEmissiveIntensity: 0.24
    }),
    beadGrabbed: material('bead-grabbed', theme.bead, 0.62, 0, beadTexture, beadTiling, {
      clearCoat: 0.26,
      clearCoatGloss: 0.42,
      emissiveIntensity: 0.08,
      specularityFactor: 0.5,
      textureEmissiveIntensity: 0.28
    }),
    ebony: material('place-bead', theme.place, theme.placeGloss, 0, placeTexture, [1.6, 1], {
      clearCoat: 0.18,
      clearCoatGloss: 0.32,
      specularityFactor: 0.4,
      textureEmissiveIntensity: 0.18
    }),
    ebonyGrabbed: material('place-bead-grabbed', theme.place, 0.62, 0, placeTexture, [1.6, 1], {
      clearCoat: 0.24,
      clearCoatGloss: 0.42,
      emissiveIntensity: 0.06,
      specularityFactor: 0.48,
      textureEmissiveIntensity: 0.22
    }),
    brass: material('brass', new pc.Color(0.82, 0.58, 0.26), 0.46, 0.74, undefined, [1, 1], {
      clearCoat: 0.12,
      clearCoatGloss: 0.48,
      specularityFactor: 0.72
    }),
    rod: material('rod', new pc.Color(0.58, 0.58, 0.54), 0.22, 0.18, undefined, [1, 1], {
      specularityFactor: 0.42
    })
  };
}

function createNumberBoardMaterials() {
  return {
    active: [
      numberBoardMaterial('bubble-active-teal', new pc.Color(0.07, 0.24, 0.25), new pc.Color(0.22, 0.6, 0.56), 0.98),
      numberBoardMaterial('bubble-active-blue', new pc.Color(0.08, 0.16, 0.34), new pc.Color(0.26, 0.42, 0.8), 0.98),
      numberBoardMaterial('bubble-active-plum', new pc.Color(0.22, 0.1, 0.25), new pc.Color(0.56, 0.3, 0.64), 0.98),
      numberBoardMaterial('bubble-active-forest', new pc.Color(0.11, 0.24, 0.15), new pc.Color(0.38, 0.66, 0.34), 0.98),
      numberBoardMaterial('bubble-active-slate', new pc.Color(0.14, 0.2, 0.26), new pc.Color(0.42, 0.52, 0.64), 0.98)
    ],
    highlighted: numberBoardMaterial('bubble-highlighted', new pc.Color(0.84, 0.42, 0.05), new pc.Color(1, 0.68, 0.22), 0.98),
    removed: numberBoardMaterial('bubble-removed', new pc.Color(0.08, 0.09, 0.1), new pc.Color(0.18, 0.2, 0.22), 0.3)
  };
}

function numberBoardMaterial(name: string, diffuse: pc.Color, emissive: pc.Color, opacity: number): pc.StandardMaterial {
  const nextMaterial = new pc.StandardMaterial();

  nextMaterial.name = name;
  nextMaterial.diffuse = diffuse;
  nextMaterial.emissive = emissive;
  nextMaterial.emissiveIntensity = 0.18;
  nextMaterial.gloss = 0.72;
  nextMaterial.metalness = 0.08;
  nextMaterial.opacity = opacity;
  nextMaterial.blendType = opacity < 1 ? pc.BLEND_NORMAL : pc.BLEND_NONE;
  nextMaterial.update();

  return nextMaterial;
}

function createNumberLabelMesh(device: pc.GraphicsDevice): pc.Mesh {
  const geometry = new pc.Geometry();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const sphereRadius = 0.5;
  const surfaceLift = 0.08;
  const halfWidth = 0.4;
  const halfHeight = 0.33;
  const columns = 18;
  const rows = 14;

  for (let row = 0; row <= rows; row += 1) {
    const v = row / rows;
    const y = (v - 0.5) * halfHeight * 2;

    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns;
      const x = (u - 0.5) * halfWidth * 2;
      const z = Math.sqrt(Math.max(0, sphereRadius * sphereRadius - x * x - y * y)) + surfaceLift;
      const normal = new pc.Vec3(x, y, z).normalize();

      positions.push(x, y, z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(u, 1 - v);
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const bottomLeft = row * (columns + 1) + column;
      const bottomRight = bottomLeft + 1;
      const topLeft = bottomLeft + columns + 1;
      const topRight = topLeft + 1;

      indices.push(bottomLeft, bottomRight, topRight, bottomLeft, topRight, topLeft);
    }
  }

  geometry.positions = positions;
  geometry.normals = normals;
  geometry.uvs = uvs;
  geometry.indices = indices;

  return pc.Mesh.fromGeometry(device, geometry);
}

function createNumberLabelMaterial(device: pc.GraphicsDevice, text: string, highlighted: boolean): pc.StandardMaterial {
  const texture = createNumberLabelTexture(device, text, highlighted);
  const material = new pc.StandardMaterial();

  material.name = `number-label-${text}-${highlighted ? 'highlighted' : 'normal'}`;
  material.diffuse = new pc.Color(1, 1, 1);
  material.emissive = new pc.Color(0, 0, 0);
  material.emissiveIntensity = 0;
  material.diffuseMap = texture;
  material.opacityMap = texture;
  material.opacityMapChannel = 'a';
  material.useLighting = false;
  material.blendType = pc.BLEND_NORMAL;
  material.depthTest = false;
  material.depthWrite = false;
  material.update();

  return material;
}

function createNumberLabelTexture(device: pc.GraphicsDevice, text: string, highlighted: boolean): pc.Texture {
  const canvas = document.createElement('canvas');
  const size = 256;
  const context = canvas.getContext('2d');

  canvas.width = size;
  canvas.height = size;

  if (!context) {
    throw new Error('Could not create number label texture context.');
  }

  context.clearRect(0, 0, size, size);
  context.save();
  context.translate(size / 2, size / 2);
  context.beginPath();
  context.arc(0, 0, 96, 0, Math.PI * 2);
  context.fillStyle = highlighted ? '#fff0bf' : '#ffffff';
  context.shadowColor = 'rgba(0, 0, 0, 0.46)';
  context.shadowBlur = 10;
  context.shadowOffsetY = 4;
  context.fill();
  context.shadowColor = 'transparent';
  context.lineWidth = 10;
  context.strokeStyle = highlighted ? 'rgba(78, 36, 4, 0.5)' : 'rgba(5, 14, 19, 0.32)';
  context.stroke();
  context.beginPath();
  context.arc(0, 0, 77, 0, Math.PI * 2);
  context.lineWidth = 3;
  context.strokeStyle = highlighted ? 'rgba(78, 36, 4, 0.3)' : 'rgba(5, 14, 19, 0.18)';
  context.stroke();
  context.restore();

  context.font = `900 ${text.length > 2 ? 68 : text.length > 1 ? 84 : 112}px Inter, system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.shadowColor = 'rgba(255, 255, 255, 0.28)';
  context.shadowBlur = 1;
  context.shadowOffsetY = 1;
  context.lineWidth = 4;
  context.strokeStyle = highlighted ? '#160b02' : '#071116';
  context.fillStyle = highlighted ? '#160b02' : '#071116';
  drawTrackedText(context, text, size / 2, size / 2 + 5, text.length > 1 ? 7 : 0);

  const texture = new pc.Texture(device, {
    width: size,
    height: size,
    mipmaps: true
  });

  texture.setSource(canvas);
  return texture;
}

function drawTrackedText(
  context: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  centerY: number,
  tracking: number
): void {
  if (tracking <= 0 || text.length <= 1) {
    context.strokeText(text, centerX, centerY);
    context.fillText(text, centerX, centerY);
    return;
  }

  const glyphWidths = Array.from(text, (character) => context.measureText(character).width);
  const totalWidth = glyphWidths.reduce((sum, width) => sum + width, 0) + tracking * (glyphWidths.length - 1);
  let x = centerX - totalWidth / 2;

  context.textAlign = 'left';

  Array.from(text).forEach((character, index) => {
    context.strokeText(character, x, centerY);
    context.fillText(character, x, centerY);
    x += (glyphWidths[index] ?? 0) + tracking;
  });

  context.textAlign = 'center';
}

function getNumberBoardRenderLayout(
  sorobanLayout: CadRenderLayout,
  state: NumberBoardState
): { width: number; height: number; centerY: number } {
  const width = (state.width - 1) * numberBubbleSpacing + numberBubbleDiameter;
  const height = (state.height - 1) * numberBubbleSpacing + numberBubbleDiameter;

  return {
    width,
    height,
    centerY: sorobanLayout.height / 2 + numberBoardGap + height / 2
  };
}

function getCombinedRenderLayout(
  sorobanLayout: CadRenderLayout,
  numberBoard: NumberBoardState | null
): { width: number; height: number; centerY: number } {
  if (!numberBoard) {
    return {
      width: sorobanLayout.width,
      height: sorobanLayout.height,
      centerY: 0
    };
  }

  const numberBoardLayout = getNumberBoardRenderLayout(sorobanLayout, numberBoard);
  const minY = -sorobanLayout.height / 2;
  const maxY = numberBoardLayout.centerY + numberBoardLayout.height / 2;

  return {
    width: Math.max(sorobanLayout.width, numberBoardLayout.width),
    height: maxY - minY,
    centerY: (minY + maxY) / 2
  };
}

function addJscadSorobanMeshes(
  root: pc.Entity,
  device: pc.GraphicsDevice,
  materials: ReturnType<typeof createMaterials>,
  state: SorobanState,
  beadShape: BeadShapeStyle,
  meshStore: pc.Mesh[],
  beadEntities: Map<string, BeadEntity>
): CadRenderLayout {
  const geometries = normalizeCadGeometries(loadSorobanCadModule().main(createJscadParams(state, beadShape)));
  const bounds = geometries.map(getCadBounds);
  const visibleBounds = bounds.filter((bound) => !isViewportAnchorBounds(bound));
  const globalBounds = combineCadBounds(visibleBounds);
  const model = createSorobanModel(state);
  const frameThickness = model.frame.thickness * 1.9;
  const layout = {
    centerX: (globalBounds.min[0] + globalBounds.max[0]) / 2,
    centerY: (globalBounds.min[1] + globalBounds.max[1]) / 2,
    centerZ: (globalBounds.min[2] + globalBounds.max[2]) / 2,
    modelBottomY: model.frame.bottomY - frameThickness / 2,
    width: globalBounds.width,
    height: globalBounds.height
  };
  let beadIndex = 0;

  for (let index = 0; index < geometries.length; index += 1) {
    const geometry = geometries[index];
    const geometryBounds = bounds[index];

    if (!geometry || !geometryBounds || isViewportAnchorBounds(geometryBounds)) {
      continue;
    }

    const materialKind = getCadMaterialKind(geometry);
    const mesh = createMeshFromJscadGeom3(device, geometry, layout, shouldSmoothCadGeometry(materialKind));
    const meshInstance = new pc.MeshInstance(mesh, getMaterialForCadGeometry(materialKind, materials));
    const bead = isBeadMaterialKind(materialKind) ? model.beads[beadIndex] : undefined;
    const entity = new pc.Entity(bead ? bead.id : `jscad-part-${index}`);

    meshInstance.castShadow = materialKind !== 'rod';
    meshInstance.receiveShadow = true;
    entity.addComponent('render', {
      meshInstances: [meshInstance]
    });
    root.addChild(entity);
    meshStore.push(mesh);

    if (bead) {
      beadEntities.set(bead.id, {
        bead,
        entity,
        meshInstance,
        isPlaceBead: materialKind === 'placeBead'
      });
      beadIndex += 1;
    }
  }

  return layout;
}

function createJscadParams(state: SorobanState, beadShape: BeadShapeStyle): Record<string, unknown> {
  return {
    beadHeight: state.config.beadHeight,
    columns: state.config.columns,
    roundness: beadShape.roundness ?? 0.25,
    shoulderRadius: beadShape.shoulderRadius,
    smoothness: beadShape.smoothness ?? 8,
    tipRadius: beadShape.tipRadius,
    value: state.values.join(''),
    waistRadius: beadShape.waistRadius
  };
}

let sorobanCadModule: CadModule | null = null;

function loadSorobanCadModule(): CadModule {
  if (sorobanCadModule) {
    return sorobanCadModule;
  }

  const module = { exports: {} as Partial<CadModule> };
  const requireShim = (id: string) => {
    if (id === '@jscad/modeling') {
      return jscadModeling;
    }

    throw new Error(`Unsupported JSCAD dependency: ${id}`);
  };

  new Function('require', 'module', 'exports', sorobanCadSource)(requireShim, module, module.exports);

  if (typeof module.exports.main !== 'function') {
    throw new Error('The soroban JSCAD model does not export main(params).');
  }

  sorobanCadModule = module.exports as CadModule;
  return sorobanCadModule;
}

function normalizeCadGeometries(geometry: CadGeometry | readonly CadGeometry[]): readonly CadGeometry[] {
  return Array.isArray(geometry)
    ? geometry as readonly CadGeometry[]
    : [geometry as CadGeometry];
}

function getCadBounds(geometry: CadGeometry): CadBounds {
  const min: Vec3Tuple = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: Vec3Tuple = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];

  for (const polygon of geometries.geom3.toPolygons(geometry)) {
    for (const vertex of polygon.vertices) {
      const point = toPlayCanvasCadPoint(vertex);
      min[0] = Math.min(min[0], point[0]);
      min[1] = Math.min(min[1], point[1]);
      min[2] = Math.min(min[2], point[2]);
      max[0] = Math.max(max[0], point[0]);
      max[1] = Math.max(max[1], point[1]);
      max[2] = Math.max(max[2], point[2]);
    }
  }

  return {
    min,
    max,
    width: max[0] - min[0],
    height: max[1] - min[1],
    depth: max[2] - min[2]
  };
}

function combineCadBounds(bounds: readonly CadBounds[]): CadBounds {
  const min: Vec3Tuple = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: Vec3Tuple = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];

  for (const bound of bounds) {
    min[0] = Math.min(min[0], bound.min[0]);
    min[1] = Math.min(min[1], bound.min[1]);
    min[2] = Math.min(min[2], bound.min[2]);
    max[0] = Math.max(max[0], bound.max[0]);
    max[1] = Math.max(max[1], bound.max[1]);
    max[2] = Math.max(max[2], bound.max[2]);
  }

  return {
    min,
    max,
    width: max[0] - min[0],
    height: max[1] - min[1],
    depth: max[2] - min[2]
  };
}

function createMeshFromJscadGeom3(
  device: pc.GraphicsDevice,
  geometry: CadGeometry,
  layout: CadRenderLayout,
  smoothNormals: boolean
): pc.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const vertexIndexByKey = new Map<string, number>();
  const polygons = geometries.geom3.toPolygons(geometry);

  for (const polygon of polygons) {
    const polygonIndices: number[] = [];

    for (const vertex of polygon.vertices) {
      const point = toPlayCanvasCadPoint(vertex);
      const x = point[0] - layout.centerX;
      const y = point[1] - layout.centerY;
      const z = point[2] - layout.centerZ;
      const vertexIndex = smoothNormals
        ? getSharedVertexIndex(vertexIndexByKey, positions, uvs, x, y, z)
        : addMeshVertex(positions, uvs, x, y, z);

      polygonIndices.push(vertexIndex);
    }

    for (let index = 1; index < polygon.vertices.length - 1; index += 1) {
      const first = polygonIndices[0];
      const second = polygonIndices[index + 1];
      const third = polygonIndices[index];

      if (first !== undefined && second !== undefined && third !== undefined) {
        indices.push(first, second, third);
      }
    }
  }

  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(pc.calculateNormals(positions, indices));
  mesh.setUvs(0, uvs);
  mesh.setIndices(indices);
  mesh.update();
  return mesh;
}

function getSharedVertexIndex(
  vertexIndexByKey: Map<string, number>,
  positions: number[],
  uvs: number[],
  x: number,
  y: number,
  z: number
): number {
  const key = `${Math.round(x * 100000)},${Math.round(y * 100000)},${Math.round(z * 100000)}`;
  const existingIndex = vertexIndexByKey.get(key);

  if (existingIndex !== undefined) {
    return existingIndex;
  }

  const vertexIndex = addMeshVertex(positions, uvs, x, y, z);
  vertexIndexByKey.set(key, vertexIndex);
  return vertexIndex;
}

function addMeshVertex(positions: number[], uvs: number[], x: number, y: number, z: number): number {
  const vertexIndex = positions.length / 3;
  positions.push(x, y, z);
  uvs.push(x + z * 0.12, y + z * 0.2);
  return vertexIndex;
}

function toPlayCanvasCadPoint(vertex: readonly number[]): Vec3Tuple {
  return [
    (vertex[0] ?? 0) / jscadOutputScale,
    (vertex[2] ?? 0) / jscadOutputScale,
    (vertex[1] ?? 0) / jscadOutputScale
  ];
}

function isViewportAnchorBounds(bounds: CadBounds): boolean {
  return bounds.width < 0.01 && bounds.height < 0.01 && bounds.depth < 0.01;
}

function getCadMaterialKind(geometry: CadGeometry): CadMaterialKind {
  const color = geometry.color;

  if (!color) {
    return 'frame';
  }

  const [red, green, blue] = color;

  if (isNearColor([red, green, blue], [0.6, 0.63, 0.64])) {
    return 'rod';
  }

  if (isNearColor([red, green, blue], [0.86, 0.64, 0.24])) {
    return 'brass';
  }

  if (isNearColor([red, green, blue], [0.72, 0.54, 0.34])) {
    return 'placeBead';
  }

  if (isNearColor([red, green, blue], [0.44, 0.3, 0.2])) {
    return 'bead';
  }

  return 'frame';
}

function shouldSmoothCadGeometry(materialKind: CadMaterialKind): boolean {
  return materialKind !== 'frame';
}

function isBeadMaterialKind(materialKind: CadMaterialKind): boolean {
  return materialKind === 'bead' || materialKind === 'placeBead';
}

function getMaterialForCadGeometry(
  materialKind: CadMaterialKind,
  materials: ReturnType<typeof createMaterials>
): pc.StandardMaterial {
  const materialByKind = {
    bead: materials.bead,
    brass: materials.brass,
    frame: materials.frame,
    placeBead: materials.ebony,
    rod: materials.rod
  } as const satisfies Record<CadMaterialKind, pc.StandardMaterial>;

  return materialByKind[materialKind];
}

function getBeadMaterial(isPlaceBead: boolean, materials: ReturnType<typeof createMaterials>): pc.StandardMaterial {
  return isPlaceBead
    ? materials.ebony
    : materials.bead;
}

function getGrabbedBeadMaterial(isPlaceBead: boolean, materials: ReturnType<typeof createMaterials>): pc.StandardMaterial {
  return isPlaceBead
    ? materials.ebonyGrabbed
    : materials.beadGrabbed;
}

function getMovingBeadIdsFromModels(
  currentBeads: readonly BeadModel[],
  nextBeads: readonly BeadModel[]
): readonly string[] {
  const nextById = new Map(nextBeads.map((bead) => [bead.id, bead]));

  return currentBeads
    .filter((bead) => {
      const nextBead = nextById.get(bead.id);

      return nextBead ? nextBead.position.y !== bead.position.y : false;
    })
    .map((bead) => bead.id);
}

function easeOutCubic(progress: number): number {
  const clampedProgress = Math.min(1, Math.max(0, progress));

  return 1 - (1 - clampedProgress) ** 3;
}

function isNearColor(
  actual: readonly [number, number, number],
  expected: readonly [number, number, number]
): boolean {
  return Math.abs(actual[0] - expected[0]) < 0.04 &&
    Math.abs(actual[1] - expected[1]) < 0.04 &&
    Math.abs(actual[2] - expected[2]) < 0.04;
}

function material(
  name: string,
  diffuse: pc.Color,
  gloss: number,
  metalness: number,
  diffuseMap?: pc.Texture,
  tiling: [number, number] = [1, 1],
  options: Readonly<{
    clearCoat?: number;
    clearCoatGloss?: number;
    emissiveIntensity?: number;
    specularityFactor?: number;
    textureEmissiveIntensity?: number;
  }> = {}
): pc.StandardMaterial {
  const result = new pc.StandardMaterial();
  const emissiveIntensity = options.emissiveIntensity ?? 0;

  result.name = name;
  result.diffuse = diffuse;
  result.diffuseMap = diffuseMap ?? null;
  result.diffuseMapTiling = new pc.Vec2(tiling[0], tiling[1]);
  result.gloss = gloss;
  result.metalness = metalness;
  result.useMetalness = metalness > 0;
  result.enableGGXSpecular = true;
  result.fresnelModel = pc.FRESNEL_SCHLICK;
  result.specularityFactor = options.specularityFactor ?? (metalness > 0 ? 0.7 : 0.42);
  result.clearCoat = options.clearCoat ?? 0;
  result.clearCoatGloss = options.clearCoatGloss ?? Math.min(0.5, gloss);
  result.emissive = diffuseMap && options.textureEmissiveIntensity
    ? new pc.Color(1, 1, 1)
    : diffuse.clone();
  result.emissiveIntensity = diffuseMap && options.textureEmissiveIntensity
    ? options.textureEmissiveIntensity
    : emissiveIntensity;
  if (diffuseMap && options.textureEmissiveIntensity) {
    result.emissiveMap = diffuseMap;
    result.emissiveMapTiling = new pc.Vec2(tiling[0], tiling[1]);
  }
  result.update();
  return result;
}

function isSameBeadShape(left: BeadShapeStyle, right: BeadShapeStyle): boolean {
  return left.tipRadius === right.tipRadius &&
    left.shoulderRadius === right.shoulderRadius &&
    left.waistRadius === right.waistRadius &&
    (left.roundness ?? 0.25) === (right.roundness ?? 0.25) &&
    (left.smoothness ?? 8) === (right.smoothness ?? 8);
}

function getTheme(themeName: ThemeName) {
  const themes = {
    walnut: {
      frame: new pc.Color(0.64, 0.55, 0.5),
      bead: new pc.Color(0.7, 0.6, 0.54),
      place: new pc.Color(0.62, 0.72, 0.66),
      frameGloss: 0.26,
      beadGloss: 0.3,
      placeGloss: 0.38,
      frameTexture: ['#64554e', '#857166', '#352c28'],
      beadTexture: ['#6d5b52', '#927c6e', '#3a2f2a'],
      placeTexture: ['#7f9187', '#c5d3c9', '#3f5148']
    },
    ash: {
      frame: new pc.Color(0.88, 0.86, 0.79),
      bead: new pc.Color(0.94, 0.91, 0.82),
      place: new pc.Color(0.84, 0.8, 0.68),
      frameGloss: 0.28,
      beadGloss: 0.31,
      placeGloss: 0.34,
      frameTexture: ['#b0aa98', '#efe6c8', '#766f5f'],
      beadTexture: ['#b7b19f', '#fff2cf', '#827a68'],
      placeTexture: ['#cabf9f', '#eadfc3', '#a3967a']
    },
    slate: {
      frame: new pc.Color(0.42, 0.46, 0.47),
      bead: new pc.Color(0.5, 0.54, 0.54),
      place: new pc.Color(0.72, 0.76, 0.73),
      frameGloss: 0.36,
      beadGloss: 0.4,
      placeGloss: 0.5,
      frameTexture: ['#495154', '#718083', '#22292b'],
      beadTexture: ['#586062', '#87908f', '#2d3435'],
      placeTexture: ['#aeb8b4', '#d0dad6', '#7d8783']
    }
  } as const;

  return themes[themeName];
}

function createGrainTexture(
  device: pc.GraphicsDevice,
  name: string,
  palette: readonly [string, string, string],
  width: number,
  height: number
): pc.Texture {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  canvas.width = width;
  canvas.height = height;

  if (!context) {
    throw new Error('Unable to create texture canvas context.');
  }

  context.fillStyle = palette[0];
  context.fillRect(0, 0, width, height);

  for (let y = 0; y < height; y += 1) {
    const wave = Math.sin(y * 0.12) * 11 + Math.sin(y * 0.035) * 22;
    const alpha = 0.24 + (Math.sin(y * 0.21) + 1) * 0.08;
    context.lineWidth = y % 11 === 0 ? 1.8 : 1;
    context.strokeStyle = y % 7 === 0 ? toRgba(palette[2], alpha) : toRgba(palette[1], alpha);
    context.beginPath();
    context.moveTo(0, y + Math.sin(y) * 0.7);

    for (let x = 0; x <= width; x += 16) {
      context.lineTo(x, y + Math.sin((x + wave) * 0.06) * 2.8);
    }

    context.stroke();
  }

  for (let index = 0; index < 18; index += 1) {
    const x = (index * 37) % width;
    const y = (index * 53) % height;
    const radius = 12 + (index % 5) * 5;
    const gradient = context.createRadialGradient(x, y, 1, x, y, radius);
    gradient.addColorStop(0, toRgba(palette[1], 0.16));
    gradient.addColorStop(1, toRgba(palette[0], 0));
    context.fillStyle = gradient;
    context.fillRect(Math.max(0, x - radius), Math.max(0, y - radius), radius * 2, radius * 2);
  }

  const texture = new pc.Texture(device, {
    addressU: pc.ADDRESS_REPEAT,
    addressV: pc.ADDRESS_REPEAT,
    magFilter: pc.FILTER_LINEAR,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    name
  });
  texture.setSource(canvas);
  return texture;
}

function toRgba(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getDisplayCanvasSize(columns: number): { width: number; height: number } {
  const width = getDisplayCanvasWidth(columns);
  const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight;
  const height = Math.round(Math.min(maxCanvasHeight, Math.max(minCanvasHeight, viewportHeight - gameCanvasVerticalPadding)));

  return { width, height };
}

function getDisplayCanvasWidth(columns: number): number {
  const desiredWidth = Math.max(300, columns * 86 + 112);

  if (typeof window === 'undefined') {
    return desiredWidth;
  }

  return Math.round(Math.min(desiredWidth, Math.max(300, window.innerWidth - horizontalPagePadding)));
}

function getRenderPixelRatio(): number {
  if (typeof window === 'undefined') {
    return 1;
  }

  return Math.min(2, Math.max(1, window.devicePixelRatio || 1));
}
