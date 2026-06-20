import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSorobanModel,
  createSorobanState,
  getColumnValue,
  getTotalValue,
  incrementColumn,
  applyBeadInteraction,
  serializeSoroban,
  setColumnValue,
  type JapaneseSorobanSpec
} from '../src/soroban.js';

test('creates a Japanese 1:4 soroban model for each column', () => {
  const specCheck = {
    upperBeads: 1,
    lowerBeads: 4
  } as const satisfies JapaneseSorobanSpec;
  const state = createSorobanState({ columns: 13 });
  const model = createSorobanModel(state);

  assert.deepEqual(specCheck, { upperBeads: 1, lowerBeads: 4 });
  assert.equal(model.config.upperBeads, 1);
  assert.equal(model.config.lowerBeads, 4);
  assert.equal(model.columns.length, 13);
  assert.equal(model.rods.length, 13);
  assert.equal(model.beads.length, 13 * 5);

  for (const column of model.columns) {
    const beads = model.beads.filter((bead) => bead.column === column.index);
    assert.equal(beads.filter((bead) => bead.section === 'upper').length, 1);
    assert.equal(beads.filter((bead) => bead.section === 'lower').length, 4);
  }
});

test('maps column values to upper and lower bead activation', () => {
  const state = createSorobanState({ columns: 3, values: [0, 5, 9] });
  const model = createSorobanModel(state);

  const first = model.beads.filter((bead) => bead.column === 0);
  const second = model.beads.filter((bead) => bead.column === 1);
  const third = model.beads.filter((bead) => bead.column === 2);

  assert.equal(first.filter((bead) => bead.active).length, 0);
  assert.equal(second.find((bead) => bead.section === 'upper')?.active, true);
  assert.equal(second.filter((bead) => bead.section === 'lower' && bead.active).length, 0);
  assert.equal(third.find((bead) => bead.section === 'upper')?.active, true);
  assert.equal(third.filter((bead) => bead.section === 'lower' && bead.active).length, 4);
});

test('updates column values without mutating the previous state', () => {
  const original = createSorobanState({ columns: 2 });
  const next = setColumnValue(original, 1, 7);

  assert.equal(getColumnValue(original, 1), 0);
  assert.equal(getColumnValue(next, 1), 7);
  assert.notEqual(original, next);
});

test('wraps incremental column input and reads the total value', () => {
  let state = createSorobanState({ columns: 4, values: [1, 2, 3, 9] });

  state = incrementColumn(state, 3, 1);
  state = incrementColumn(state, 0, -2);

  assert.equal(serializeSoroban(state), '9230');
  assert.equal(getTotalValue(state), 9230);
});

test('resizes columns from the high-place left side', () => {
  const smaller = createSorobanState({ columns: 5, values: [1, 2, 3, 4, 5, 6, 7] });
  const larger = createSorobanState({ columns: 8, values: smaller.values });

  assert.equal(serializeSoroban(smaller), '34567');
  assert.equal(serializeSoroban(larger), '00034567');
});

test('keeps geometry centered as column count changes', () => {
  const small = createSorobanModel(createSorobanState({ columns: 5 }));
  const large = createSorobanModel(createSorobanState({ columns: 17 }));

  assert.ok(large.frame.width > small.frame.width);
  assert.equal((small.frame.leftX + small.frame.rightX) / 2, 0);
  assert.equal((large.frame.leftX + large.frame.rightX) / 2, 0);
  assert.equal(small.columns[2]?.x, 0);
  assert.equal(large.columns[8]?.x, 0);
  assert.ok(large.frame.rightX > small.frame.rightX);
  assert.ok(large.frame.leftX < small.frame.leftX);
});

test('clicking an inactive lower bead pulls that bead and the beads above it up', () => {
  const state = createSorobanState({ columns: 1 });
  const next = applyBeadInteraction(state, {
    column: 0,
    section: 'lower',
    index: 1,
    intent: 'toggle'
  });

  assert.equal(getColumnValue(next, 0), 2);
});

test('clicking an active lower bead drops that bead and lower beads back down', () => {
  const state = createSorobanState({ columns: 1, values: [4] });
  const next = applyBeadInteraction(state, {
    column: 0,
    section: 'lower',
    index: 1,
    intent: 'toggle'
  });

  assert.equal(getColumnValue(next, 0), 1);
});

test('drag intents explicitly activate and deactivate lower bead groups', () => {
  let state = createSorobanState({ columns: 1 });

  state = applyBeadInteraction(state, {
    column: 0,
    section: 'lower',
    index: 2,
    intent: 'activate'
  });

  assert.equal(getColumnValue(state, 0), 3);

  state = applyBeadInteraction(state, {
    column: 0,
    section: 'lower',
    index: 1,
    intent: 'deactivate'
  });

  assert.equal(getColumnValue(state, 0), 1);
});

test('upper bead interaction toggles the five value independently of lower beads', () => {
  let state = createSorobanState({ columns: 1, values: [3] });

  state = applyBeadInteraction(state, {
    column: 0,
    section: 'upper',
    index: 0,
    intent: 'toggle'
  });

  assert.equal(getColumnValue(state, 0), 8);

  state = applyBeadInteraction(state, {
    column: 0,
    section: 'upper',
    index: 0,
    intent: 'deactivate'
  });

  assert.equal(getColumnValue(state, 0), 3);
});
