export const STANDBY_SWITCH_MS = 9000;

export function shuffleClips(length, avoidIndex = -1) {
  const order = Array.from({ length }, (_, index) => index);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const swap = Math.floor(Math.random() * (i + 1));
    [order[i], order[swap]] = [order[swap], order[i]];
  }
  if (length > 1 && order[0] === avoidIndex) {
    const swap = 1 + Math.floor(Math.random() * (length - 1));
    [order[0], order[swap]] = [order[swap], order[0]];
  }
  return order;
}

export function nextStandby(order, position) {
  if (position + 1 < order.length) return { order, position: position + 1 };
  const avoid = order[position] ?? -1;
  return { order: shuffleClips(order.length, avoid), position: 0 };
}
