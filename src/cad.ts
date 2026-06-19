import './styles.css';
import * as modeling from '@jscad/modeling';
import {
  cameras,
  controls,
  drawCommands,
  entitiesFromSolids,
  prepareRender
} from '@jscad/regl-renderer';

type ParamDef = {
  name: string;
  type: string;
  initial: number | string;
  min?: number;
  max?: number;
  step?: number;
  caption?: string;
};

type CadModule = {
  main: (params: Record<string, unknown>) => unknown;
  getParameterDefinitions?: () => ParamDef[];
};

type ViewerOptions = {
  glOptions: {
    gl: WebGLRenderingContext | WebGL2RenderingContext;
    optionalExtensions?: string[];
  };
  camera: Record<string, unknown>;
  drawCommands: typeof drawCommands;
  entities: unknown[];
};

const canvas = getRequiredElement<HTMLCanvasElement>('#cad-canvas');
const status = getRequiredElement<HTMLElement>('#cad-status');
const controlsContainer = getRequiredElement<HTMLElement>('#cad-controls');

const perspectiveCamera = cameras.perspective;
const orbitControls = controls.orbit;
const camera = { ...perspectiveCamera.defaults };
const orbit = { ...orbitControls.defaults };
const renderState = {
  rotate: [0, 0] as [number, number],
  pan: [0, 0] as [number, number],
  zoom: 0,
  dirty: true
};

let cadModule: CadModule;
let paramDefs: ParamDef[] = [];
let render: (options: ViewerOptions) => void;
let viewerOptions: ViewerOptions;
let entities: unknown[] = [];

void boot();

async function boot(): Promise<void> {
  status.textContent = 'Loading soroban-cad.jscad.js...';
  cadModule = await loadCadModule();
  paramDefs = cadModule.getParameterDefinitions ? cadModule.getParameterDefinitions() : [];
  buildControls();
  setupRenderer();
  rebuildModel();
  requestAnimationFrame(renderLoop);
}

async function loadCadModule(): Promise<CadModule> {
  const response = await fetch('/soroban-cad.jscad.js', { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`Could not load CAD source: ${response.status} ${response.statusText}`);
  }

  const source = await response.text();
  const module = { exports: {} as Partial<CadModule> };
  const requireShim = (name: string): unknown => {
    if (name === '@jscad/modeling') {
      return modeling;
    }

    throw new Error(`Unsupported CAD dependency: ${name}`);
  };

  new Function('require', 'module', 'exports', source)(requireShim, module, module.exports);

  if (typeof module.exports.main !== 'function') {
    throw new Error('CAD source did not export main().');
  }

  return module.exports as CadModule;
}

function buildControls(): void {
  controlsContainer.innerHTML = '';

  for (const def of paramDefs) {
    const label = document.createElement('label');
    label.textContent = def.caption || def.name;

    let input: HTMLInputElement;

    if (def.type === 'slider' || def.type === 'number') {
      input = document.createElement('input');
      input.type = 'range';
      input.min = String(def.min ?? 0);
      input.max = String(def.max ?? 100);
      input.step = String(def.step ?? 1);
      input.value = String(def.initial ?? def.min ?? 0);

      const valueDisplay = document.createElement('span');
      valueDisplay.textContent = input.value;
      valueDisplay.style.cssText = 'color:#d8b25f;font-weight:800;min-width:3ch;text-align:right;';

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;';
      row.appendChild(input);
      row.appendChild(valueDisplay);

      input.addEventListener('input', () => {
        valueDisplay.textContent = input.value;
        rebuildModel();
      });

      label.appendChild(row);
    } else if (def.type === 'text') {
      input = document.createElement('input');
      input.type = 'text';
      input.value = String(def.initial ?? '');
      input.addEventListener('input', rebuildModel);
      label.appendChild(input);
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = String(def.initial ?? '');
      input.addEventListener('input', rebuildModel);
      label.appendChild(input);
    }

    input.id = `cad-param-${def.name}`;
    input.dataset.paramName = def.name;
    input.dataset.paramType = def.type;

    controlsContainer.appendChild(label);
  }
}

