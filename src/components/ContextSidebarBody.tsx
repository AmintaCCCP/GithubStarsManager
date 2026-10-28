import * as React from 'react';
import { useScrollbarFlash } from '../hooks/useScrollbarFlash';
import { cn } from '../lib/utils';

type ContextSidebarBodyProps = React.HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'nav';
};

export const ContextSidebarBody: React.FC<ContextSidebarBodyProps> = ({
  as: Component = 'div',
  className,
  onScroll,
  children,
  ...props
}) => {
  const { isScrolling, handleScroll } = useScrollbarFlash(true);

  return (
    <Component
      className={cn(
        'context-sidebar-body scrollbar-on-scroll',
        isScrolling && 'scrolling',
        className,
      )}
      onScroll={(event) => {
        handleScroll();
        onScroll?.(event);
      }}
      {...props}
    >
      {children}
    </Component>
  );
};
