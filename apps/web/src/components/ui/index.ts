/**
 * The UI primitive layer.
 *
 * Screens import from `@/components/ui` and nothing deeper — the individual
 * module names are an implementation detail and are free to move.
 */

export { Button } from './button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './button';

export { CharCount, Field, Input, Label, Textarea } from './field';
export type { CharCountProps, FieldProps } from './field';

export { Divider, PageHeader, Panel, PanelHeader } from './panel';
export type { PageHeaderProps, PanelHeaderProps, PanelProps } from './panel';

export { Badge, EmptyState, Skeleton, Spinner, Stat } from './feedback';
export type { BadgeTone, EmptyStateProps, StatProps } from './feedback';

export { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

export { Switch } from './switch';

export { Countdown } from './countdown';
export type { CountdownProps } from './countdown';

export { ConfirmDialog } from './dialog';
export type { ConfirmDialogProps } from './dialog';

export { AccentToggle, useAccent } from './accent-toggle';
export type { Accent } from './accent-toggle';
