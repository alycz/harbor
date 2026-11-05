import { Check } from 'lucide-react';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import { AssetIcon } from './asset-icon.tsx';
import { RollingNumber, RollText } from './motion.tsx';
import { Chip } from './workspace.tsx';

/*
 * A Stageshow still that moves: Portfolio's activity as it will look once a wallet is connected.
 *
 * Story, in four beats over about eleven seconds: a swap arrives at the top of the list as Pending; the
 * receipt that you signed it slides in at the window's edge; the status rolls to Confirmed and the
 * received amount rolls in; the result holds, the receipt leaves, and the next swap arrives on top,
 * carrying the rows below it (a conveyor, so data never rewinds in view). Real words sit only on the
 * swap the story is about; older rows go quiet. The window sits whole inside the hero.
 * It is an illustration: hidden from assistive technology and labelled "Example" on screen.
 */

type Swap = { id: number; sell: string; sellAmount: string; buy: string; received: string };

const SWAPS: Omit<Swap, 'id'>[] = [
  { sell: 'NEAR', sellAmount: '10', buy: 'USDC', received: '24.38' },
  { sell: 'USDC', sellAmount: '250', buy: 'ETH', received: '0.0791' },
  { sell: 'SOL', sellAmount: '2.5', buy: 'NEAR', received: '163.21' },
  { sell: 'USDT', sellAmount: '120', buy: 'USDC.base', received: '119.94' },
];

const FIRST = { sell: 'NEAR', sellAmount: '10', buy: 'USDC', received: '24.38' };

const ARRIVE = [0.25, 0.8, 0.25, 1] as const;
const TRAVEL = [0.45, 0, 0.1, 1] as const;

type Phase = 'arriving' | 'signed' | 'confirmed' | 'leaving';

