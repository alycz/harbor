import { Input } from '@harbor/ui/components/input';

/** A number input with its unit shown inside, on the right. */
export function UnitInput({
  id,
  unit,
  value,
  inputMode,
  disabled,
  onChange,
}: {
  id: string;
  unit: string;
  value: string;
  inputMode: 'decimal' | 'numeric';
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        className="h-10 pr-14"
        value={value}
        inputMode={inputMode}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value.trim())}
      />
      {unit ? (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[12.5px] text-muted-foreground">
          {unit}
        </span>
      ) : null}
    </div>
  );
}
