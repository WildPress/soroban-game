import * as pc from 'playcanvas';
import { geometries, primitives } from '@jscad/modeling';
import {
  createSorobanModel,
  type BeadModel,
  type SorobanState
} from './soroban.js';

export type ThemeName = 'walnut' | 'ash' | 'slate';

export type RenderedBeadHit = Readonly<{
  bead: BeadModel;
}>;

type BeadEntity = Readonly<{
  entity: pc.Entity;
  meshInstance: pc.MeshInstance;
  bead: BeadModel;
  isPlaceBead: boolean;
}>;

type Geom3 = ReturnType<typeof primitives.cuboid>;
type Vec3Tuple = [number, number, number];
type RodSegment = Readonly<{
  centerY: number;
  length: number;
}>;
type BeadShape = Readonly<{
  tipRadius: number;
  shoulderRadius: number;
  waistRadius: number;
}>;

const columnPixelWidth = 82;
const canvasHeight = 560;
const horizontalPagePadding = 44;
const beadCenterZ = 0;
const rodCenterZ = beadCenterZ;
const defaultBeadShape = {
  tipRadius: 0.045,
  shoulderRadius: 0.33,
  waistRadius: 0.5
} as const satisfies BeadShape;
const placeDotDepth = 0.02;

export class PlayCanvasSorobanRenderer {
  private readonly app: pc.Application;
  private readonly camera: pc.Entity;
  private readonly keyLight: pc.Entity;
  private readonly fillLight: pc.Entity;
  private readonly pointerLight: pc.Entity;
  private readonly root: pc.Entity;
  private materials: ReturnType<typeof createMaterials>;
  private meshes: ReturnType<typeof createCadMeshes>;
  private readonly screenPoint = new pc.Vec3();
  private beadEntities = new Map<string, BeadEntity>();
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
    this.app.scene.ambientLight = new pc.Color(0.68, 0.66, 0.6);
    this.app.scene.exposure = 1.05;

