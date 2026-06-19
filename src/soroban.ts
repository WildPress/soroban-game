export type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type BeadSection = 'upper' | 'lower';
export type BeadValue = 1 | 5;
export type BeadInteractionIntent = 'activate' | 'deactivate' | 'toggle';

export type JapaneseSorobanSpec = Readonly<{
  upperBeads: 1;
  lowerBeads: 4;
}>;

export type SorobanConfig = Readonly<
  JapaneseSorobanSpec & {
    columns: number;
    rodSpacing: number;
    beadWidth: number;
    beadHeight: number;
    beadDepth: number;
    beadStep: number;
    inactiveGap: number;
    upperRestY: number;
    upperActiveY: number;
    lowerActiveStartY: number;
    framePaddingX: number;
    frameTopY: number;
    frameBottomY: number;
    frameThickness: number;
    beamThickness: number;
  }
>;

export type SorobanOptions = Partial<Omit<SorobanConfig, 'upperBeads' | 'lowerBeads'>> & {
  values?: readonly number[];
};

export type SorobanState = Readonly<{
  config: SorobanConfig;
  values: readonly Digit[];
}>;

export type Vector3Value = Readonly<{
  x: number;
  y: number;
  z: number;
}>;

export type RodModel = Readonly<{
  id: string;
  column: number;
  position: Vector3Value;
  scale: Vector3Value;
}>;

export type BeadModel = Readonly<{
  id: string;
  column: number;
  section: BeadSection;
  index: number;
  active: boolean;
  value: BeadValue;
  position: Vector3Value;
  scale: Vector3Value;
}>;

export type ColumnModel = Readonly<{
  index: number;
  x: number;
  value: Digit;
}>;

export type SorobanModel = Readonly<{
  config: SorobanConfig;
  frame: Readonly<{
    width: number;
    height: number;
    leftX: number;
    rightX: number;
    topY: number;
    bottomY: number;
    beamY: 0;
    thickness: number;
    beamThickness: number;
  }>;
  columns: readonly ColumnModel[];
  rods: readonly RodModel[];
  beads: readonly BeadModel[];
}>;

export type BeadInteraction = Readonly<{
  column: number;
  section: BeadSection;
  index: number;
  intent: BeadInteractionIntent;
}>;

export const JAPANESE_SOROBAN_SPEC = {
  upperBeads: 1,
  lowerBeads: 4
} as const satisfies JapaneseSorobanSpec;

const DEFAULT_CONFIG = {
  ...JAPANESE_SOROBAN_SPEC,
  columns: 13,
  rodSpacing: 0.72,
  beadWidth: 0.46,
  beadHeight: 0.3,
  beadDepth: 0.24,
  beadStep: 0.36,
  inactiveGap: 0.54,
  upperRestY: 0.88,
  upperActiveY: 0.33,
  lowerActiveStartY: -0.28,
  framePaddingX: 0.52,
  frameTopY: 1.35,
  frameBottomY: -2.28,
  frameThickness: 0.14,
  beamThickness: 0.18
} as const satisfies SorobanConfig;

export function createSorobanState(options: SorobanOptions = {}): SorobanState {
  const config = normalizeConfig(options);
  const values = Array.isArray(options.values)
    ? options.values.slice(0, config.columns).map(toDigit)
    : [];

  while (values.length < config.columns) {
    values.push(0);
  }

  return {
    config,
    values
  };
}

export function createSorobanModel(state: SorobanState): SorobanModel {
  const config = normalizeConfig(state.config);
  const values = state.values.slice(0, config.columns).map(toDigit);
  const width = (config.columns - 1) * config.rodSpacing + config.framePaddingX * 2;
  const leftX = -width / 2;
  const rightX = width / 2;
  const height = config.frameTopY - config.frameBottomY;
  const columns: ColumnModel[] = [];
  const rods: RodModel[] = [];
  const beads: BeadModel[] = [];

  for (let column = 0; column < config.columns; column += 1) {
    const x = getColumnX(column, config);
    const value = values[column] ?? 0;
    const upperActive = value >= 5;
    const lowerActiveCount = value % 5;

    columns.push({
      index: column,
      x,
      value
    });

    rods.push({
      id: `rod-${column}`,
      column,
      position: { x, y: (config.frameTopY + config.frameBottomY) / 2, z: -0.05 },
      scale: { x: 0.035, y: height - config.frameThickness * 1.4, z: 0.035 }
    });

    beads.push({
      id: `upper-${column}-0`,
      column,
      section: 'upper',
      index: 0,
      active: upperActive,
      value: 5,
      position: { x, y: upperActive ? config.upperActiveY : config.upperRestY, z: 0.08 },
      scale: beadScale(config)
    });

    for (let index = 0; index < config.lowerBeads; index += 1) {
      const active = index < lowerActiveCount;
      const activeY = config.lowerActiveStartY - index * config.beadStep;
      const inactiveY = activeY - config.inactiveGap;

      beads.push({
        id: `lower-${column}-${index}`,
        column,
        section: 'lower',
        index,
        active,
        value: 1,
        position: { x, y: active ? activeY : inactiveY, z: 0.08 },
        scale: beadScale(config)
      });
    }
  }

  return {
    config,
    frame: {
      width,
      height,
      leftX,
      rightX,
      topY: config.frameTopY,
      bottomY: config.frameBottomY,
      beamY: 0,
      thickness: config.frameThickness,
      beamThickness: config.beamThickness
    },
    columns,
    rods,
    beads
  };
}

