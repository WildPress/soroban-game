import { useEffect, useRef } from 'react';
import * as pc from 'playcanvas';
import type { NumberBoardState } from './numberBoardGame.js';

type PlayCanvasNumberBoardProps = Readonly<{
  state: NumberBoardState;
}>;

export function PlayCanvasNumberBoard({ state }: PlayCanvasNumberBoardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<NumberBoardBubbleRenderer | null>(null);
  const stateRef = useRef(state);

  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const renderer = new NumberBoardBubbleRenderer(canvas);
    const observer = new ResizeObserver(() => {
      renderer.render(stateRef.current);
    });

    rendererRef.current = renderer;
    observer.observe(canvas);
    renderer.render(stateRef.current);

    return () => {
      observer.disconnect();
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.render(state);
  }, [state]);

  return <canvas ref={canvasRef} className="number-board-canvas" aria-hidden="true" />;
}

class NumberBoardBubbleRenderer {
  private readonly app: pc.Application;
  private readonly root: pc.Entity;
  private readonly camera: pc.Entity;
  private readonly materials: ReturnType<typeof createMaterials>;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.app = new pc.Application(canvas, {
      graphicsDeviceOptions: {
        alpha: true,
        antialias: true
      }
    });
    this.app.setCanvasFillMode(pc.FILLMODE_NONE);
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO);
    this.app.scene.ambientLight = new pc.Color(0.52, 0.56, 0.62);
    this.app.scene.exposure = 1.22;

    this.root = new pc.Entity('number-board-bubbles', this.app);
    this.camera = new pc.Entity('number-board-camera', this.app);
    this.materials = createMaterials();
    this.app.root.addChild(this.camera);
    this.camera.addComponent('camera', {
      clearColor: new pc.Color(0, 0, 0, 0),
      farClip: 20,
      nearClip: 0.05,
      projection: pc.PROJECTION_ORTHOGRAPHIC
    });
    this.camera.setLocalPosition(0, 0, 8);
    this.camera.lookAt(0, 0, 0);

    const keyLight = new pc.Entity('number-board-key-light', this.app);
    this.app.root.addChild(keyLight);
    keyLight.addComponent('light', {
      castShadows: false,
      color: new pc.Color(1, 0.9, 0.72),
      intensity: 2.2,
      type: 'directional'
    });
    keyLight.setLocalEulerAngles(36, 32, 0);

    const fillLight = new pc.Entity('number-board-fill-light', this.app);
    this.app.root.addChild(fillLight);
    fillLight.addComponent('light', {
      castShadows: false,
      color: new pc.Color(0.55, 0.72, 1),
      intensity: 0.62,
      type: 'directional'
    });
    fillLight.setLocalEulerAngles(-28, -34, 0);

    this.app.root.addChild(this.root);
    this.app.start();
  }

  render(state: NumberBoardState): void {
    const width = Math.max(1, Math.round(this.canvas.clientWidth));
    const height = Math.max(1, Math.round(this.canvas.clientHeight));
    const highlightedIds = new Set(state.highlightedCellIds);

    this.app.resizeCanvas(width, height);
    this.camera.camera!.orthoHeight = state.height * 0.54;
    this.root.children.slice().forEach((child) => child.destroy());

    for (const cell of state.cells) {
      const entity = new pc.Entity(cell.id, this.app);
      const highlighted = highlightedIds.has(cell.id);
      const removed = cell.status === 'removed';
      const material = removed
        ? this.materials.removed
        : highlighted
          ? this.materials.highlighted
          : this.materials.active[(cell.row * state.width + cell.column) % this.materials.active.length];
      const x = (cell.column - (state.width - 1) / 2) * 1.08;
      const y = ((state.height - 1) / 2 - cell.row) * 1.08;
      const scale = removed ? 0.42 : highlighted ? 1 : 0.94;

      this.root.addChild(entity);
      entity.addComponent('render', {
        type: 'sphere',
        material
      });
      entity.setLocalPosition(x, y, highlighted ? 0.12 : 0);
      entity.setLocalScale(scale, scale, 0.24);
    }
  }

  destroy(): void {
    this.app.destroy();
  }
}

function createMaterials() {
  return {
    active: [
      material('bubble-active-teal', new pc.Color(0.13, 0.35, 0.36), new pc.Color(0.31, 0.76, 0.72), 0.96),
      material('bubble-active-blue', new pc.Color(0.14, 0.24, 0.42), new pc.Color(0.37, 0.55, 0.95), 0.96),
      material('bubble-active-plum', new pc.Color(0.32, 0.18, 0.34), new pc.Color(0.8, 0.44, 0.86), 0.96),
      material('bubble-active-forest', new pc.Color(0.18, 0.34, 0.22), new pc.Color(0.54, 0.85, 0.5), 0.96),
      material('bubble-active-slate', new pc.Color(0.24, 0.3, 0.36), new pc.Color(0.58, 0.68, 0.78), 0.96)
    ],
    highlighted: material('bubble-highlighted', new pc.Color(0.95, 0.55, 0.13), new pc.Color(1, 0.82, 0.36), 0.96),
    removed: material('bubble-removed', new pc.Color(0.08, 0.09, 0.1), new pc.Color(0.18, 0.2, 0.22), 0.26)
  };
}

function material(name: string, diffuse: pc.Color, emissive: pc.Color, opacity: number): pc.StandardMaterial {
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
