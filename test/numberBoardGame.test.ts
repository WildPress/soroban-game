import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commitNumberBoardSelection,
  createNumberBoard,
  getHighlightedCells,
  previewNumberBoardValue
} from '../src/numberBoardGame.js';

test('creates a 10 by 10 board from numbered cells', () => {
  const board = createNumberBoard(Array.from({ length: 100 }, (_, index) => index + 1));

  assert.equal(board.width, 10);
  assert.equal(board.height, 10);
  assert.equal(board.cells.length, 100);
  assert.deepEqual(board.cells[0], {
    id: 'cell-0-0',
    row: 0,
    column: 0,
    value: 1,
    status: 'active'
  });
  assert.deepEqual(board.cells[99], {
    id: 'cell-9-9',
    row: 9,
    column: 9,
    value: 100,
    status: 'active'
  });
});

test('highlights an exact active cell matching the soroban value', () => {
  const board = createNumberBoard(makeValues([13, 27, 3]));
  const preview = previewNumberBoardValue(board, 3);

  assert.equal(preview.kind, 'exact');
  assert.equal(preview.sum, 3);
  assert.deepEqual(getHighlightedCells(preview.state).map((cell) => cell.value), [3]);
});

test('extends an existing highlight when the soroban value increases by another board number', () => {
  const board = createNumberBoard(makeValues([13, 27, 3]));
  const firstPreview = previewNumberBoardValue(board, 3);
  const secondPreview = previewNumberBoardValue(firstPreview.state, 16);

  assert.equal(secondPreview.kind, 'extension');
  assert.equal(secondPreview.sum, 16);
  assert.deepEqual(getHighlightedCells(secondPreview.state).map((cell) => cell.value), [3, 13]);
});

test('go removes the highlighted cells only when their sum matches the current value', () => {
  const board = createNumberBoard(makeValues([13, 27, 3]));
  const preview = previewNumberBoardValue(previewNumberBoardValue(board, 3).state, 16);
  const commit = commitNumberBoardSelection(preview.state);

  assert.equal(commit.success, true);
  assert.deepEqual(commit.removedCellIds, ['cell-0-2', 'cell-0-0']);
  assert.deepEqual(
    commit.state.cells.filter((cell) => cell.status === 'removed').map((cell) => cell.value),
    [13, 3]
  );
  assert.deepEqual(commit.state.highlightedCellIds, []);
  assert.equal(commit.state.targetValue, 0);
});

test('removed cells are ignored by future previews', () => {
  const board = createNumberBoard(makeValues([13, 27, 3]));
  const committed = commitNumberBoardSelection(previewNumberBoardValue(board, 3).state).state;
  const preview = previewNumberBoardValue(committed, 3);

  assert.equal(preview.kind, 'none');
  assert.deepEqual(getHighlightedCells(preview.state), []);
});

test('falls back to a summed combination when no exact number exists', () => {
  const board = createNumberBoard(makeValues([7, 9, 27]));
  const preview = previewNumberBoardValue(board, 16);

  assert.equal(preview.kind, 'sum');
  assert.equal(preview.sum, 16);
  assert.deepEqual(getHighlightedCells(preview.state).map((cell) => cell.value), [7, 9]);
});

test('invalid go clears stale highlights without removing cells', () => {
  const board = createNumberBoard(makeValues([13, 27, 3]));
  const preview = previewNumberBoardValue(board, 3);
  const invalidState = {
    ...preview.state,
    targetValue: 4
  };
  const commit = commitNumberBoardSelection(invalidState);

  assert.equal(commit.success, false);
  assert.deepEqual(commit.removedCellIds, []);
  assert.equal(commit.state.cells.every((cell) => cell.status === 'active'), true);
  assert.deepEqual(commit.state.highlightedCellIds, []);
});

function makeValues(seedValues: readonly number[]): readonly number[] {
  return [
    ...seedValues,
    ...Array.from({ length: 100 - seedValues.length }, (_, index) => 1000 + index)
  ];
}