export function setColumnValue(state: SorobanState, column: number, value: number): SorobanState {
  assertColumn(state, column);

  const values = state.values.slice();
  values[column] = toDigit(value);

  return {
    config: state.config,
    values
  };
}

export function incrementColumn(state: SorobanState, column: number, delta = 1): SorobanState {
  assertColumn(state, column);

  return setColumnValue(state, column, wrapColumnValue((state.values[column] ?? 0) + delta));
}

export function applyBeadInteraction(state: SorobanState, interaction: BeadInteraction): SorobanState {
  assertColumn(state, interaction.column);
  assertBeadIndex(state, interaction.section, interaction.index);

  const currentValue = state.values[interaction.column] ?? 0;
  let upperActive = currentValue >= 5;
  let lowerActiveCount = currentValue % 5;

  if (interaction.section === 'upper') {
    upperActive = resolveUpperActive(upperActive, interaction.intent);
  } else {
    lowerActiveCount = resolveLowerActiveCount(lowerActiveCount, interaction.index, interaction.intent);
  }

  return setColumnValue(state, interaction.column, (upperActive ? 5 : 0) + lowerActiveCount);
}

export function getColumnValue(state: SorobanState, column: number): Digit {
  assertColumn(state, column);
  return state.values[column] ?? 0;
}

export function getTotalValue(state: SorobanState): number {
  return state.values.reduce<number>((total, value) => total * 10 + value, 0);
}

export function serializeSoroban(state: SorobanState): string {
  return state.values.map(String).join('');
}

function assertColumn(state: SorobanState, column: number): asserts column is number {
  if (!Number.isInteger(column) || column < 0 || column >= state.config.columns) {
    throw new RangeError(`Column ${column} is outside the soroban.`);
  }
}

function assertBeadIndex(state: SorobanState, section: BeadSection, index: number): void {
  const max = section === 'upper' ? state.config.upperBeads : state.config.lowerBeads;

  if (!Number.isInteger(index) || index < 0 || index >= max) {
    throw new RangeError(`${section} bead ${index} is outside the soroban.`);
  }
}

function resolveUpperActive(active: boolean, intent: BeadInteractionIntent): boolean {
  if (intent === 'activate') {
    return true;
  }

  if (intent === 'deactivate') {
    return false;
  }

  return !active;
}

function resolveLowerActiveCount(activeCount: number, index: number, intent: BeadInteractionIntent): number {
  if (intent === 'activate') {
    return index + 1;
  }

  if (intent === 'deactivate') {
    return Math.min(activeCount, index);
  }

  return index < activeCount ? index : index + 1;
}

function normalizeConfig(options: Partial<SorobanConfig> = {}): SorobanConfig {
  return {
    ...DEFAULT_CONFIG,
    ...options,
    columns: clampInteger(options.columns ?? DEFAULT_CONFIG.columns, 1, 21),
    upperBeads: 1,
    lowerBeads: 4
  };
}

function toDigit(value: number): Digit {
  return clampInteger(value, 0, 9) as Digit;
}

function wrapColumnValue(value: number): Digit {
  return (((value % 10) + 10) % 10) as Digit;
}

function clampInteger(value: number, min: number, max: number): number {
  const number = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : min;
  return Math.min(max, Math.max(min, number));
}

function getColumnX(column: number, config: SorobanConfig): number {
  return (column - (config.columns - 1) / 2) * config.rodSpacing;
}

function beadScale(config: SorobanConfig): Vector3Value {
  return {
    x: config.beadWidth,
    y: config.beadHeight,
    z: config.beadDepth
  };
}
