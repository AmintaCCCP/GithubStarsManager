import React, { useCallback, useRef } from 'react';

interface NumberInputProps {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  className?: string;
  allowUndefined?: boolean;
}

const INVALID_KEYS_INTEGER = new Set(['e', 'E', '+', '.']);
const INVALID_KEYS_FLOAT = new Set(['e', 'E', '+']);

export const NumberInput: React.FC<NumberInputProps> = ({
  value,
  onChange,
  min,
  max,
  step = 1,
  placeholder,
  className = '',
  allowUndefined = false,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const isInteger = step % 1 === 0;

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    const invalidKeys = isInteger ? INVALID_KEYS_INTEGER : INVALID_KEYS_FLOAT;
    if (invalidKeys.has(e.key)) {
      e.preventDefault();
      return;
    }
    if (min !== undefined && min >= 0 && e.key === '-') {
      e.preventDefault();
    }
  }, [min, isInteger]);

  const resolveFallback = useCallback((): number | undefined => {
    if (allowUndefined) return undefined;
    if (min !== undefined) return min;
    return 0;
  }, [allowUndefined, min]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === '') {
      onChange(resolveFallback());
      return;
    }
    if (raw === '-') {
      if (min !== undefined && min >= 0) {
        onChange(resolveFallback());
      }
      return;
    }
    const parsed = isInteger ? parseInt(raw, 10) : parseFloat(raw);
    if (isNaN(parsed)) return;
    const clamped = clamp(parsed, min, max);
    onChange(clamped);
  }, [onChange, min, max, resolveFallback, isInteger]);

  const handleBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === '' || raw === '-') {
      onChange(resolveFallback());
      return;
    }
    const parsed = isInteger ? parseInt(raw, 10) : parseFloat(raw);
    if (isNaN(parsed)) {
      onChange(resolveFallback());
      return;
    }
    const clamped = clamp(parsed, min, max);
    onChange(clamped);
  }, [onChange, min, max, resolveFallback, isInteger]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLInputElement>) => {
    e.preventDefault();
    (e.target as HTMLInputElement).blur();
  }, []);

  const displayValue = value !== undefined ? value : '';

  return (
    <input
      ref={inputRef}
      type="number"
      value={displayValue}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      className={`${baseInputClass} ${className}`}
    />
  );
};

function clamp(value: number, min?: number, max?: number): number {
  let result = value;
  if (min !== undefined) result = Math.max(min, result);
  if (max !== undefined) result = Math.min(max, result);
  return result;
}

const baseInputClass =
  'px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';
