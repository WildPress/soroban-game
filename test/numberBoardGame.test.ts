import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commitNumberBoardSelection,
  createNumberBoard,
  createSeededNumberBoardValues,
  createUniquePairBoardValues,
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

test('generated board values have unique pair sums and seeded addition examples', () => {
  const values = createUniquePairBoardValues(100, {
    seeds: [27, 4, 8, 60, 71, 3, 13]
  });

  assert.equal(values.length, 100);
  assert.deepEqual(values.slice(0, 7), [27, 4, 8, 60, 71, 3, 13]);
  assertUniquePairSums(values);
});

test('starter 3 by 3 board seed is deterministic', () => {
  const values = createSeededNumberBoardValues('starter-3x3-v1');

  assert.deepEqual(values, [27, 4, 8, 60, 71, 3, 13, 6, 42]);
  assert.notEqual(values, createSeededNumberBoardValues('starter-3x3-v1'));
});

test('isolated pair sums can still be matched directly', () => {
  const board = createNumberBoard(makeValues([43, 45]));
  const preview = previewNumberBoardValue(board, 88);

  assert.equal(preview.kind, 'sum');
  assert.deepEqual(getHighlightedCells(preview.state).map((cell) => cell.value), [43, 45]);
});

test('extension finds the only valid complement for an existing selection', () => {
  const board = createNumberBoard(makeValues([43, 45, 13, 4, 71]));
  const firstPreview = previewNumberBoardValue(board, 43);
  const secondPreview = previewNumberBoardValue(firstPreview.state, 88);

  assert.equal(secondPreview.kind, 'extension');
  assert.deepEqual(getHighlightedCells(secondPreview.state).map((cell) => cell.value), [43, 45]);
});

test('chains addition highlights as the soroban total grows', () => {
  const board = createNumberBoard(createUniquePairBoardValues(100, {
    seeds: [27, 4, 8, 60, 71, 3, 13]
  }));
  const firstPreview = previewNumberBoardValue(board, 27);
  const secondPreview = previewNumberBoardValue(firstPreview.state, 31);
  const thirdPreview = previewNumberBoardValue(secondPreview.state, 39);
  const fourthPreview = previewNumberBoardValue(thirdPreview.state, 99);
  const fifthPreview = previewNumberBoardValue(fourthPreview.state, 170);

  assert.equal(firstPreview.kind, 'exact');
  assert.deepEqual(getHighlightedCells(firstPreview.state).map((cell) => cell.value), [27]);
  assert.equal(secondPreview.kind, 'extension');
  assert.deepEqual(getHighlightedCells(secondPreview.state).map((cell) => cell.value), [27, 4]);
  assert.equal(thirdPreview.kind, 'extension');
  assert.deepEqual(getHighlightedCells(thirdPreview.state).map((cell) => cell.value), [27, 4, 8]);
  assert.equal(fourthPreview.kind, 'extension');
  assert.deepEqual(getHighlightedCells(fourthPreview.state).map((cell) => cell.value), [27, 4, 8, 60]);
  assert.equal(fifthPreview.kind, 'extension');
  assert.deepEqual(getHighlightedCells(fifthPreview.state).map((cell) => cell.value), [27, 4, 8, 60, 71]);
});

test('chain extension waits for one board number at a time', () => {
  const board = createNumberBoard(createUniquePairBoardValues(100, {
    seeds: [27, 4, 8, 60, 71, 3, 13]
  }));
  const partialChain = [27, 31, 39].reduce(
    (currentBoard, value) => previewNumberBoardValue(currentBoard, value).state,
    board
  );
  const preview = previewNumberBoardValue(partialChain, 170);

  assert.equal(preview.kind, 'none');
  assert.equal(preview.sum, 39);
  assert.deepEqual(getHighlightedCells(preview.state).map((cell) => cell.value), [27, 4, 8]);
});

test('keeps a partial chain through unresolved intermediate totals', () => {
  const board = createNumberBoard(createSeededNumberBoardValues('starter-3x3-v1'), { width: 3, height: 3 });
  const partialChain = [4, 12, 15].reduce(
    (currentBoard, value) => previewNumberBoardValue(currentBoard, value).state,
    board
  );
  const unresolvedPreview = previewNumberBoardValue(partialChain, 55);
  const completedPreview = previewNumberBoardValue(unresolvedPreview.state, 57);

  assert.equal(unresolvedPreview.kind, 'none');
  assert.equal(unresolvedPreview.sum, 15);
  assert.deepEqual(getHighlightedCells(unresolvedPreview.state).map((cell) => cell.value), [4, 8, 3]);
  assert.equal(completedPreview.kind, 'extension');
  assert.equal(completedPreview.sum, 57);
  assert.deepEqual(getHighlightedCells(completedPreview.state).map((cell) => cell.value), [4, 8, 3, 42]);
});

test('go can remove a completed addition chain', () => {
  const board = createNumberBoard(createUniquePairBoardValues(100, {
    seeds: [27, 4, 8, 60, 71, 3, 13]
  }));
  const preview = [27, 31, 39, 99, 170].reduce(
    (currentBoard, value) => previewNumberBoardValue(currentBoard, value).state,
    board
  );
  const commit = commitNumberBoardSelection(preview);

  assert.equal(commit.success, true);
  assert.deepEqual(
    commit.state.cells.filter((cell) => cell.status === 'removed').map((cell) => cell.value),
    [27, 4, 8, 60, 71]
  );
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

test('falls back to a unique summed combination when no exact number exists', () => {
  const board = createNumberBoard(makeValues([7, 9, 27]));
  const preview = previewNumberBoardValue(board, 16);

  assert.equal(preview.kind, 'sum');
  assert.equal(preview.sum, 16);
  assert.deepEqual(getHighlightedCells(preview.state).map((cell) => cell.value), [7, 9]);
});

test('does not highlight ambiguous summed combinations', () => {
  const board = createNumberBoard(makeValues([7, 9, 10, 6, 27]));
  const preview = previewNumberBoardValue(board, 16);

  assert.equal(preview.kind, 'ambiguous');
  assert.equal(preview.sum, 0);
  assert.deepEqual(getHighlightedCells(preview.state), []);
});

test('does not highlight chain collisions such as two different ways to make eighty eight', () => {
  const board = createNumberBoard(makeValues([43, 45, 13, 4, 71]));
  const preview = previewNumberBoardValue(board, 88);

  assert.equal(preview.kind, 'ambiguous');
  assert.equal(preview.sum, 0);
  assert.deepEqual(getHighlightedCells(preview.state), []);
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

function assertUniquePairSums(values: readonly number[]): void {
  const pairBySum = new Map<number, readonly [number, number]>();
  const valueSet = new Set(values);

  for (let leftIndex = 0; leftIndex < values.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < values.length; rightIndex += 1) {
      const left = values[leftIndex];
      const right = values[rightIndex];

      if (left === undefined || right === undefined) {
        throw new Error('Unexpected missing board value.');
      }

      const sum = left + right;
      const existingPair = pairBySum.get(sum);

      assert.equal(existingPair, undefined, `${left} + ${right} collides with ${existingPair?.join(' + ')}`);
      assert.equal(valueSet.has(sum), false, `${left} + ${right} collides with a single board value`);
      pairBySum.set(sum, [left, right]);
    }
  }
}
