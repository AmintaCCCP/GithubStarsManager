import React, { useCallback, useRef } from 'react';
import { Minus, Plus } from 'lucide-react';

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

  const clamp = useCallback((v: number) => {
    let result = v;
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
      <button
        type="button"
        onMouseDown={() => canDecrement && startRepeat(-step)}
        onMouseUp={stopRepeat}
        onMouseLeave={stopRepeat}
        onTouchStart={() => canDecrement && startRepeat(-step)}
        onTouchEnd={stopRepeat}
        disabled={!canDecrement}
        className="flex items-center justify-center w-8 h-8 rounded-l-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <span className="flex items-center justify-center min-w-[2.5rem] h-8 px-2 border-t border-b border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-gray-900 dark:text-white tabular-nums select-none">
        {value}
      </span>
      <button
        type="button"
        onMouseDown={() => canIncrement && startRepeat(step)}
        onMouseUp={stopRepeat}
        onMouseLeave={stopRepeat}
        onTouchStart={() => canIncrement && startRepeat(step)}
        onTouchEnd={stopRepeat}
        disabled={!canIncrement}
        className="flex items-center justify-center w-8 h-8 rounded-r-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
