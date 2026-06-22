import { useCallback, useEffect, useRef, useState } from 'react';
import { createSorobanState, getTotalValue, type SorobanState } from './soroban.js';
import { PlayCanvasBoard } from './PlayCanvasBoard.js';
import type { BeadShapeStyle, ThemeName } from './playcanvasSoroban.js';
import {
  calculateChainScore,
  commitNumberBoardSelection,
  createNumberBoard,
  createSeededNumberBoardValues,
  getHighlightedCells,
  previewNumberBoardValue,
  type NumberBoardState
} from './numberBoardGame.js';

type StyleName = 'classic' | 'rounded' | 'sharp' | 'wide' | 'custom';
type AppearanceName = 'dark' | 'light';
type StylePreset = Readonly<{
  label: string;
  beadShape: BeadShapeStyle;
}>;

const styleStorageKey = 'soroban-style';
const customStyleStorageKey = 'soroban-custom-style';
const appearanceStorageKey = 'soroban-appearance';
const slideDurationMs = 150;
const stylePresets = {
  classic: {
    label: 'Classic',
    beadShape: {
      tipRadius: 0.045,
      shoulderRadius: 0.33,
      waistRadius: 0.5
    }
  },
  rounded: {
    label: 'Rounded',
    beadShape: {
      tipRadius: 0.085,
      shoulderRadius: 0.37,
      waistRadius: 0.48
    }
  },
  sharp: {
    label: 'Sharp',
    beadShape: {
      tipRadius: 0.025,
      shoulderRadius: 0.29,
      waistRadius: 0.55
    }
  },
  wide: {
    label: 'Wide',
    beadShape: {
      tipRadius: 0.05,
      shoulderRadius: 0.39,
      waistRadius: 0.58
    }
  },
  custom: {
    label: 'Custom',
    beadShape: {
      tipRadius: 0.045,
      shoulderRadius: 0.33,
      waistRadius: 0.5,
      roundness: 0.25,
      smoothness: 8
    }
  }
} as const satisfies Record<StyleName, StylePreset>;

const beadShapeRanges = {
  roundness: [0, 1],
  shoulderRadius: [0.22, 0.48],
  smoothness: [1, 16],
  tipRadius: [0.01, 0.18],
  waistRadius: [0.36, 0.6]
} as const satisfies Record<keyof Required<BeadShapeStyle>, readonly [number, number]>;

const themeOptions = [
  { value: 'walnut', label: 'Walnut' },
  { value: 'ash', label: 'Ash' },
  { value: 'slate', label: 'Slate' }
] as const satisfies ReadonlyArray<{ value: ThemeName; label: string }>;
const numberBoardDimensions = {
  width: 3,
  height: 3
} as const;
const initialNumberBoardSeed = 'starter-3x3-v1';
const initialBoardValues = createBoardValues(initialNumberBoardSeed);
const initialSorobanColumns = getRequiredSorobanColumns(initialBoardValues);

