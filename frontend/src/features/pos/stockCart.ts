import type { CartLine } from './cart';

/**
 * The cart's lines after bringing one item down to `target` units in total (all its variants together): the most
 * recently added lines shrink first; lines that reach 0 are removed. Returns [lineId, newQuantity] (0 = remove).
 */
export function fitToStock(lines: Pick<CartLine, 'id' | 'productId' | 'quantity'>[], productId: string, target: number): [string, number][] {
  let over = lines.filter((l) => l.productId === productId).reduce((s, l) => s + l.quantity, 0) - Math.max(0, target);
  const changes: [string, number][] = [];
  for (let i = lines.length - 1; i >= 0 && over > 0; i--) {
    const line = lines[i]!;
    if (line.productId !== productId) continue;
    const cut = Math.min(line.quantity, over);
    changes.push([line.id, line.quantity - cut]);
    over -= cut;
  }
  return changes;
}
