import { useEffect, useState } from 'react';

interface NumericDraftInputProps {
  value: number | undefined;
  min: number;
  max: number;
  step?: number;
  decimals?: number;
  allowEmpty?: boolean;
  placeholder?: string;
  onCommit: (next: number) => void;
  onCommitEmpty?: () => void;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

function formatNumericValue(
  value: number | undefined,
  decimals: number,
  allowEmpty: boolean,
  fallbackMin: number
): string {
  if (value === undefined || !Number.isFinite(value)) {
    return allowEmpty ? '' : formatNumericValue(fallbackMin, decimals, false, fallbackMin);
  }
  return Number(value.toFixed(decimals)).toString();
}

export function NumericDraftInput({
  value,
  min,
  max,
  step = 0.1,
  decimals = 1,
  allowEmpty = false,
  placeholder,
  onCommit,
  onCommitEmpty,
  className = '',
  ariaLabel,
  disabled = false,
}: NumericDraftInputProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(() => formatNumericValue(value, decimals, allowEmpty, min));

  useEffect(() => {
    if (!focused) {
      setDraft(formatNumericValue(value, decimals, allowEmpty, min));
    }
  }, [value, decimals, allowEmpty, min, focused]);

  const clampAndRound = (rawNum: number): number => {
    const safeMin = Math.min(min, max);
    const safeMax = Math.max(min, max);
    const clamped = Math.max(safeMin, Math.min(safeMax, rawNum));
    return Number(clamped.toFixed(decimals));
  };

  const commitDraft = (rawText: string) => {
    const normalized = rawText.replace(',', '.').trim();
    if (!normalized && allowEmpty) {
      setDraft('');
      if (value !== undefined) {
        onCommitEmpty?.();
      }
      return;
    }
    const parsed = Number(normalized);
    if (!normalized || !Number.isFinite(parsed)) {
      if (allowEmpty && value === undefined) {
        setDraft('');
      } else {
        const fallback = clampAndRound(value ?? min);
        setDraft(formatNumericValue(fallback, decimals, false, min));
      }
      return;
    }
    const next = clampAndRound(parsed);
    setDraft(formatNumericValue(next, decimals, false, min));
    if (
      value === undefined ||
      Math.abs(next - value) >= Math.pow(10, -(decimals + 1)) ||
      next !== value
    ) {
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
      placeholder={placeholder}
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
          setDraft(formatNumericValue(value, decimals, allowEmpty, min));
          e.currentTarget.blur();
        }
      }}
      className={className}
    />
  );
}