export function ActivityShowcase() {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref, { amount: 0.3 });
  const [count, setCount] = useState(1);
  // The poster: the payoff on screen, the receipt still beside it.
  const [phase, setPhase] = useState<Phase>('confirmed');

  useEffect(() => {
    if (reduced || !visible) return;
    const timers: number[] = [];
    const at = (ms: number, run: () => void) => timers.push(window.setTimeout(run, ms));
    function cycle() {
      setCount((value) => value + 1);
      setPhase('arriving');
      at(1700, () => setPhase('signed'));
      at(3600, () => setPhase('confirmed'));
      at(8200, () => setPhase('leaving'));
      at(9000, cycle);
    }
    at(2200, () => setPhase('leaving'));
    at(3000, cycle);
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [reduced, visible]);

  const rows: Swap[] = Array.from({ length: 4 }, (_, offset) => {
    const id = count - offset;
    const swap = SWAPS[((id % SWAPS.length) + SWAPS.length) % SWAPS.length] ?? FIRST;
    return { id, ...swap };
  });
  const top = rows[0] ?? { id: count, ...FIRST };
  const settled = phase === 'confirmed' || phase === 'leaving';

  return (
    <div ref={ref} aria-hidden="true" className="pointer-events-none relative select-none">
      {/* The window: a whole product card, set inside the hero. */}
      <div className="relative w-full max-w-[520px] overflow-hidden rounded-xl border border-white/10 bg-[var(--harbor-surface)] text-foreground shadow-[0_24px_60px_-20px_rgb(0_0_0/0.6)]">
        <div className="flex h-11 items-center gap-2 border-b border-border px-4">
          <span className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-[#e4e1da]" />
            <span className="size-2.5 rounded-full bg-[#e4e1da]" />
            <span className="size-2.5 rounded-full bg-[#e4e1da]" />
          </span>
          <span className="ml-3 text-[13px] font-medium">Activity</span>
          <Chip className="ml-auto mr-2" tone="neutral">
            Example
          </Chip>
        </div>
        <div className="flex gap-5 border-b border-border px-4">
          <span className="relative py-2.5 text-[12.5px] font-medium">
            Swaps
            <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-foreground" />
          </span>
          <span className="py-2.5 text-[12.5px] text-muted-foreground">Pending</span>
          <span className="py-2.5 text-[12.5px] text-muted-foreground">History</span>
        </div>
        <ul className="relative">
          <AnimatePresence initial={false}>
            {rows.map((row, index) => {
              const subject = index === 0;
              const status = subject && !settled ? 'Pending' : 'Confirmed';
              return (
                <motion.li
                  key={row.id}
                  layout={!reduced}
                  initial={reduced ? false : { opacity: 0, y: -14, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 64 }}
                  exit={{ opacity: 0, transition: { duration: 0.2 } }}
                  transition={{ duration: 0.62, ease: TRAVEL, opacity: { duration: 0.4, ease: ARRIVE, delay: 0.12 } }}
                  className="flex items-center gap-3 overflow-hidden border-b border-border/70 px-4"
                >
                  <span className="flex shrink-0 -space-x-2">
                    <span className="rounded-full bg-card p-px">
                      <AssetIcon symbol={row.sell} className="size-7" />
                    </span>
                    <span className="rounded-full bg-card p-px">
                      <AssetIcon symbol={row.buy} className="size-7" />
                    </span>
                  </span>
                  {subject ? (
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium">
                        Swap {row.sellAmount} {row.sell} to {row.buy}
                      </span>
                      <span className="block text-[12px] text-muted-foreground">NEAR Intents · just now</span>
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1 space-y-2">
                      <span className="block h-[7px] w-[52%] rounded-full bg-[#ece9e2]" />
                      <span className="block h-[6px] w-[30%] rounded-full bg-[#f1eee8]" />
                    </span>
                  )}
                  <span className="ws-num w-24 text-right text-[13.5px] font-medium">
                    {subject ? (
                      <AnimatePresence initial={false}>
                        {settled ? (
                          <motion.span
                            key="received"
                            className="text-success"
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.36, ease: ARRIVE, delay: 0.18 }}
                          >
                            +<RollingNumber value={row.received} />
                          </motion.span>
                        ) : null}
                      </AnimatePresence>
                    ) : (
                      <span className="ml-auto block h-[7px] w-14 rounded-full bg-[#ece9e2]" />
                    )}
                  </span>
                  <span className="w-[104px] shrink-0">
                    <Chip
                      tone={status === 'Pending' ? 'accent' : 'success'}
                      dot
                      className={subject ? '' : 'opacity-60'}
                    >
                      <RollText id={status}>{status}</RollText>
                    </Chip>
                  </span>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      </div>

      {/* The satellite: a receipt straddling the window's left edge, arriving at the beat it pays off. */}
      <AnimatePresence>
        {phase === 'signed' || phase === 'confirmed' ? (
          <motion.div
            key={`receipt-${top.id}`}
            initial={reduced ? false : { opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{
              opacity: 0,
              y: 28,
              transition: { y: { duration: 0.42, ease: TRAVEL }, opacity: { duration: 0.14, delay: 0.24 } },
            }}
            transition={{ y: { duration: 0.7, ease: ARRIVE }, opacity: { duration: 0.14 } }}
            className="absolute top-[226px] -left-7 z-10 w-[232px] rounded-xl border border-border bg-[var(--harbor-surface-raised)] p-3.5 text-foreground shadow-[0_18px_40px_-14px_rgb(0_0_0/0.55)]"
          >
            <p className="flex items-center gap-2 text-[12.5px] font-medium">
              <span className="grid size-5 place-items-center rounded-full bg-success/12 text-success">
                <Check className="size-3" strokeWidth={2.25} />
              </span>
              Signed in your wallet
            </p>
            <dl className="mt-3 space-y-1.5 text-[12px]">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">You send</dt>
                <dd className="ws-num font-medium">
                  {top.sellAmount} {top.sell}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Policy</dt>
                <dd className="font-medium">Within limits</dd>
              </div>
            </dl>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
