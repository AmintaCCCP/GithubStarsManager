import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from './button';

interface StepperInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  decreaseLabel?: string;
  increaseLabel?: string;
}

export const StepperInput: React.FC<StepperInputProps> = ({
  value,
  onChange,
  min,
  max,
  step = 1,
  className = '',
  decreaseLabel = 'Decrease',
  increaseLabel = 'Increase',
}) => {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);

  useLayoutEffect(() => {
    valueRef.current = value;
  }, [value, onChange]);

  const clamp = useCallback((nextValue: number) => {
    let result = nextValue;
    if (min !== undefined) result = Math.max(min, result);
    if (max !== undefined) result = Math.min(max, result);
    return result;
  }, [min, max]);

  const stepValue = useCallback((delta: number) => {
    const nextValue = clamp(valueRef.current + delta);
    valueRef.current = nextValue;
    onChange(nextValue);
  }, [onChange, clamp]);

  const stopRepeat = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startRepeat = useCallback((delta: number) => {
    stopRepeat();
    stepValue(delta);
    timeoutRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => stepValue(delta), 120);
    }, 400);
  }, [stepValue, stopRepeat]);

  useEffect(() => stopRepeat, [stopRepeat]);

  const canDecrement = min === undefined || value > min;
  const canIncrement = max === undefined || value < max;

  return (
    <div className={`inline-flex items-center ${className}`}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onPointerDown={(event) => event.button === 0 && canDecrement && startRepeat(-step)}
        onClick={(event) => {
          if (event.detail === 0 && canDecrement) stepValue(-step);
        }}
        onPointerUp={stopRepeat}
        onPointerLeave={stopRepeat}
        onPointerCancel={stopRepeat}
        disabled={!canDecrement}
        aria-label={decreaseLabel}
        className="h-8 w-8 rounded-r-none"
      >
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <span className="flex h-8 min-w-[2.5rem] select-none items-center justify-center border-y border-input bg-card px-2 text-sm font-medium tabular-nums text-card-foreground">
        {value}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onPointerDown={(event) => event.button === 0 && canIncrement && startRepeat(step)}
        onClick={(event) => {
          if (event.detail === 0 && canIncrement) stepValue(step);
        }}
        onPointerUp={stopRepeat}
        onPointerLeave={stopRepeat}
        onPointerCancel={stopRepeat}
        disabled={!canIncrement}
        aria-label={increaseLabel}
        className="h-8 w-8 rounded-l-none"
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
};