    this.materials = createMaterials(this.app.graphicsDevice, 'walnut');
    this.meshes = createCadMeshes(this.app.graphicsDevice);
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
      color: new pc.Color(1, 0.98, 0.92),
      intensity: 1.2,
      shadowBias: 0.08,
      type: 'directional'
    });
    this.keyLight.setLocalEulerAngles(42, 28, 18);
    this.app.root.addChild(this.keyLight);

    this.fillLight = new pc.Entity('fill-light');
    this.fillLight.addComponent('light', {
      castShadows: false,
      color: new pc.Color(0.72, 0.8, 1),
      intensity: 0.46,
      type: 'directional'
    });
    this.fillLight.setLocalEulerAngles(-24, -34, 0);
    this.app.root.addChild(this.fillLight);

    this.pointerLight = new pc.Entity('pointer-light');
    this.pointerLight.addComponent('light', {
      color: new pc.Color(1, 0.96, 0.86),
      intensity: 0.36,
      range: 6,
      type: 'omni'
    });
    this.pointerLight.setLocalPosition(0, 0, 2.6);
    this.app.root.addChild(this.pointerLight);
    this.app.root.addChild(this.root);
    this.app.start();
  }

  rebuild(state: SorobanState): void {
    const model = createSorobanModel(state);
    const modelCanvasWidth = getCanvasWidth(model.config.columns);
    const canvasWidth = getDisplayCanvasWidth(modelCanvasWidth);

    this.canvas.style.setProperty('--columns', model.config.columns.toString());
    this.canvas.style.width = `${canvasWidth}px`;
    this.canvas.style.height = `${canvasHeight}px`;
    this.app.resizeCanvas(canvasWidth, canvasHeight);
    this.root.children.slice().forEach((child) => child.destroy());
    this.beadEntities = new Map<string, BeadEntity>();
    this.meshes = createCadMeshes(this.app.graphicsDevice);

    const frameDepth = 0.24;
    const beamDepth = frameDepth * 0.8;
    const frameThickness = model.frame.thickness * 1.9;
    const beamThickness = model.frame.beamThickness * 1.15;
    const boardTilt = -8;

    this.root.setLocalEulerAngles(boardTilt, 0, 0);
    this.fitCamera(model.frame.width + frameThickness * 1.6, model.frame.height + frameThickness * 1.6);

    addMesh(this.root, 'top-frame', this.meshes.frameMember, this.materials.frame, {
      position: [0, model.frame.topY, 0],
      scale: [model.frame.width + frameThickness, frameThickness, frameDepth]
    });
    addMesh(this.root, 'bottom-frame', this.meshes.frameMember, this.materials.frame, {
      position: [0, model.frame.bottomY, 0],
      scale: [model.frame.width + frameThickness, frameThickness, frameDepth]
    });
    addMesh(this.root, 'left-frame', this.meshes.frameMember, this.materials.frame, {
      position: [model.frame.leftX, (model.frame.topY + model.frame.bottomY) / 2, 0],
      scale: [frameThickness, model.frame.height, frameDepth]
    });
    addMesh(this.root, 'right-frame', this.meshes.frameMember, this.materials.frame, {
      position: [model.frame.rightX, (model.frame.topY + model.frame.bottomY) / 2, 0],
      scale: [frameThickness, model.frame.height, frameDepth]
    });
    addMesh(this.root, 'reckoning-bar', this.meshes.beam, this.materials.frame, {
      position: [0, model.frame.beamY, 0],
      scale: [model.frame.width + frameThickness * 0.45, beamThickness, beamDepth]
    });

    for (const rod of model.rods) {
      const columnBeads = model.beads.filter((bead) => bead.column === rod.column);
      const segments = getVisibleRodSegments(
        columnBeads,
        model.frame.bottomY - frameThickness * 0.35,
        model.frame.topY + frameThickness * 0.35,
        model.frame.beamY,
        beamThickness,
        model.config.beadHeight * 1.28 * 0.5
      );

      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];

        if (!segment) {
          continue;
        }

        const entity = addMesh(this.root, `${rod.id}-segment-${index}`, this.meshes.rod, this.materials.rod, {
          position: [rod.position.x, segment.centerY, rodCenterZ],
          scale: [1, 1, segment.length]
        });
        entity.setLocalEulerAngles(90, 0, 0);
      }
    }

    for (const column of model.columns) {
      if (!isPlaceColumn(column.index, model.config.columns)) {
        continue;
      }

      addMesh(this.root, `place-dot-${column.index}`, this.meshes.placeDot, this.materials.brass, {
        position: [column.x, model.frame.beamY + 0.006, beamDepth / 2 - placeDotDepth / 2 + 0.003],
        scale: [1, 1, 1]
      });
    }

    for (const bead of model.beads) {
      const isPlaceBead = bead.section === 'lower' && bead.index === 0 && isPlaceColumn(bead.column, model.config.columns);
      const material = getBeadMaterial(isPlaceBead, this.materials);
      const entity = new pc.Entity(bead.id);
      const meshInstance = new pc.MeshInstance(this.meshes.bead, material);
      meshInstance.castShadow = false;
      meshInstance.receiveShadow = true;
      entity.addComponent('render', {
        meshInstances: [meshInstance]
      });
      entity.setLocalPosition(bead.position.x, bead.position.y, beadCenterZ);
      entity.setLocalScale(bead.scale.x * 1.35, bead.scale.y * 1.28, bead.scale.z * 1.4);
      this.root.addChild(entity);
      this.beadEntities.set(bead.id, { entity, meshInstance, bead, isPlaceBead });
    }
  }

  update(state: SorobanState, animate = false): void {
    if (animate) {
      this.animateToState(state);
      return;
    }

    this.stopAnimation();
    const model = createSorobanModel(state);

    for (const bead of model.beads) {
      const rendered = this.beadEntities.get(bead.id);

      if (!rendered) {
        this.rebuild(state);
        return;
      }

      setRenderedBeadPosition(rendered, bead.position.y);
    }
  }

  previewBeads(
    currentState: SorobanState,
    nextState: SorobanState,
    beadIds: readonly string[],
    progress: number
  ): void {
    this.stopAnimation();

    const currentModel = createSorobanModel(currentState);
    const nextBeads = new Map(createSorobanModel(nextState).beads.map((bead) => [bead.id, bead]));
    const movingBeads = new Set(beadIds);
    const clampedProgress = Math.min(1, Math.max(0, progress));

    for (const bead of currentModel.beads) {
      const rendered = this.beadEntities.get(bead.id);

      if (!rendered) {
        this.rebuild(currentState);
        return;
      }

      const target = nextBeads.get(bead.id);
      const y =
        target && movingBeads.has(bead.id)
          ? bead.position.y + (target.position.y - bead.position.y) * clampedProgress
          : bead.position.y;

      setRenderedBeadPosition(rendered, y);
    }
  }

  setTheme(theme: ThemeName, state: SorobanState): void {
    this.materials = createMaterials(this.app.graphicsDevice, theme);
    this.rebuild(state);
  }

  setGrabbedBead(beadId: string | null): void {
    if (this.pointerLight.light) {
      this.pointerLight.light.intensity = beadId ? 0.95 : 0.36;
    }

    for (const rendered of this.beadEntities.values()) {
      rendered.meshInstance.material =
        beadId === rendered.bead.id
          ? getGrabbedBeadMaterial(rendered.isPlaceBead, this.materials)
          : getBeadMaterial(rendered.isPlaceBead, this.materials);
    }
  }

  hitTest(clientX: number, clientY: number): RenderedBeadHit | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let nearest: { bead: BeadModel; distance: number } | null = null;

    for (const rendered of this.beadEntities.values()) {
      this.camera.camera?.worldToScreen(rendered.entity.getPosition(), this.screenPoint);
      const dx = this.screenPoint.x - x;
      const dy = this.screenPoint.y - y;
      const distance = Math.hypot(dx, dy);

      if (distance <= 32 && (!nearest || distance < nearest.distance)) {
        nearest = { bead: rendered.bead, distance };
      }
    }

    return nearest ? { bead: nearest.bead } : null;
  }

  setPointerLight(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width - 0.5) * 5.2;
    const y = (0.5 - (clientY - rect.top) / rect.height) * 3.8;
    this.pointerLight.setLocalPosition(x, y, 2.8);
  }

  private fitCamera(width: number, height: number): void {
    const aspect = Math.max(1, this.canvas.width / Math.max(1, this.canvas.height));
    const verticalFov = 24 * Math.PI / 180;
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const distanceForHeight = height / (2 * Math.tan(verticalFov / 2));
    const distanceForWidth = width / (2 * Math.tan(horizontalFov / 2));
    const distance = Math.max(distanceForHeight, distanceForWidth) * 1.18;

    this.camera.setLocalPosition(0, -0.72, distance);
    this.camera.lookAt(0, -0.24, 0);
  }

  private animateToState(state: SorobanState): void {
    this.stopAnimation();

    const model = createSorobanModel(state);
    const starts = new Map<string, number>();
    const targets = new Map(model.beads.map((bead) => [bead.id, bead]));
    const durationMs = 150;
    const startTime = performance.now();

    for (const bead of model.beads) {
      const rendered = this.beadEntities.get(bead.id);

      if (!rendered) {
        this.rebuild(state);
        return;
      }

      starts.set(bead.id, rendered.entity.getLocalPosition().y);
    }

    const tick = (time: number) => {
      const progress = Math.min(1, (time - startTime) / durationMs);
      const eased = 1 - (1 - progress) ** 3;

      for (const [id, rendered] of this.beadEntities) {
        const target = targets.get(id);
        const start = starts.get(id);

        if (!target || start === undefined) {
          continue;
        }

        setRenderedBeadPosition(rendered, start + (target.position.y - start) * eased);
      }

      if (progress < 1) {
        this.animationFrame = window.requestAnimationFrame(tick);
      } else {
        this.animationFrame = null;
      }
    };

    this.animationFrame = window.requestAnimationFrame(tick);
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
    rod: material('rod', new pc.Color(0.57, 0.59, 0.56), 0.38, 0.45)
  };
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

