import React, { useCallback } from 'react';

interface SliderInputProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  label?: string;
  marks?: number[];
  formatValue?: (value: number) => string;
}

export const SliderInput: React.FC<SliderInputProps> = ({
  value,
  onChange,
  min,
  max,
  step = 1,
  marks,
  formatValue,
}) => {
  const isInteger = step % 1 === 0;

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = isInteger ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
    if (!isNaN(newValue)) onChange(newValue);
  }, [onChange, isInteger]);

  const displayValue = formatValue ? formatValue(value) : value;
  const range = max - min;
  const markItems = marks || defaultMarks(min, max);

  return (
    <div className="w-full">
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleChange}
          className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
        />
        <span className="min-w-[2.5rem] text-center text-sm font-medium text-gray-900 dark:text-white tabular-nums">
          {displayValue}
        </span>
      </div>
      {markItems.length > 0 && (
        <div className="relative h-4 mt-1" style={{ marginLeft: 0, marginRight: 0 }}>
          {markItems.map((mark) => {
            const pct = range > 0 ? ((mark - min) / range) * 100 : 0;
            return (
              <span
                key={mark}
                className="absolute text-[10px] text-gray-400 dark:text-gray-500 -translate-x-1/2 tabular-nums"
                style={{ left: `${pct}%` }}
              >
                {formatValue ? formatValue(mark) : mark}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
};

function defaultMarks(min: number, max: number): number[] {
  if (max - min <= 10) {
    const marks: number[] = [];
    for (let i = min; i <= max; i++) marks.push(i);
    return marks;
  }
  const step = Math.ceil((max - min) / 4);
  const marks: number[] = [min];
  for (let v = min + step; v < max; v += step) marks.push(v);
  marks.push(max);
  return marks;
}
