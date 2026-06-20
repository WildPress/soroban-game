import { useCallback, useEffect, useRef, useState } from 'react';
import { createSorobanState, getTotalValue, type SorobanState } from './soroban.js';
import { PlayCanvasBoard } from './PlayCanvasBoard.js';
import type { BeadShapeStyle, ThemeName } from './playcanvasSoroban.js';
import {
  commitNumberBoardSelection,
  createNumberBoard,
  createUniquePairBoardValues,
  previewNumberBoardValue,
  type NumberBoardState
} from './numberBoardGame.js';

type StyleName = 'classic' | 'rounded' | 'sharp' | 'wide' | 'custom';
type StylePreset = Readonly<{
  label: string;
  beadShape: BeadShapeStyle;
}>;

const styleStorageKey = 'soroban-style';
const customStyleStorageKey = 'soroban-custom-style';
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
const boardValues = createInitialBoardValues();

export function App() {
  const [state, setState] = useState<SorobanState>(() => createSorobanState({ columns: 13 }));
  const [numberBoard, setNumberBoard] = useState<NumberBoardState>(() => createNumberBoard(boardValues, numberBoardDimensions));
  const [theme, setTheme] = useState<ThemeName>('walnut');
  const [styleName, setStyleNameState] = useState<StyleName>(() => getSavedStyleName());
  const [customStyle, setCustomStyleState] = useState<BeadShapeStyle>(() => getSavedCustomStyle());
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeBeadShape = styleName === 'custom' ? customStyle : stylePresets[styleName].beadShape;
  const sorobanValue = getTotalValue(state);

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

  useEffect(() => {
    setNumberBoard((currentBoard) => previewNumberBoardValue(currentBoard, sorobanValue).state);
  }, [sorobanValue]);

  const commitBoardSelection = useCallback(() => {
    setNumberBoard((currentBoard) => commitNumberBoardSelection(currentBoard).state);
  }, []);

  return (
    <main className="app-shell" aria-label="Soroban prototype">
      <section className="status-strip">
        <div>
          <span className="label">Columns</span>
          <input
            id="columns"
            type="number"
            min="1"
            max="21"
            value={state.config.columns}
            onChange={(event) => {
              const columns = Number(event.currentTarget.value);

              setState((currentState) => createSorobanState({
                columns,
                values: currentState.values
              }));
            }}
          />
        </div>
        <div>
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
        <div>
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
      </section>

      <section className="number-board-panel" aria-label="Number board">
        <div className="number-board-header">
          <div>
            <span className="label">Target</span>
            <strong id="board-target">{sorobanValue}</strong>
          </div>
          <button
            id="board-go"
            type="button"
            disabled={numberBoard.highlightedCellIds.length === 0}
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

      <PlayCanvasBoard
        state={state}
        theme={theme}
        beadShape={activeBeadShape}
        onCommitState={commitState}
        onInteractionStart={ensureAudioContext}
      />

      <section className="control-panel">
        <header>
          <h1>Soroban Prototype</h1>
          <div className="actions">
            <a className="button-link" href="http://127.0.0.1:5120/#./soroban-cad.jscad.js" target="_blank" rel="noreferrer">
              CAD Debug
            </a>
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
                commitState(createSorobanState({ columns: state.config.columns }));
              }}
            >
              Reset
            </button>
          </div>
        </header>
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

function createInitialBoardValues(): readonly number[] {
  return createUniquePairBoardValues(numberBoardDimensions.width * numberBoardDimensions.height, {
    seeds: [27, 4, 8, 60, 71, 3, 13]
  });
}
