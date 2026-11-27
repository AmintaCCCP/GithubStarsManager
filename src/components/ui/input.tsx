import * as React from 'react';
import { cn } from '../../lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      'field-surface flex h-control-lg w-full min-w-0 rounded-md px-2.5 py-1 text-base md:text-label text-foreground file:border-0 file:bg-transparent file:text-label file:font-medium placeholder:text-tertiary disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    ref={ref}
    {...props}
  />
));
Input.displayName = 'Input';

export { Input };
