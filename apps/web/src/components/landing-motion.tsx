import { animate, motion, useInView, useReducedMotion } from 'motion/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { RollingNumber } from './motion.tsx';

/*
 * Stageshow motion for the landing page: things arrive (blur, rise, settle) as they scroll into
 * view, 60ms apart, on the arrive curve. Anything that travels a distance, like the page scrolling to
 * a section, uses the travel curve. Reduced motion gets the end state with a plain fade.
 */

export const ARRIVE = [0.25, 0.8, 0.25, 1] as const;
const TRAVEL = [0.45, 0, 0.1, 1] as const;
const STAGGER = 0.06;

/** Children arrive one after another the first time the group scrolls into view. */
export function RevealGroup({
  children,
  className = '',
  delay = 0,
  as = 'div',
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: 'div' | 'ol' | 'ul';
}) {
  const reduced = useReducedMotion();
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, margin: '0px 0px -12% 0px' }}
      variants={{
        hidden: {},
        shown: { transition: { staggerChildren: reduced ? 0 : STAGGER, delayChildren: delay } },
      }}
    >
      {children}
    </Tag>
  );
}

/** One item in a RevealGroup. */
export function RevealItem({
  children,
  className = '',
  as = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'li' | 'p' | 'h2' | 'figure';
}) {
  const reduced = useReducedMotion();
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      variants={{
        hidden: reduced ? { opacity: 0 } : { opacity: 0, y: 18, filter: 'blur(6px)' },
        shown: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.6, ease: ARRIVE } },
      }}
    >
      {children}
    </Tag>
  );
}

/** A headline whose words rise into place one at a time. Screen readers get the sentence once. */
export function WordsIn({ text, className = '', delay = 0 }: { text: string; className?: string; delay?: number }) {
  const reduced = useReducedMotion();
  const words = text.split(' ');
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {words.map((word, index) => (
          <motion.span
            // biome-ignore lint/suspicious/noArrayIndexKey: words repeat, and their order is the identity
            key={index}
            className="inline-block whitespace-pre"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: '0.35em', filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.7, ease: ARRIVE, delay: delay + index * STAGGER }}
          >
            {index < words.length - 1 ? `${word} ` : word}
          </motion.span>
        ))}
      </span>
    </span>
  );
}

/** A figure whose digits roll up from zero the first time it is seen. */
export function CountUp({ value, className = '', delay = 0 }: { value: string; className?: string; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true });
  const [shown, setShown] = useState(() => value.replace(/\d/g, '0'));
  useEffect(() => {
    if (!seen) return;
    const timer = window.setTimeout(() => setShown(value), delay);
    return () => window.clearTimeout(timer);
  }, [seen, value, delay]);
  return (
    <span ref={ref}>
      <RollingNumber value={shown} className={className} />
    </span>
  );
}

/**
 * Glides the page to a section instead of jumping. The duration grows with the distance, within
 * bounds, and a wheel or touch from the reader hands control straight back.
 */
export function scrollToSection(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const margin = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
  const to = Math.max(0, window.scrollY + target.getBoundingClientRect().top - margin);
  window.history.replaceState(null, '', `#${id}`);
  if (reduced) {
    window.scrollTo(0, to);
    target.focus({ preventScroll: true });
    return;
  }
  const distance = Math.abs(to - window.scrollY);
  const controls = animate(window.scrollY, to, {
    duration: Math.min(1.4, Math.max(0.7, distance / 1800)),
    ease: TRAVEL,
    onUpdate: (y) => window.scrollTo(0, y),
    onComplete: () => {
      stop();
      target.focus({ preventScroll: true });
    },
  });
  const interrupt = () => {
    controls.stop();
    stop();
  };
  function stop() {
    window.removeEventListener('wheel', interrupt);
    window.removeEventListener('touchstart', interrupt);
    window.removeEventListener('keydown', interrupt);
  }
  window.addEventListener('wheel', interrupt, { passive: true });
  window.addEventListener('touchstart', interrupt, { passive: true });
  window.addEventListener('keydown', interrupt);
}