function getTheme(themeName: ThemeName) {
  const themes = {
    walnut: {
      frame: new pc.Color(0.28, 0.18, 0.11),
      bead: new pc.Color(0.31, 0.24, 0.18),
      place: new pc.Color(0.68, 0.5, 0.31),
      frameGloss: 0.34,
      beadGloss: 0.38,
      placeGloss: 0.42,
      frameTexture: ['#3b2416', '#4f3323', '#24140c'],
      beadTexture: ['#4a392d', '#5a4738', '#2e231c'],
      placeTexture: ['#a77946', '#d0a06a', '#76502d']
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

function createCadMeshes(device: pc.GraphicsDevice) {
  return {
    bead: createBiconeMesh(device, defaultBeadShape),
    beam: createMeshFromGeom3(
      device,
      primitives.roundedCuboid({
        size: [1, 1, 1],
        roundRadius: 0.08,
        segments: 8
      })
    ),
    frameMember: createMeshFromGeom3(
      device,
      primitives.roundedCuboid({
        size: [1, 1, 1],
        roundRadius: 0.12,
        segments: 10
      })
    ),
    placeDot: createMeshFromGeom3(
      device,
      primitives.cylinder({
        height: placeDotDepth,
        radius: 0.055,
        segments: 32
      })
    ),
    rod: createMeshFromGeom3(
      device,
      primitives.cylinder({
        height: 1,
        radius: 0.018,
        segments: 28
      })
    )
  };
}

function createBiconeGeom3(): Geom3 {
  const radialSegments = 56;
  const rings = [
    { y: 0.5, radius: 0.045 },
    { y: 0.33, radius: 0.33 },
    { y: 0, radius: 0.5 },
    { y: -0.33, radius: 0.33 },
    { y: -0.5, radius: 0.045 }
  ];
  const points: Vec3Tuple[] = [];
  const faces: number[][] = [];

  for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
    const ring = rings[ringIndex];

    if (!ring) {
      continue;
    }

    for (let segment = 0; segment < radialSegments; segment += 1) {
      const angle = (segment / radialSegments) * Math.PI * 2;
      points.push([Math.cos(angle) * ring.radius, ring.y, Math.sin(angle) * ring.radius]);
    }
  }

  for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex += 1) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const next = (segment + 1) % radialSegments;
      const a = ringIndex * radialSegments + segment;
      const b = ringIndex * radialSegments + next;
      const c = (ringIndex + 1) * radialSegments + segment;
      const d = (ringIndex + 1) * radialSegments + next;
      faces.push([a, c, d, b]);
    }
  }

  faces.push(Array.from({ length: radialSegments }, (_, index) => radialSegments - 1 - index));
  faces.push(Array.from({ length: radialSegments }, (_, index) => (rings.length - 1) * radialSegments + index));

  return primitives.polyhedron({
    faces,
    orientation: 'outward',
    points
  });
}