export function App() {
  const [state, setState] = useState<SorobanState>(() => createSorobanState({ columns: initialSorobanColumns }));
  const [boardSeed, setBoardSeed] = useState(initialNumberBoardSeed);
  const [numberBoard, setNumberBoard] = useState<NumberBoardState>(() => createNumberBoard(initialBoardValues, numberBoardDimensions));
  const [theme, setTheme] = useState<ThemeName>('walnut');
  const [appearance, setAppearanceState] = useState<AppearanceName>(() => getSavedAppearance());
  const [styleName, setStyleNameState] = useState<StyleName>(() => getSavedStyleName());
  const [customStyle, setCustomStyleState] = useState<BeadShapeStyle>(() => getSavedCustomStyle());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(true);
  const [score, setScore] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeBeadShape = styleName === 'custom' ? customStyle : stylePresets[styleName].beadShape;
  const sorobanValue = getTotalValue(state);
  const highlightedBoardValue = getHighlightedCells(numberBoard).reduce((sum, cell) => sum + cell.value, 0);
  const chainLength = numberBoard.highlightedCellIds.length;
  const chainScore = calculateChainScore(chainLength);
  const canCommitBoardSelection = numberBoard.highlightedCellIds.length > 0 && highlightedBoardValue === numberBoard.targetValue;
  const requiredSorobanColumns = getRequiredSorobanColumns(numberBoard.cells.map((cell) => cell.value));

  const ensureAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }

    if (audioContextRef.current.state === 'suspended') {
      void audioContextRef.current.resume();
    }

    return audioContextRef.current;
  }, []);

  const playWoodTick = useCallback(() => {
    const context = ensureAudioContext();
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
  }, [ensureAudioContext]);

  const commitState = useCallback((nextState: SorobanState) => {
    setState((currentState) => {
      const changed = nextState.values.some((value, index) => value !== currentState.values[index]);

      if (changed) {
        window.setTimeout(playWoodTick, slideDurationMs);
      }

      return nextState;
    });
  }, [playWoodTick]);

  const setStyleName = useCallback((nextStyle: StyleName) => {
    setStyleNameState(nextStyle);
    saveStyleName(nextStyle);
  }, []);

  const setCustomStyle = useCallback((nextStyle: BeadShapeStyle) => {
    setCustomStyleState(nextStyle);
    saveCustomStyle(nextStyle);
  }, []);

  const setAppearance = useCallback((nextAppearance: AppearanceName) => {
    setAppearanceState(nextAppearance);
    saveAppearance(nextAppearance);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.appearance = appearance;
  }, [appearance]);

  useEffect(() => {
    setNumberBoard((currentBoard) => previewNumberBoardValue(currentBoard, sorobanValue).state);
  }, [sorobanValue]);

  const commitBoardSelection = useCallback(() => {
    setNumberBoard((currentBoard) => {
      const commit = commitNumberBoardSelection(currentBoard);

      if (commit.success) {
        setScore((currentScore) => currentScore + calculateChainScore(commit.removedCellIds.length).points);
        setState((currentState) => createSorobanState({ columns: currentState.config.columns }));
      }

      return commit.state;
    });
  }, []);

  const resetBoardForSeed = useCallback((nextSeed: string) => {
    const nextValues = createBoardValues(nextSeed);
    const nextColumns = getRequiredSorobanColumns(nextValues);

    setBoardSeed(nextSeed);
    setNumberBoard(createNumberBoard(nextValues, numberBoardDimensions));
    setState(createSorobanState({ columns: nextColumns }));
    setScore(0);
  }, []);

  return (
    <main className="app-shell" aria-label="Soroban prototype" data-appearance={appearance}>
      <section className="score-hud" aria-label="Score">
        <div>
          <span className="label">Score</span>
          <strong id="score-value">{score}</strong>
        </div>
        <div>
          <span className="label">Chain</span>
          <strong id="chain-multiplier">x{Math.max(1, chainScore.multiplier)}</strong>
        </div>
      </section>

      <button
        id="settings-toggle"
        className="settings-toggle"
        type="button"
        aria-controls="settings-panel"
        aria-expanded={settingsOpen}
        onClick={() => {
          setSettingsOpen((open) => !open);
        }}
      >
        Settings
      </button>

      <section className="game-board-shell" aria-label="Game board">
        <PlayCanvasBoard
          state={state}
          numberBoard={numberBoard}
          theme={theme}
          appearance={appearance}
          beadShape={activeBeadShape}
          onCommitState={commitState}
          onInteractionStart={ensureAudioContext}
        />

        <section className="number-board-overlay" aria-label="Number board">
          <div className="number-board-header">
            <div className="sr-only">
              <span className="label">Target</span>
              <strong id="board-target">{sorobanValue}</strong>
            </div>
            <button
              id="board-go"
              className={!canCommitBoardSelection ? 'is-hidden-action' : ''}
              type="button"
              disabled={!canCommitBoardSelection}
              onClick={commitBoardSelection}
            >
              Go
            </button>
          </div>
          <div
            id="number-board"
            className="number-board"
            style={{ gridTemplateColumns: `repeat(${numberBoard.width}, minmax(0, 1fr))` }}
          >
            {numberBoard.cells.map((cell) => {
              const highlighted = numberBoard.highlightedCellIds.includes(cell.id);

              return (
                <span
                  key={cell.id}
                  className={[
                    'number-cell',
                    highlighted ? 'is-highlighted' : '',
                    cell.status === 'removed' ? 'is-removed' : ''
                  ].filter(Boolean).join(' ')}
                  data-cell-id={cell.id}
                  data-cell-value={cell.value}
                  data-cell-status={cell.status}
                  aria-label={`${cell.status === 'removed' ? 'Removed' : 'Active'} number ${cell.value}`}
                >
                  {cell.status === 'removed' ? '' : cell.value}
                </span>
              );
            })}
          </div>
        </section>
      </section>

      {instructionsOpen ? (
        <section className="instructions-backdrop" aria-label="Instructions">
          <div className="instructions-popover" role="dialog" aria-modal="true" aria-labelledby="instructions-title">
            <h1 id="instructions-title">Make a Chain</h1>
            <p>Use the soroban to make a number on a ball. Keep adding to extend the highlighted chain, then press Go to clear it.</p>
            <p>Longer chains score more: each ball adds +1 to the multiplier.</p>
            <button
              id="instructions-start"
              type="button"
              onClick={() => {
                setInstructionsOpen(false);
              }}
            >
              Start
            </button>
          </div>
        </section>
      ) : null}

      <section id="settings-panel" className="settings-panel" hidden={!settingsOpen}>
        <header>
          <h1>Settings</h1>
          <button
            id="settings-close"
            type="button"
            onClick={() => {
              setSettingsOpen(false);
            }}
          >
            Close
          </button>
        </header>
        <div className="settings-grid">
          <div className="settings-field settings-field-mode">
            <span className="label">Mode</span>
            <div className="segmented-control" role="group" aria-label="Color mode">
              {(['dark', 'light'] as const).map((mode) => (
                <button
                  key={mode}
                  id={`${mode}-mode`}
                  className={appearance === mode ? 'is-selected' : ''}
                  type="button"
                  aria-pressed={appearance === mode}
                  onClick={() => {
                    setAppearance(mode);
                  }}
                >
                  {mode === 'dark' ? 'Dark' : 'Light'}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-field">
            <span className="label">Theme</span>
            <select
              id="theme"
              value={theme}
              onChange={(event) => {
                setTheme(event.currentTarget.value as ThemeName);
              }}
            >
              {themeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="settings-field">
            <span className="label">Style</span>
            <div className="inline-control">
              <select
                id="style"
                value={styleName}
                onChange={(event) => {
                  setStyleName(toStyleName(event.currentTarget.value));
                }}
              >
                {Object.entries(stylePresets).map(([name, preset]) => (
                  <option key={name} value={name}>{preset.label}</option>
                ))}
              </select>
              <button
                id="randomize-style"
                className="icon-button"
                type="button"
                aria-label="Random style"
                onClick={() => {
                  setCustomStyle(createRandomBeadShape());
                  setStyleName('custom');
                }}
              >
                Rnd
              </button>
            </div>
          </div>
          <div className="settings-field settings-field-seed">
            <span className="label">Seed</span>
            <div className="seed-control">
              <input id="board-seed" type="text" readOnly value={boardSeed} />
              <button
                id="copy-seed"
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(boardSeed);
                }}
              >
                Copy
              </button>
              <button
                id="randomize-seed"
                type="button"
                onClick={() => {
                  resetBoardForSeed(createRandomBoardSeed());
                }}
              >
                Random
              </button>
            </div>
          </div>
        </div>
        <div className="settings-actions">
          <div className="actions">
            <button
              id="randomize"
              type="button"
              onClick={() => {
                commitState(
                  createSorobanState({
                    columns: state.config.columns,
                    values: Array.from({ length: state.config.columns }, () => Math.floor(Math.random() * 10))
                  })
                );
              }}
            >
              Random
            </button>
            <button
              id="reset"
              type="button"
              onClick={() => {
                commitState(createSorobanState({ columns: requiredSorobanColumns }));
              }}
            >
              Reset
            </button>
          </div>
        </div>
        <div id="column-controls" className="column-controls" aria-label="Column values">
          {state.values.map((value, index) => (
            <span key={`${state.config.columns}-${index}`} className="column-value" aria-label={`Column ${index + 1} value ${value}`}>
              {value}
            </span>
          ))}
        </div>
      </section>
    </main>
  );
}

function getSavedStyleName(): StyleName {
  try {
    return toStyleName(window.localStorage.getItem(styleStorageKey) ?? 'classic');
  } catch {
    return 'classic';
  }
}

function saveStyleName(nextStyle: StyleName): void {
  try {
    window.localStorage.setItem(styleStorageKey, nextStyle);
  } catch {
    // Local storage can be unavailable in private or constrained browser contexts.
  }
}

function getSavedCustomStyle(): BeadShapeStyle {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(customStyleStorageKey) ?? 'null') as Partial<BeadShapeStyle> | null;

    return parsed ? normalizeBeadShape(parsed) : stylePresets.custom.beadShape;
  } catch {
    return stylePresets.custom.beadShape;
  }
}

