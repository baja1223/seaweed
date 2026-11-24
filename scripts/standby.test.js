import assert from "node:assert/strict";
import { nextStandby, shuffleClips, STANDBY_SWITCH_MS } from "../standby_playlist.js";

assert.ok(STANDBY_SWITCH_MS >= 8000 && STANDBY_SWITCH_MS <= 10000, `timer ${STANDBY_SWITCH_MS}`);

function assertPermutation(order, length) {
  assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length }, (_, index) => index));
}

for (let trial = 0; trial < 200; trial += 1) {
  const order = shuffleClips(6, 3);
  assertPermutation(order, 6);
  assert.notEqual(order[0], 3);
}

let state = { order: shuffleClips(6), position: 0 };
let previous = -1;
for (let step = 0; step < 40; step += 1) {
  const current = state.order[state.position];
  assert.notEqual(current, previous);
  assertPermutation(state.order, 6);
  previous = current;
  state = nextStandby(state.order, state.position);
}

const single = nextStandby([0], 0);
assert.deepEqual(single.order, [0]);
assert.equal(single.position, 0);

let token = 1;
let advances = 0;
const advance = (seen) => {
  if (seen !== token) return;
  token += 1;
  advances += 1;
};
advance(token);
advance(1);
assert.equal(advances, 1);

console.log("ok  standby clips shuffle without playing the same clip twice in a row");
