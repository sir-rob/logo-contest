/**
 * Switch — a thin wrapper over Radix Switch, styled to the tokens.
 *
 * Used by the admin console for the contest-phase toggles. Radix gives it
 * `role="switch"`, `aria-checked` and full keyboard operation.
 *
 * State is carried by the thumb's POSITION as much as by the accent fill, so
 * it still reads with colour removed. Pair it with a `<Label htmlFor>` — the
 * component takes an `id` for exactly that.
 */

import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

export const Switch = forwardRef<
  ElementRef<typeof SwitchPrimitive.Root>,
  ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(function Switch({ className, ...rest }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border transition-colors',
        'border-line-strong bg-paper-sunken',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...rest}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block h-4 w-4 translate-x-1 rounded-full bg-paper-raised',
          'border border-line transition-transform',
          'data-[state=checked]:translate-x-5 data-[state=checked]:border-transparent',
        )}
      />
    </SwitchPrimitive.Root>
  );
});
