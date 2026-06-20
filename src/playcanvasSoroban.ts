import * as pc from 'playcanvas';
import sorobanCadSource from '../public/soroban-cad.jscad.js?raw';
import * as jscadModeling from '@jscad/modeling';
import { geometries, primitives } from '@jscad/modeling';
import {
  createSorobanModel,
  type BeadModel,
  type SorobanState
} from './soroban.js';

export type ThemeName = 'walnut' | 'ash' | 'slate';
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
const minCanvasHeight = 220;
const maxCanvasHeight = 360;
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
  private readonly root: pc.Entity;
  private materials: ReturnType<typeof createMaterials>;
  private beadShape: BeadShapeStyle = defaultBeadShape;
  private readonly screenPoint = new pc.Vec3();
  private readonly worldPoint = new pc.Vec3();
  private logicalBeads: readonly BeadModel[] = [];
  private beadEntities = new Map<string, BeadEntity>();
  private cadMeshes: pc.Mesh[] = [];
  private renderLayout: CadRenderLayout | null = null;
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
    this.app.scene.ambientLight = new pc.Color(0.68, 0.64, 0.58);
    this.app.scene.exposure = 1.28;

    this.materials = createMaterials(this.app.graphicsDevice, 'walnut');
    this.root = new pc.Entity('parametric-soroban');

    this.camera = new pc.Entity('camera');
    this.camera.addComponent('camera', {
      clearColor: new pc.Color(0.067, 0.078, 0.09, 1),
      farClip: 40,
      fov: 24,
      nearClip: 0.05
    });
    this.camera.setLocalPosition(0, -0.52, 8.9);
    this.camera.lookAt(0, -0.22, 0);
    this.app.root.addChild(this.camera);

    this.keyLight = new pc.Entity('key-light');
    this.keyLight.addComponent('light', {
      castShadows: false,
      color: new pc.Color(1, 0.94, 0.84),
      intensity: 2.18,
      shadowBias: 0.08,
      type: 'directional'
    });
    this.keyLight.setLocalEulerAngles(50, 24, 12);
    this.app.root.addChild(this.keyLight);

    this.fillLight = new pc.Entity('fill-light');
    this.fillLight.addComponent('light', {
      castShadows: false,
      color: new pc.Color(0.68, 0.76, 1),
      intensity: 0.54,
      type: 'directional'
    });
    this.fillLight.setLocalEulerAngles(-22, -42, 0);
    this.app.root.addChild(this.fillLight);

    this.accentLight = new pc.Entity('accent-light');
    this.accentLight.addComponent('light', {
      color: new pc.Color(1, 0.82, 0.56),
      intensity: 0.34,
      range: 7.5,
      type: 'omni'
    });
    this.accentLight.setLocalPosition(-1.8, 1.4, 3.2);
    this.app.root.addChild(this.accentLight);
    this.app.root.addChild(this.root);
    this.app.start();
  }

  rebuild(state: SorobanState): void {
    const model = createSorobanModel(state);
    const canvasSize = getDisplayCanvasSize(model.config.columns);

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
    this.renderLayout = addJscadSorobanMeshes(
      this.root,
      this.app.graphicsDevice,
      this.materials,
      state,
      this.beadShape,
      this.cadMeshes,
      this.beadEntities
    );
    this.renderedState = state;
    this.fitCamera(this.renderLayout.width, this.renderLayout.height);
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

  setBeadShape(shape: BeadShapeStyle, state: SorobanState): void {
    if (isSameBeadShape(this.beadShape, shape)) {
      return;
    }

    this.beadShape = shape;
    this.rebuild(state);
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
    this.app.destroy();
  }

  private fitCamera(width: number, height: number): void {
    const aspect = Math.max(1, this.canvas.width / Math.max(1, this.canvas.height));
    const verticalFov = 24 * Math.PI / 180;
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const distanceForHeight = height / (2 * Math.tan(verticalFov / 2));
    const distanceForWidth = width / (2 * Math.tan(horizontalFov / 2));
    const padding = width < 4 ? 1.08 : 1.02;
    const distance = Math.max(distanceForHeight, distanceForWidth) * padding;

    this.camera.setLocalPosition(0, -0.72, distance);
    this.camera.lookAt(0, -0.24, 0);
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
}

function createMaterials(device: pc.GraphicsDevice, themeName: ThemeName) {
  const theme = getTheme(themeName);
  const frameTexture = createGrainTexture(device, `${themeName}-frame`, theme.frameTexture, 256, 128);
  const beadTexture = createGrainTexture(device, `${themeName}-bead`, theme.beadTexture, 192, 96);
  const placeTexture = createGrainTexture(device, `${themeName}-place`, theme.placeTexture, 192, 96);

  return {
    frame: material('frame', theme.frame, theme.frameGloss, 0, frameTexture, [3.4, 1]),
    bead: material('bead', theme.bead, theme.beadGloss, 0, beadTexture, [1.6, 1]),
    beadGrabbed: material('bead-grabbed', theme.bead, 0.95, 0, beadTexture, [1.6, 1], 0.14),
    ebony: material('place-bead', theme.place, theme.placeGloss, 0, placeTexture, [1.6, 1]),
    ebonyGrabbed: material('place-bead-grabbed', theme.place, 0.98, 0, placeTexture, [1.6, 1], 0.1),
    brass: material('brass', new pc.Color(0.82, 0.58, 0.26), 0.58, 0.7),
    rod: material('rod', new pc.Color(0.58, 0.58, 0.54), 0.26, 0.16)
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

    meshInstance.castShadow = false;
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
  emissiveIntensity = 0
): pc.StandardMaterial {
  const result = new pc.StandardMaterial();
  result.name = name;
  result.diffuse = diffuse;
  result.diffuseMap = diffuseMap ?? null;
  result.diffuseMapTiling = new pc.Vec2(tiling[0], tiling[1]);
  result.gloss = gloss;
  result.metalness = metalness;
  result.useMetalness = metalness > 0;
  result.emissive = diffuse.clone().mulScalar(emissiveIntensity);
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
      frame: new pc.Color(0.5, 0.35, 0.23),
      bead: new pc.Color(0.54, 0.35, 0.22),
      place: new pc.Color(0.82, 0.6, 0.34),
      frameGloss: 0.34,
      beadGloss: 0.36,
      placeGloss: 0.4,
      frameTexture: ['#6f5136', '#8a6948', '#3b2618'],
      beadTexture: ['#6c4a30', '#8a6040', '#3d291c'],
      placeTexture: ['#b98b51', '#d8aa70', '#815d37']
    },
    ash: {
      frame: new pc.Color(0.48, 0.44, 0.36),
      bead: new pc.Color(0.54, 0.53, 0.49),
      place: new pc.Color(0.74, 0.7, 0.6),
      frameGloss: 0.3,
      beadGloss: 0.34,
      placeGloss: 0.38,
      frameTexture: ['#807665', '#a39b89', '#5a5246'],
      beadTexture: ['#85837b', '#b0aea6', '#5f5e58'],
      placeTexture: ['#b7ae96', '#ddd3bc', '#8b826f']
    },
    slate: {
      frame: new pc.Color(0.25, 0.27, 0.28),
      bead: new pc.Color(0.34, 0.36, 0.36),
      place: new pc.Color(0.62, 0.66, 0.64),
      frameGloss: 0.42,
      beadGloss: 0.48,
      placeGloss: 0.58,
      frameTexture: ['#303436', '#454a4c', '#1d2021'],
      beadTexture: ['#4a4e4e', '#636767', '#2a2d2d'],
      placeTexture: ['#9da7a3', '#c0cac6', '#68706e']
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
    const alpha = 0.18 + (Math.sin(y * 0.21) + 1) * 0.06;
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
  const height = Math.round(Math.min(maxCanvasHeight, Math.max(minCanvasHeight, viewportHeight * 0.32)));

  return { width, height };
}

function getDisplayCanvasWidth(columns: number): number {
  const desiredWidth = Math.max(300, columns * 86 + 112);

  if (typeof window === 'undefined') {
    return desiredWidth;
  }

  return Math.round(Math.min(desiredWidth, Math.max(300, window.innerWidth - horizontalPagePadding)));
}
