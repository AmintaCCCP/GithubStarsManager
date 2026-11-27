import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { cn } from '../../lib/utils';

type SliderRootProps = React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>;
type SliderProps = Omit<SliderRootProps, 'value' | 'defaultValue' | 'onValueChange' | 'onValueCommit'> & {
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  onValueCommit?: (value: number) => void;
  thumbLabel: string;
};

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  SliderProps
>(({ className, thumbLabel, value, defaultValue, onValueChange, onValueCommit, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn('relative flex w-full touch-none select-none items-center', className)}
    value={value === undefined ? undefined : [value]}
    defaultValue={defaultValue === undefined ? undefined : [defaultValue]}
    onValueChange={(values) => {
      const [nextValue] = values;
      if (nextValue !== undefined) onValueChange?.(nextValue);
    }}
    onValueCommit={(values) => {
      const [nextValue] = values;
      if (nextValue !== undefined) onValueCommit?.(nextValue);
    }}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-fill-pressed">
      <SliderPrimitive.Range className="absolute h-full bg-primary" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      aria-label={thumbLabel}
      className="block size-4 rounded-full border-2 border-primary bg-floating shadow-elev-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
    />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
