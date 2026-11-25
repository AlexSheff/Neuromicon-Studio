import { useEffect, useState } from 'react';

interface NumericDraftInputProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  decimals?: number;
  onCommit: (next: number) => void;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

function formatNumericValue(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number(value.toFixed(decimals)).toString();
}

export function NumericDraftInput({
  value,
  min,
  max,
  step = 0.1,
  decimals = 1,
  onCommit,
  className = '',
  ariaLabel,
  disabled = false,
}: NumericDraftInputProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(() => formatNumericValue(value, decimals));

  useEffect(() => {
    if (!focused) {
      setDraft(formatNumericValue(value, decimals));
    }
  }, [value, decimals, focused]);

  const clampAndRound = (rawNum: number): number => {
    const safeMin = Math.min(min, max);
    const safeMax = Math.max(min, max);
    const clamped = Math.max(safeMin, Math.min(safeMax, rawNum));
    return Number(clamped.toFixed(decimals));
  };

  const commitDraft = (rawText: string) => {
    const normalized = rawText.replace(',', '.').trim();
    const parsed = Number(normalized);
    if (!normalized || !Number.isFinite(parsed)) {
      const fallback = clampAndRound(value);
      setDraft(formatNumericValue(fallback, decimals));
      return;
    }
    const next = clampAndRound(parsed);
    setDraft(formatNumericValue(next, decimals));
    if (Math.abs(next - value) >= Math.pow(10, -(decimals + 1))) {
      onCommit(next);
    } else if (next !== value) {
      onCommit(next);
    }
  };

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      aria-label={ariaLabel}
      value={draft}
      onFocus={(e) => {
        setFocused(true);
        e.currentTarget.select();
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const normalized = raw.replace(',', '.').trim();
        if (
          !normalized ||
          normalized.endsWith('.') ||
          normalized === '-' ||
          normalized === '-.'
        ) {
          return;
        }
        const parsed = Number(normalized);
        if (!Number.isFinite(parsed)) return;
        const safeMin = Math.min(min, max);
        const safeMax = Math.max(min, max);
        if (parsed >= safeMin && parsed <= safeMax) {
          const rounded = Number(parsed.toFixed(decimals));
          onCommit(rounded);
        }
      }}
      onBlur={(e) => {
        setFocused(false);
        commitDraft(e.currentTarget.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commitDraft(e.currentTarget.value);
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setDraft(formatNumericValue(value, decimals));
          e.currentTarget.blur();
        }
      }}
      className={className}
    />
  );
}
