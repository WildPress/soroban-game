export type NumberBoardCellStatus = 'active' | 'removed';

export type NumberBoardCell = Readonly<{
  id: string;
  row: number;
  column: number;
  value: number;
  status: NumberBoardCellStatus;
}>;

export type NumberBoardState = Readonly<{
  width: number;
  height: number;
  cells: readonly NumberBoardCell[];
  targetValue: number;
  highlightedCellIds: readonly string[];
}>;

export type NumberBoardMatchKind = 'none' | 'exact' | 'sum' | 'extension' | 'ambiguous';

export type NumberBoardPreview = Readonly<{
  state: NumberBoardState;
  kind: NumberBoardMatchKind;
  sum: number;
}>;

export type NumberBoardCommit = Readonly<{
  state: NumberBoardState;
  removedCellIds: readonly string[];
  success: boolean;
}>;

export type NumberBoardOptions = Readonly<{
  width?: number;
  height?: number;
  maxAddends?: number;
}>;

export type UniquePairBoardOptions = Readonly<{
  seeds?: readonly number[];
  minValue?: number;
}>;

const defaultWidth = 10;
const defaultHeight = 10;
const defaultMaxAddends = 5;

export function createNumberBoard(values: readonly number[], options: NumberBoardOptions = {}): NumberBoardState {
  const width = options.width ?? defaultWidth;
  const height = options.height ?? defaultHeight;

  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error('Number board dimensions must be positive integers.');
  }

  if (values.length !== width * height) {
    throw new Error(`Expected ${width * height} board values, received ${values.length}.`);
  }

  return {
    width,
    height,
    targetValue: 0,
    highlightedCellIds: [],
    cells: values.map((value, index) => {
      const row = Math.floor(index / width);
      const column = index % width;

      return {
        id: `cell-${row}-${column}`,
        row,
        column,
        value: normalizeBoardValue(value),
        status: 'active'
      };
    })
  };
}

export function previewNumberBoardValue(
  state: NumberBoardState,
  targetValue: number,
  options: NumberBoardOptions = {}
): NumberBoardPreview {
  const target = normalizeTargetValue(targetValue);
  const maxAddends = options.maxAddends ?? defaultMaxAddends;
  const activeCells = state.cells.filter((cell) => cell.status === 'active');
  const highlightedCells = getCellsById(activeCells, state.highlightedCellIds);

  if (target <= 0) {
    return toPreview(state, target, [], 'none');
  }

  const highlightedSum = sumCells(highlightedCells);

  if (highlightedCells.length > 0 && highlightedSum === target) {
    return toPreview(state, target, highlightedCells.map((cell) => cell.id), highlightedCells.length === 1 ? 'exact' : 'sum');
  }

  if (highlightedCells.length > 0 && highlightedSum < target) {
    const remainingCells = activeCells.filter((cell) => !state.highlightedCellIds.includes(cell.id));
    const extension = findUniqueCellCombination(remainingCells, target - highlightedSum, maxAddends - highlightedCells.length);

    if (extension.kind === 'unique') {
      return toPreview(
        state,
        target,
        [...highlightedCells.map((cell) => cell.id), ...extension.cells.map((cell) => cell.id)],
        'extension'
      );
    }

    if (extension.kind === 'ambiguous') {
      return toPreview(state, target, [], 'ambiguous');
    }
  }

  const exactMatches = activeCells.filter((cell) => cell.value === target);

  if (exactMatches.length === 1) {
    const exact = exactMatches[0];

    if (exact) {
      return toPreview(state, target, [exact.id], 'exact');
    }
  }

  if (exactMatches.length > 1) {
    return toPreview(state, target, [], 'ambiguous');
  }

  const combination = findUniqueCellCombination(activeCells, target, maxAddends);

  if (combination.kind === 'unique') {
    return toPreview(state, target, combination.cells.map((cell) => cell.id), 'sum');
  }

  if (combination.kind === 'ambiguous') {
    return toPreview(state, target, [], 'ambiguous');
  }

  return toPreview(state, target, [], 'none');
}

export function createUniquePairBoardValues(count: number, options: UniquePairBoardOptions = {}): readonly number[] {
  const values: number[] = [];
  const pairSums = new Set<number>();
  const blockedSingleValues = new Set<number>();
  const seeds = options.seeds ?? [];
  let candidate = options.minValue ?? 1;

  if (!Number.isInteger(count) || count <= 0) {
    throw new Error('Unique board count must be a positive integer.');
  }

  for (const seed of seeds) {
    addUniquePairValue(values, pairSums, blockedSingleValues, normalizeBoardValue(seed));
  }

  while (values.length < count) {
    if (canAddUniquePairValue(values, pairSums, blockedSingleValues, candidate)) {
      addUniquePairValue(values, pairSums, blockedSingleValues, candidate);
    }

    candidate += 1;
  }

  return values;
}

