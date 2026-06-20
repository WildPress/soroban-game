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

export type NumberBoardMatchKind = 'none' | 'exact' | 'sum' | 'extension';

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

const defaultWidth = 10;
const defaultHeight = 10;
const defaultMaxAddends = 4;

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
    const extension = findCellCombination(remainingCells, target - highlightedSum, maxAddends - highlightedCells.length);

    if (extension) {
      return toPreview(
        state,
        target,
        [...highlightedCells.map((cell) => cell.id), ...extension.map((cell) => cell.id)],
        'extension'
      );
    }
  }

  const exact = activeCells.find((cell) => cell.value === target);

  if (exact) {
    return toPreview(state, target, [exact.id], 'exact');
  }

  const combination = findCellCombination(activeCells, target, maxAddends);

  if (combination) {
    return toPreview(state, target, combination.map((cell) => cell.id), 'sum');
  }

  return toPreview(state, target, [], 'none');
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

function findCellCombination(
  cells: readonly NumberBoardCell[],
  targetValue: number,
  maxAddends: number
): readonly NumberBoardCell[] | null {
  if (targetValue <= 0 || maxAddends <= 0) {
    return null;
  }

  const pathsBySum = new Map<number, readonly NumberBoardCell[]>([[0, []]]);

  for (const cell of cells) {
    const paths = [...pathsBySum.entries()];

    for (const [sum, path] of paths) {
      if (path.length >= maxAddends) {
        continue;
      }

      const nextSum = sum + cell.value;

      if (nextSum > targetValue || pathsBySum.has(nextSum)) {
        continue;
      }

      const nextPath = [...path, cell];

      if (nextSum === targetValue) {
        return nextPath;
      }

      pathsBySum.set(nextSum, nextPath);
    }
  }

  return null;
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