function createBiconeMesh(device: pc.GraphicsDevice, beadShape: BeadShape): pc.Mesh {
  const radialSegments = 72;
  const rings = [
    { y: 0.5, radius: beadShape.tipRadius },
    { y: 0.33, radius: beadShape.shoulderRadius },
    { y: 0, radius: beadShape.waistRadius },
    { y: -0.33, radius: beadShape.shoulderRadius },
    { y: -0.5, radius: beadShape.tipRadius }
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
    const ring = rings[ringIndex];

    if (!ring) {
      continue;
    }

    const previous = rings[Math.max(0, ringIndex - 1)] ?? ring;
    const next = rings[Math.min(rings.length - 1, ringIndex + 1)] ?? ring;
    const slope = previous.y === next.y ? 0 : (next.radius - previous.radius) / (next.y - previous.y);

    for (let segment = 0; segment < radialSegments; segment += 1) {
      const angle = (segment / radialSegments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const normal = normalize([cos, -slope, sin]);

      positions.push(cos * ring.radius, ring.y, sin * ring.radius);
      normals.push(...normal);
      uvs.push(segment / radialSegments, ringIndex / (rings.length - 1));
    }
  }

  for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex += 1) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const next = (segment + 1) % radialSegments;
      const a = ringIndex * radialSegments + segment;
      const b = ringIndex * radialSegments + next;
      const c = (ringIndex + 1) * radialSegments + segment;
      const d = (ringIndex + 1) * radialSegments + next;

      indices.push(a, c, d, a, d, b);
    }
  }

  const topCenter = positions.length / 3;
  positions.push(0, rings[0]?.y ?? 0.5, 0);
  normals.push(0, 1, 0);
  uvs.push(0.5, 0);

  const bottomCenter = positions.length / 3;
  positions.push(0, rings[rings.length - 1]?.y ?? -0.5, 0);
  normals.push(0, -1, 0);
  uvs.push(0.5, 1);

  for (let segment = 0; segment < radialSegments; segment += 1) {
    const next = (segment + 1) % radialSegments;
    const bottomOffset = (rings.length - 1) * radialSegments;

    indices.push(topCenter, next, segment);
    indices.push(bottomCenter, bottomOffset + segment, bottomOffset + next);
  }

  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  mesh.setUvs(0, uvs);
  mesh.setIndices(indices);
  mesh.update();
  return mesh;
}

