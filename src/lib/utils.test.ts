import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('treats shadow-elev-* as a shadow size so a colour override keeps it', () => {
    // Regression: without the `shadow` theme scale these both collapse into the
    // shadow-colour group and `shadow-black` deleted the elevation entirely.
    expect(cn('shadow-elev-1', 'shadow-black')).toBe('shadow-elev-1 shadow-black');
    expect(cn('shadow-elev-1', 'shadow-none')).toBe('shadow-none');
  });
});