function saveCustomStyle(nextStyle: BeadShapeStyle): void {
  try {
    window.localStorage.setItem(customStyleStorageKey, JSON.stringify(nextStyle));
  } catch {
    // Local storage can be unavailable in private or constrained browser contexts.
  }
}

function getSavedAppearance(): AppearanceName {
  try {
    return toAppearanceName(window.localStorage.getItem(appearanceStorageKey) ?? 'dark');
  } catch {
    return 'dark';
  }
}

function saveAppearance(nextAppearance: AppearanceName): void {
  try {
    window.localStorage.setItem(appearanceStorageKey, nextAppearance);
  } catch {
    // Local storage can be unavailable in private or constrained browser contexts.
  }
}

function toAppearanceName(value: string): AppearanceName {
  return value === 'light' ? 'light' : 'dark';
}

function toStyleName(value: string): StyleName {
  return value in stylePresets ? value as StyleName : 'classic';
}

function createRandomBeadShape(): BeadShapeStyle {
  return {
    roundness: randomRange(beadShapeRanges.roundness, 0.025),
    shoulderRadius: randomRange(beadShapeRanges.shoulderRadius, 0.005),
    smoothness: randomInteger(beadShapeRanges.smoothness),
    tipRadius: randomRange(beadShapeRanges.tipRadius, 0.005),
    waistRadius: randomRange(beadShapeRanges.waistRadius, 0.005)
  };
}

