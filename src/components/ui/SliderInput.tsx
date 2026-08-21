import * as React from 'react';
import { Slider } from './slider';

interface SliderInputProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  label?: string;
  marks?: number[];
  formatValue?: (value: number) => string;
  showMarks?: boolean;
}

export const SliderInput: React.FC<SliderInputProps> = ({
  value,
  onChange,
  min,
  max,
  step = 1,
  marks,
  label,
  formatValue,
  showMarks = true,
}) => {
  const displayValue = formatValue ? formatValue(value) : value;
  const range = max - min;
  const markItems = marks || defaultMarks(min, max);

  return (
    <div className="w-full">
      <div className="flex items-center gap-3">
        <Slider
          min={min}
          max={max}
          step={step}
          value={value}
          onValueChange={onChange}
          thumbLabel={label}
          className="flex-1"
        />
        <span className="min-w-[2.5rem] text-center text-sm font-medium tabular-nums text-foreground dark:text-foreground">
          {displayValue}
        </span>
      </div>
      {showMarks && markItems.length > 0 && (
        <div className="relative mx-[-10px] mt-1 h-4 px-[10px]">
          {markItems.map((mark) => {
            const pct = range > 0 ? ((mark - min) / range) * 100 : 0;
            return (
              <span key={mark} className="absolute -translate-x-1/2 text-[10px] tabular-nums text-muted-foreground dark:text-muted-foreground" style={{ left: `${pct}%` }}>
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
  for (let value = min + step; value < max; value += step) marks.push(value);
  marks.push(max);
  return marks;
}
