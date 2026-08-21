import React, { useCallback, useRef } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from './button';

interface StepperInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}

export const StepperInput: React.FC<StepperInputProps> = ({
  value,
  onChange,
  min,
  max,
  step = 1,
  className = '',
}) => {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clamp = useCallback((nextValue: number) => {
    let result = nextValue;
    if (min !== undefined) result = Math.max(min, result);
    if (max !== undefined) result = Math.min(max, result);
    return result;
  }, [min, max]);

  const stepValue = useCallback((delta: number) => {
    onChange(clamp(value + delta));
  }, [value, onChange, clamp]);

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

  const canDecrement = min === undefined || value > min;
  const canIncrement = max === undefined || value < max;

  return (
    <div className={`inline-flex items-center ${className}`}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onMouseDown={() => canDecrement && startRepeat(-step)}
        onClick={(event) => {
          if (event.detail === 0 && canDecrement) stepValue(-step);
        }}
        onMouseUp={stopRepeat}
        onMouseLeave={stopRepeat}
        onTouchStart={() => canDecrement && startRepeat(-step)}
        onTouchEnd={stopRepeat}
        disabled={!canDecrement}
        aria-label="Decrease"
        className="h-8 w-8 rounded-r-none"
      >
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <span className="flex h-8 min-w-[2.5rem] select-none items-center justify-center border-y border-input bg-white px-2 text-sm font-medium tabular-nums text-foreground dark:border-input dark:bg-muted/40 dark:text-foreground">
        {value}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onMouseDown={() => canIncrement && startRepeat(step)}
        onClick={(event) => {
          if (event.detail === 0 && canIncrement) stepValue(step);
        }}
        onMouseUp={stopRepeat}
        onMouseLeave={stopRepeat}
        onTouchStart={() => canIncrement && startRepeat(step)}
        onTouchEnd={stopRepeat}
        disabled={!canIncrement}
        aria-label="Increase"
        className="h-8 w-8 rounded-l-none"
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
};
