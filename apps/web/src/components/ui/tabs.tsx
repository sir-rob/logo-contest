/**
 * Tabs — a thin wrapper over Radix Tabs, styled to the tokens.
 *
 * Radix owns the roving tab stop, arrow-key navigation and the
 * `aria-controls`/`aria-selected` wiring. This file only supplies the paint.
 *
 * The current tab is marked three ways — an accent underline (position),
 * darker ink (weight), and `data-state`/`aria-selected` (semantics) — so the
 * selection survives being read in greyscale.
 */

import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<
  ElementRef<typeof TabsPrimitive.List>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...rest }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn('inline-flex items-center gap-roomy border-b border-line', className)}
      {...rest}
    />
  );
});

export const TabsTrigger = forwardRef<
  ElementRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...rest }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        // -mb-px sits the active underline on top of the list's hairline
        // rather than below it.
        '-mb-px inline-flex items-center gap-tight whitespace-nowrap border-b-2 border-transparent pb-snug',
        'font-sans text-sm font-medium text-ink-muted transition-colors',
        'enabled:hover:text-ink',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=active]:border-accent data-[state=active]:text-ink',
        className,
      )}
      {...rest}
    />
  );
});

export const TabsContent = forwardRef<
  ElementRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...rest }, ref) {
  return <TabsPrimitive.Content ref={ref} className={cn('pt-base', className)} {...rest} />;
});
