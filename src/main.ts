import {
  applyBeadInteraction,
  createSorobanModel,
  createSorobanState,
  getTotalValue,
  type BeadInteraction,
  type BeadInteractionIntent,
  type BeadModel,
  type BeadSection,
  type SorobanState
} from './soroban.js';
import { PlayCanvasSorobanRenderer, type ThemeName } from './playcanvasSoroban.js';
import './styles.css';

const columnsInput = getRequiredElement<HTMLInputElement>('columns');
const themeSelect = getRequiredElement<HTMLSelectElement>('theme');
const totalElement = getRequiredElement<HTMLElement>('total');
const columnControls = getRequiredElement<HTMLElement>('column-controls');
const resetButton = getRequiredElement<HTMLButtonElement>('reset');
const randomizeButton = getRequiredElement<HTMLButtonElement>('randomize');
const canvas = getRequiredElement<HTMLCanvasElement>('soroban-canvas');

const dragThresholdPx = 8;
const dragSnapDistancePx = 72;
const slideDurationMs = 150;

let state: SorobanState = createSorobanState({ columns: Number(columnsInput.value) });
let activePointer: Readonly<{
  pointerId: number;
  startY: number;
  bead: BeadModel;
}> | null = null;
let audioContext: AudioContext | null = null;

const renderer = new PlayCanvasSorobanRenderer(canvas);

window.addEventListener('pointermove', (event) => {
  renderer.setPointerLight(event.clientX, event.clientY);
});

canvas.addEventListener('pointerdown', (event) => {
  const hit = renderer.hitTest(event.clientX, event.clientY);

  if (!hit) {
    return;
  }

  ensureAudioContext();
  activePointer = {
    pointerId: event.pointerId,
    startY: event.clientY,
    bead: hit.bead
  };
  renderer.setGrabbedBead(hit.bead.id);
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => {
  if (!activePointer || activePointer.pointerId !== event.pointerId) {
    return;
  }

  const deltaY = event.clientY - activePointer.startY;

  if (Math.abs(deltaY) < dragThresholdPx) {
    renderer.update(state);
    return;
  }

  const nextState = applyBeadInteraction(state, getInteraction(activePointer.bead, deltaY));
  const movingBeadIds = getMovingBeadIds(state, nextState);
  const progress = Math.min(1, Math.abs(deltaY) / dragSnapDistancePx);

  renderer.previewBeads(state, nextState, movingBeadIds, progress);
});

canvas.addEventListener('pointerup', (event) => {
  if (!activePointer || activePointer.pointerId !== event.pointerId) {
    return;
  }

  const deltaY = event.clientY - activePointer.startY;

  commitState(applyBeadInteraction(state, getInteraction(activePointer.bead, deltaY)));
  renderer.setGrabbedBead(null);
  activePointer = null;
});

canvas.addEventListener('pointercancel', () => {
  renderer.update(state);
  renderer.setGrabbedBead(null);
  activePointer = null;
});

resetButton.addEventListener('click', () => {
  commitState(createSorobanState({ columns: state.config.columns }));
});

randomizeButton.addEventListener('click', () => {
  commitState(
    createSorobanState({
      columns: state.config.columns,
      values: Array.from({ length: state.config.columns }, () => Math.floor(Math.random() * 10))
    })
  );
});

columnsInput.addEventListener('change', () => {
  state = createSorobanState({
    columns: Number(columnsInput.value),
    values: state.values
  });
  columnsInput.value = state.config.columns.toString();
  rebuildBoard();
});

themeSelect.addEventListener('change', () => {
  renderer.setTheme(themeSelect.value as ThemeName, state);
});

rebuildBoard();

function rebuildBoard(): void {
  renderer.rebuild(state);
  renderColumnControls();
  updateHud();
}

function commitState(nextState: SorobanState): void {
  const changed = nextState.values.some((value, index) => value !== state.values[index]);

  state = nextState;
  renderer.update(state, changed);
  renderColumnControls();
  updateHud();

  if (changed) {
    window.setTimeout(playWoodTick, slideDurationMs);
  }
}

function getInteraction(bead: BeadModel, deltaY: number): BeadInteraction {
  return {
    column: bead.column,
    section: bead.section,
    index: bead.index,
    intent: getIntentFromDrag(bead.section, deltaY)
  };
}

function getIntentFromDrag(section: BeadSection, deltaY: number): BeadInteractionIntent {
  if (Math.abs(deltaY) < dragThresholdPx) {
    return 'toggle';
  }

  if (section === 'upper') {
    return deltaY > 0 ? 'activate' : 'deactivate';
  }

  return deltaY < 0 ? 'activate' : 'deactivate';
}

function getMovingBeadIds(currentState: SorobanState, nextState: SorobanState): readonly string[] {
  const nextBeads = new Map(createSorobanModel(nextState).beads.map((bead) => [bead.id, bead]));

  return createSorobanModel(currentState).beads
    .filter((bead) => {
      const nextBead = nextBeads.get(bead.id);

      return nextBead ? nextBead.position.y !== bead.position.y : false;
    })
    .map((bead) => bead.id);
}

function renderColumnControls(): void {
  columnControls.replaceChildren();

  for (let column = 0; column < state.config.columns; column += 1) {
    const value = state.values[column] ?? 0;
    const indicator = document.createElement('span');
    indicator.className = 'column-value';
    indicator.textContent = value.toString();
    indicator.ariaLabel = `Column ${column + 1} value ${value}`;
    columnControls.append(indicator);
  }
}

function updateHud(): void {
  totalElement.textContent = getTotalValue(state).toString();
}

function ensureAudioContext(): AudioContext | null {
  if (!audioContext) {
    audioContext = new AudioContext();
  }

  if (audioContext.state === 'suspended') {
    void audioContext.resume();
  }

  return audioContext;
}

function playWoodTick(): void {
  const context = ensureAudioContext();

  if (!context) {
    return;
  }

  const now = context.currentTime;
  const sampleRate = context.sampleRate;
  const buffer = context.createBuffer(1, Math.floor(sampleRate * 0.035), sampleRate);
  const samples = buffer.getChannelData(0);
  const source = context.createBufferSource();
  const gain = context.createGain();
  const filter = context.createBiquadFilter();
  const thump = context.createOscillator();
  const thumpGain = context.createGain();

  for (let index = 0; index < samples.length; index += 1) {
    const envelope = 1 - index / samples.length;
    samples[index] = (Math.random() * 2 - 1) * envelope * envelope;
  }

  source.buffer = buffer;
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1250 + Math.random() * 180, now);
  filter.Q.setValueAtTime(2.7, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.042);

  thump.type = 'triangle';
  thump.frequency.setValueAtTime(180 + Math.random() * 30, now);
  thump.frequency.exponentialRampToValueAtTime(95, now + 0.035);
  thumpGain.gain.setValueAtTime(0.0001, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.045, now + 0.004);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  thump.connect(thumpGain);
  thumpGain.connect(context.destination);
  source.start(now);
  source.stop(now + 0.04);
  thump.start(now);
  thump.stop(now + 0.05);
}

function getRequiredElement<TElement extends HTMLElement>(id: string): TElement {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing element #${id}`);
  }

  return element as TElement;
}