function normalize(vector: Vec3Tuple): Vec3Tuple {
  const length = Math.hypot(...vector) || 1;

  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function setRenderedBeadPosition(rendered: BeadEntity, y: number): void {
  rendered.entity.setLocalPosition(rendered.bead.position.x, y, beadCenterZ);
}

function getVisibleRodSegments(
  beads: readonly BeadModel[],
  bottomY: number,
  topY: number,
  beamY: number,
  beamThickness: number,
  beadHalfHeight: number
): readonly RodSegment[] {
  const occluders = beads
    .map((bead) => ({
      min: bead.position.y - beadHalfHeight * 1.06,
      max: bead.position.y + beadHalfHeight * 1.06
    }))
    .concat({
      min: beamY - beamThickness * 0.58,
      max: beamY + beamThickness * 0.58
    })
    .sort((a, b) => a.min - b.min);
  const segments: RodSegment[] = [];
  let cursor = bottomY;

  for (const occluder of occluders) {
    const min = Math.max(bottomY, occluder.min);
    const max = Math.min(topY, occluder.max);

    if (min - cursor > 0.018) {
      segments.push(toRodSegment(cursor, min));
    }

    cursor = Math.max(cursor, max);
  }

  if (topY - cursor > 0.018) {
    segments.push(toRodSegment(cursor, topY));
  }

  return segments;
}

function toRodSegment(fromY: number, toY: number): RodSegment {
  return {
    centerY: (fromY + toY) / 2,
    length: toY - fromY
  };
}

function createMeshFromGeom3(device: pc.GraphicsDevice, geometry: Geom3): pc.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const polygons = geometries.geom3.toPolygons(geometry);

  for (const polygon of polygons) {
    const start = positions.length / 3;

    for (const vertex of polygon.vertices) {
      positions.push(vertex[0], vertex[1], vertex[2]);
      uvs.push(vertex[0] + vertex[1] * 0.12, vertex[2] + vertex[1] * 0.2);
    }

    for (let index = 1; index < polygon.vertices.length - 1; index += 1) {
      indices.push(start, start + index, start + index + 1);
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

function addMesh(
  parent: pc.Entity,
  name: string,
  mesh: pc.Mesh,
  material: pc.Material,
  options: Readonly<{ position: Vec3Tuple; scale: Vec3Tuple }>
): pc.Entity {
  const entity = new pc.Entity(name);
  const meshInstance = new pc.MeshInstance(mesh, material);
  meshInstance.castShadow = false;
  meshInstance.receiveShadow = true;
  entity.addComponent('render', {
    meshInstances: [meshInstance]
  });
  entity.setLocalPosition(...options.position);
  entity.setLocalScale(...options.scale);
  parent.addChild(entity);
  return entity;
}

function isPlaceColumn(column: number, columns: number): boolean {
  return (columns - column) % 3 === 0;
}

function getCanvasWidth(columns: number): number {
  return columns * columnPixelWidth + 120;
}

function getDisplayCanvasWidth(modelCanvasWidth: number): number {
  if (typeof window === 'undefined') {
    return modelCanvasWidth;
  }

  return Math.min(modelCanvasWidth, Math.max(320, window.innerWidth - horizontalPagePadding));
}