export function commitNumberBoardSelection(state: NumberBoardState): NumberBoardCommit {
  const highlightedCells = getCellsById(state.cells, state.highlightedCellIds)
    .filter((cell) => cell.status === 'active');
  const highlightedSum = sumCells(highlightedCells);

  if (highlightedCells.length === 0 || highlightedSum !== state.targetValue) {
    return {
      state: {
        ...state,
        highlightedCellIds: []
      },
      removedCellIds: [],
      success: false
    };
  }

  const removedCellIds = new Set(highlightedCells.map((cell) => cell.id));

  return {
    state: {
      ...state,
      highlightedCellIds: [],
      targetValue: 0,
      cells: state.cells.map((cell) => (
        removedCellIds.has(cell.id)
          ? { ...cell, status: 'removed' }
          : cell
      ))
    },
    removedCellIds: [...removedCellIds],
    success: true
  };
}

export function getHighlightedCells(state: NumberBoardState): readonly NumberBoardCell[] {
  return getCellsById(state.cells, state.highlightedCellIds);
}

function toPreview(
  state: NumberBoardState,
  targetValue: number,
  highlightedCellIds: readonly string[],
  kind: NumberBoardMatchKind
): NumberBoardPreview {
  const nextState = {
    ...state,
    targetValue,
    highlightedCellIds
  };

  return {
    state: nextState,
    kind,
    sum: sumCells(getHighlightedCells(nextState))
  };
}

type CellCombinationSearch = Readonly<
  | { kind: 'none'; cells: readonly [] }
  | { kind: 'unique'; cells: readonly NumberBoardCell[] }
  | { kind: 'ambiguous'; cells: readonly [] }
>;

function findUniqueCellCombination(
  cells: readonly NumberBoardCell[],
  targetValue: number,
  maxAddends: number
): CellCombinationSearch {
  if (targetValue <= 0 || maxAddends <= 0) {
    return { kind: 'none', cells: [] };
  }

  if (targetValue > getMaxPossibleSum(cells, maxAddends)) {
    return { kind: 'none', cells: [] };
  }

  const matches: NumberBoardCell[][] = [];

  findMatchingCellPaths(cells, targetValue, maxAddends, 0, 0, [], matches);

  if (matches.length === 0) {
    return { kind: 'none', cells: [] };
  }

  if (matches.length > 1) {
    return { kind: 'ambiguous', cells: [] };
  }

  return { kind: 'unique', cells: matches[0] ?? [] };
}

function getMaxPossibleSum(cells: readonly NumberBoardCell[], maxAddends: number): number {
  return [...cells]
    .sort((left, right) => right.value - left.value)
    .slice(0, maxAddends)
    .reduce((sum, cell) => sum + cell.value, 0);
}

function findMatchingCellPaths(
  cells: readonly NumberBoardCell[],
  targetValue: number,
  maxAddends: number,
  startIndex: number,
  currentSum: number,
  path: readonly NumberBoardCell[],
  matches: NumberBoardCell[][]
): void {
  if (matches.length > 1) {
    return;
  }

  if (currentSum === targetValue && path.length > 0) {
    matches.push([...path]);
    return;
  }

  if (path.length >= maxAddends || currentSum >= targetValue) {
    return;
  }

  for (let index = startIndex; index < cells.length; index += 1) {
    const cell = cells[index];

    if (!cell || currentSum + cell.value > targetValue) {
      continue;
    }

    findMatchingCellPaths(cells, targetValue, maxAddends, index + 1, currentSum + cell.value, [...path, cell], matches);
  }
}

function canAddUniquePairValue(
  values: readonly number[],
  pairSums: ReadonlySet<number>,
  blockedSingleValues: ReadonlySet<number>,
  value: number
): boolean {
  if (!Number.isInteger(value) || value < 1 || values.includes(value) || blockedSingleValues.has(value)) {
    return false;
  }

  for (const existingValue of values) {
    const sum = existingValue + value;

    if (pairSums.has(sum) || values.includes(sum)) {
      return false;
    }
  }

  return true;
}

function addUniquePairValue(
  values: number[],
  pairSums: Set<number>,
  blockedSingleValues: Set<number>,
  value: number
): void {
  if (!canAddUniquePairValue(values, pairSums, blockedSingleValues, value)) {
    throw new Error(`Value ${value} would create a pair-sum collision.`);
  }

  for (const existingValue of values) {
    const sum = existingValue + value;
    pairSums.add(sum);
    blockedSingleValues.add(sum);
  }

  values.push(value);
}

function getCellsById(cells: readonly NumberBoardCell[], ids: readonly string[]): readonly NumberBoardCell[] {
  const cellsById = new Map(cells.map((cell) => [cell.id, cell]));

  return ids
    .map((id) => cellsById.get(id))
    .filter((cell): cell is NumberBoardCell => cell !== undefined);
}

function sumCells(cells: readonly NumberBoardCell[]): number {
  return cells.reduce((sum, cell) => sum + cell.value, 0);
}

function normalizeBoardValue(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('Board values must be positive integers.');
  }

  return value;
}

function normalizeTargetValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}
