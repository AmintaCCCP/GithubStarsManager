import React, { useCallback } from 'react';
import { Input } from './input';

interface BaseNumberInputProps {
  id?: string;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  className?: string;
  allowUndefined?: boolean;
}

interface ControlledNumberInputProps extends BaseNumberInputProps {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}

interface DraftNumberInputProps extends BaseNumberInputProps {
  /** Raw text shown while typing; commits are deferred to blur/Enter. */
  draftValue: string;
  onDraftChange: (raw: string) => void;
  /**
   * Receives the parsed-and-clamped integer, or null when the draft is empty
   * or unparsable. The parent decides the fallback value.
   */
  onDraftCommit: (parsed: number | null) => void;
}

export type NumberInputProps = ControlledNumberInputProps | DraftNumberInputProps;

function isDraftProps(props: NumberInputProps): props is DraftNumberInputProps {
  return (props as DraftNumberInputProps).draftValue !== undefined;
}

const INVALID_KEYS_INTEGER = new Set(['e', 'E', '+', '.']);
const INVALID_KEYS_FLOAT = new Set(['e', 'E', '+']);

export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>((props, ref) => {
  const { id, min, max, step = 1, placeholder, className = '', allowUndefined = false } = props;
  const draftMode = isDraftProps(props);
  const isInteger = step % 1 === 0;

  const clamp = useCallback((value: number): number => {
    let result = value;
    if (min !== undefined) result = Math.max(min, result);
    if (max !== undefined) result = Math.min(max, result);
    return result;
  }, [min, max]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (draftMode && e.key === 'Enter') {
      e.currentTarget.blur();
      return;
    }
    if (draftMode) return;
    const controlledProps = props as ControlledNumberInputProps;
    const invalidKeys = isInteger ? INVALID_KEYS_INTEGER : INVALID_KEYS_FLOAT;
    if (invalidKeys.has(e.key)) {
      e.preventDefault();
      return;
    }
    const effectiveMin = controlledProps.min;
    if (effectiveMin !== undefined && effectiveMin >= 0 && e.key === '-') {
      e.preventDefault();
    }
  }, [props, draftMode, isInteger]);

  const resolveFallback = useCallback((): number | undefined => {
    if (allowUndefined) return undefined;
    if (min !== undefined) return min;
    return 0;
  }, [allowUndefined, min]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (draftMode) {
      (props as DraftNumberInputProps).onDraftChange(e.target.value);
      return;
    }
    const controlledProps = props as ControlledNumberInputProps;
    const raw = e.target.value;
    if (raw === '') {
      controlledProps.onChange(resolveFallback());
      return;
    }
    if (raw === '-') {
      if (min !== undefined && min >= 0) {
        controlledProps.onChange(resolveFallback());
      }
      return;
    }
    const parsed = isInteger ? parseInt(raw, 10) : parseFloat(raw);
    if (isNaN(parsed)) return;
    controlledProps.onChange(clamp(parsed));
  }, [props, draftMode, min, resolveFallback, clamp, isInteger]);

  const handleBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    if (draftMode) {
      const draftProps = props as DraftNumberInputProps;
      const raw = e.target.value.trim();
      const numeric = Number(raw);
      const parsed = raw !== '' && Number.isInteger(numeric) ? numeric : null;
      draftProps.onDraftCommit(parsed === null ? null : clamp(parsed));
      return;
    }
    const controlledProps = props as ControlledNumberInputProps;
    const raw = e.target.value;
    if (raw === '' || raw === '-') {
      controlledProps.onChange(resolveFallback());
      return;
    }
    const parsed = isInteger ? parseInt(raw, 10) : parseFloat(raw);
    if (isNaN(parsed)) {
      controlledProps.onChange(resolveFallback());
      return;
    }
    controlledProps.onChange(clamp(parsed));
  }, [props, draftMode, resolveFallback, clamp, isInteger]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLInputElement>) => {
    e.currentTarget.blur();
  }, []);

  return (
    <Input
      ref={ref}
      id={id}
      type="number"
      value={draftMode ? (props as DraftNumberInputProps).draftValue : ((props as ControlledNumberInputProps).value !== undefined ? (props as ControlledNumberInputProps).value : '')}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      className={`[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${className}`}
    />
  );
});

NumberInput.displayName = 'NumberInput';