function getParams(): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  for (const def of paramDefs) {
    const input = document.querySelector<HTMLInputElement>(`#cad-param-${def.name}`);
    if (!input) continue;

    if (def.type === 'slider' || def.type === 'number') {
      params[def.name] = Number(input.value);
    } else {
      params[def.name] = input.value;
    }
  }

  return params;
}

function setupRenderer(): void {
  const gl = createContext(canvas);
  camera.position = [165, -230, 185];
  camera.target = [0, 0, 45];
  perspectiveCamera.setProjection(camera, camera, getViewportSize());
  perspectiveCamera.update(camera, camera);

  viewerOptions = {
    glOptions: { gl },
    camera,
    drawCommands,
    entities: []
  };

  if (gl instanceof WebGLRenderingContext && gl.getExtension('OES_element_index_uint')) {
    viewerOptions.glOptions.optionalExtensions = ['oes_element_index_uint'];
  }

  render = prepareRender(viewerOptions);
}

function rebuildModel(): void {
  const params = getParams();
  const solids = [cadModule.main(params)].flat().filter(Boolean);
  const modelEntities = entitiesFromSolids({ color: [0.78, 0.64, 0.42, 1] }, ...(solids as never[])) as unknown[];

  entities = [
    {
      visuals: {
        drawCmd: 'drawGrid',
        show: true
      },
      size: [260, 260],
      ticks: [20, 5]
    },
    {
      visuals: {
        drawCmd: 'drawAxis',
        show: true
      },
      size: 90
    },
    ...modelEntities
  ];

  orbit.zoomToFit.tightness = 1.35;
  const fitted = orbitControls.zoomToFit({ controls: orbit, camera, entities: entities as never[] });
  Object.assign(orbit, fitted.controls);
  Object.assign(camera, fitted.camera);
  renderState.dirty = true;
  status.textContent = `${String(params.columns ?? '?')} columns loaded from /soroban-cad.jscad.js`;
}

function renderLoop(): void {
  updateCamera();

  if (renderState.dirty) {
    resizeCanvas();
    viewerOptions.entities = entities;
    viewerOptions.camera = camera;
    render(viewerOptions);
    renderState.dirty = false;
  }

  requestAnimationFrame(renderLoop);
}

function updateCamera(): void {
  if (renderState.rotate[0] !== 0 || renderState.rotate[1] !== 0) {
    const updated = orbitControls.rotate({ controls: orbit, camera, speed: 0.002 }, renderState.rotate);
    Object.assign(orbit, updated.controls);
    renderState.rotate = [0, 0];
    renderState.dirty = true;
  }

  if (renderState.pan[0] !== 0 || renderState.pan[1] !== 0) {
    const updated = orbitControls.pan({ controls: orbit, camera, speed: 1 }, renderState.pan);
    Object.assign(camera, updated.camera);
    renderState.pan = [0, 0];
    renderState.dirty = true;
  }

  if (renderState.zoom !== 0) {
    const updated = orbitControls.zoom({ controls: orbit, camera, speed: 0.08 }, renderState.zoom);
    Object.assign(orbit, updated.controls);
    renderState.zoom = 0;
    renderState.dirty = true;
  }

  const updated = orbitControls.update({ controls: orbit, camera });
  Object.assign(orbit, updated.controls);
  Object.assign(camera, updated.camera);
  perspectiveCamera.update(camera, camera);
}

function createContext(element: HTMLCanvasElement): WebGLRenderingContext | WebGL2RenderingContext {
  const gl = element.getContext('webgl2') ||
    element.getContext('webgl') ||
    element.getContext('experimental-webgl');

  if (!gl) {
    throw new Error('WebGL is not available.');
  }

  return gl as WebGLRenderingContext | WebGL2RenderingContext;
}

function resizeCanvas(): void {
  const pixelRatio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width * pixelRatio));
  const height = Math.max(1, Math.floor(rect.height * pixelRatio));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    perspectiveCamera.setProjection(camera, camera, { width, height });
  }
}

function getViewportSize(): { width: number; height: number } {
  const rect = canvas.getBoundingClientRect();

  return {
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height)
  };
}

function getRequiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Required element was not found: ${selector}`);
  }

  return element;
}
