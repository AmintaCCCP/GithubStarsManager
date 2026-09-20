import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { buttonVariants } from './ui/button-variants';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger } from './ui/select';
import { Sheet, SheetContent, SheetTitle } from './ui/sheet';
import { Textarea } from './ui/textarea';

describe('mobile primitives', () => {
  it.each([
    ['default', 'h-11', 'sm:h-9'],
    ['sm', 'h-11', 'sm:h-8'],
    ['lg', 'h-11', 'sm:h-10'],
    ['icon', 'size-11', 'sm:size-9'],
  ] as const)('makes the %s button touch-safe before sm and restores its desktop size', (size, mobile, desktop) => {
    const classes = buttonVariants({ size });
    expect(classes).toContain(mobile);
    expect(classes).toContain(desktop);
  });

  it('keeps dialog content and its close control inside a compact viewport', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Dialog title</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole('dialog')).toHaveClass('w-[calc(100%_-_1rem)]', 'max-h-[calc(100dvh-2rem)]', 'overflow-y-auto', 'p-4', 'sm:w-full', 'sm:p-6');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass(
      'right-[calc(0.5rem+env(safe-area-inset-right))]',
      'top-[calc(0.5rem+env(safe-area-inset-top))]',
      'h-11',
      'w-11',
      'sm:h-auto',
      'sm:w-auto',
    );
  });

  it.each(['right', 'left', 'top', 'bottom'] as const)('keeps the %s sheet contained by the dynamic viewport', (side) => {
    render(
      <Sheet open>
        <SheetContent side={side}>
          <SheetTitle>Sheet title</SheetTitle>
        </SheetContent>
      </Sheet>,
    );

    expect(screen.getByRole('dialog')).toHaveClass(
      'max-w-[100vw]',
      'max-h-[100dvh]',
      'overflow-y-auto',
      'p-4',
      'pt-[calc(1rem+env(safe-area-inset-top))]',
      'sm:p-5',
    );
    if (side === 'right' || side === 'left') expect(screen.getByRole('dialog')).toHaveClass('h-[100dvh]');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('h-11', 'w-11', 'sm:h-auto', 'sm:w-auto');
  });

  it('uses touch-safe shared form and menu primitives before sm', () => {
    render(
      <>
        <Input aria-label="Input" />
        <Textarea aria-label="Textarea" />
        <Select open value="one">
          <SelectTrigger aria-label="Select" />
          <SelectContent>
            <SelectItem value="one">One</SelectItem>
          </SelectContent>
        </Select>
        <DropdownMenu open>
          <DropdownMenuTrigger>Trigger</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item</DropdownMenuItem>
            <DropdownMenuCheckboxItem checked>Checkbox</DropdownMenuCheckboxItem>
            <DropdownMenuRadioItem value="one">Radio</DropdownMenuRadioItem>
            <DropdownMenuSub open>
              <DropdownMenuSubTrigger>Subtrigger</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>Subcontent</DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </>,
    );

    expect(screen.getByLabelText('Input')).toHaveClass('h-11', 'text-base', 'sm:h-10', 'sm:text-sm');
    expect(screen.getByLabelText('Textarea')).toHaveClass('text-base', 'sm:text-sm');
    expect(screen.getByLabelText('Select')).toHaveClass('h-11', 'text-base', 'sm:h-10', 'sm:text-sm');
    expect(screen.getByRole('option', { name: 'One', hidden: true })).toHaveClass('min-h-11', 'sm:min-h-0', 'sm:text-sm');
    for (const item of screen.getAllByRole('menuitem', { hidden: true })) expect(item).toHaveClass('min-h-11', 'sm:min-h-0', 'sm:text-sm');
    expect(screen.getByRole('menuitemcheckbox', { hidden: true })).toHaveClass('min-h-11', 'sm:min-h-0', 'sm:text-sm');
    expect(screen.getByRole('menuitemradio', { hidden: true })).toHaveClass('min-h-11', 'sm:min-h-0', 'sm:text-sm');
    expect(screen.getByRole('listbox', { hidden: true })).toHaveClass('max-w-[calc(100dvw-1rem)]', 'max-h-[calc(100dvh-1rem)]', 'overflow-y-auto');
    for (const menu of screen.getAllByRole('menu', { hidden: true })) expect(menu).toHaveClass('max-w-[calc(100dvw-1rem)]', 'max-h-[calc(100dvh-1rem)]', 'overflow-y-auto');
  });

  it('keeps alert dialogs scrollable with full-width mobile actions', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Alert title</AlertDialogTitle>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );

    expect(screen.getByRole('alertdialog')).toHaveClass('max-h-[calc(100dvh-2rem)]', 'w-[calc(100%_-_2rem)]', 'max-w-md', 'overflow-y-auto', 'p-4', 'sm:p-6');
    expect(screen.getByText('Continue').parentElement).toHaveClass('[&>*]:w-full', 'sm:[&>*]:w-auto', 'sm:justify-end');
  });
});
