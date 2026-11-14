import type { DataCard } from '@harbor/agent-runtime/events';

const ORDER: Record<DataCard['kind'], number> = { deposits: 0, borrow_markets: 1, yield_pools: 2 };

/**
 * The cards one answer shows, in reading order: what Harbor can act on first, then context. A tool the
 * model called twice shows once: its latest live reading, or one merged list of snapshot pools.
 */
export function arrangeCards(cards: readonly { cardId: string; card: DataCard }[]) {
  const latest = new Map<DataCard['kind'], { cardId: string; card: DataCard }>();
  for (const entry of cards) {
    const previous = latest.get(entry.card.kind);
    if (entry.card.kind === 'yield_pools' && previous?.card.kind === 'yield_pools') {
      const seen = new Set(previous.card.items.map((item) => `${item.project}|${item.chain}|${item.asset}`));
      const merged = [
        ...previous.card.items,
        ...entry.card.items.filter((item) => !seen.has(`${item.project}|${item.chain}|${item.asset}`)),
      ];
      latest.set('yield_pools', { cardId: previous.cardId, card: { ...previous.card, items: merged } });
    } else {
      latest.set(entry.card.kind, entry);
    }
  }
  return [...latest.values()].sort((a, b) => ORDER[a.card.kind] - ORDER[b.card.kind]);
}
