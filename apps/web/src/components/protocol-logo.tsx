import { safeResearchUrl } from '@harbor/data/research';
import { useState } from 'react';

/** A protocol or asset logo from the research snapshot's captured URL, or its initials on an ink tile. */
export function ProtocolLogo({
  name,
  fallback,
  className = 'size-8',
}: {
  name: string;
  fallback?: string | undefined;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = safeResearchUrl(fallback ?? '');
  const visible = Boolean(src && src !== failedSrc);
  return (
    <span
      aria-hidden="true"
      data-logo-name={name}
      data-logo-state={visible ? 'available' : 'missing'}
      className={`relative inline-grid shrink-0 place-items-center overflow-hidden border border-line align-middle font-serif text-[11px] font-bold uppercase ${visible ? 'bg-card' : 'bg-band text-band-foreground'} ${className}`}
    >
      {src && visible ? (
        <img
          src={src}
          alt=""
          className="absolute inset-0 size-full object-contain"
          loading="lazy"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        name.slice(0, 2)
      )}
    </span>
  );
}
