import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

const ARRIVE = [0.25, 0.8, 0.25, 1] as const;
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/**
 * A number whose digits roll to their new value, last digit first, the unchanged ones holding still
 * (Stageshow's Count). Columns are keyed from the right, so a value that grows a digit keeps the ones
 * it had. Screen readers get the plain value once.
 */
export function RollingNumber({ value, className = '' }: { value: string; className?: string }) {
  const chars = [...value];
  return (
    <span className={`ws-roll ${className}`}>
      <span className="sr-only">{value}</span>
      <span aria-hidden="true" className="contents">
        {chars.map((char, index) => {
          const fromEnd = chars.length - 1 - index;
          const digit = DIGITS.indexOf(char as (typeof DIGITS)[number]);
          if (digit === -1) {
            return (
              <span key={`s${fromEnd}`} className="ws-roll-static">
                {char}
              </span>
            );
          }
          return (
            <span key={`d${fromEnd}`} className="ws-roll-digit">
              <span
                className="ws-roll-column"
                style={{
                  transform: `translateY(-${digit * 10}%)`,
                  ['--ws-roll-delay' as string]: `${Math.min(fromEnd, 6) * 28}ms`,
                }}
              >
                {DIGITS.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}

/**
 * A word that changes rolls: the old one leaves upward as the new one rises into its place, and the
 * width eases so neighbours move with it. For status labels (Quoting, Live, Expired) that would
 * otherwise swap in one frame.
 */
export function RollText({ children, id, className = '' }: { children: ReactNode; id: string; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.span
      layout={!reduced}
      transition={{ layout: { duration: 0.32, ease: ARRIVE } }}
      className={`relative inline-flex overflow-hidden align-bottom ${className}`}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={id}
          className="inline-flex items-center gap-1.5 whitespace-nowrap"
          initial={reduced ? { opacity: 0 } : { y: '70%', opacity: 0, filter: 'blur(2px)' }}
          animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
          exit={reduced ? { opacity: 0 } : { y: '-70%', opacity: 0, filter: 'blur(2px)' }}
          transition={{ duration: 0.34, ease: ARRIVE }}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  );
}