function normalizeBeadShape(shape: Partial<BeadShapeStyle>): BeadShapeStyle {
  return {
    roundness: clampNumber(shape.roundness, beadShapeRanges.roundness, 0.25),
    shoulderRadius: clampNumber(shape.shoulderRadius, beadShapeRanges.shoulderRadius, 0.33),
    smoothness: Math.round(clampNumber(shape.smoothness, beadShapeRanges.smoothness, 8)),
    tipRadius: clampNumber(shape.tipRadius, beadShapeRanges.tipRadius, 0.045),
    waistRadius: clampNumber(shape.waistRadius, beadShapeRanges.waistRadius, 0.5)
  };
}

function randomRange(range: readonly [number, number], step: number): number {
  const [min, max] = range;
  const steps = Math.round((max - min) / step);

  return roundToStep(min + Math.floor(Math.random() * (steps + 1)) * step, step);
}

function randomInteger(range: readonly [number, number]): number {
  const [min, max] = range;

  return Math.floor(min + Math.random() * (max - min + 1));
}

function clampNumber(value: number | undefined, range: readonly [number, number], fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(range[1], Math.max(range[0], value));
}

function roundToStep(value: number, step: number): number {
  const precision = Math.max(0, String(step).split('.')[1]?.length ?? 0);

  return Number(value.toFixed(precision));
}

function createBoardValues(seed: string): readonly number[] {
  return createSeededNumberBoardValues(seed, {
    count: numberBoardDimensions.width * numberBoardDimensions.height
  });
}

function createRandomBoardSeed(): string {
  const randomValues = new Uint32Array(2);

  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(randomValues);
  } else {
    randomValues[0] = Math.floor(Math.random() * 0xffffffff);
    randomValues[1] = Math.floor(Math.random() * 0xffffffff);
  }

  return `board-${(randomValues[0] ?? 0).toString(36)}-${(randomValues[1] ?? 0).toString(36)}`;
}

function getRequiredSorobanColumns(values: readonly number[]): number {
  const maxGameTotal = values.reduce((sum, value) => sum + value, 0);

  return Math.max(1, String(maxGameTotal).length);
}
