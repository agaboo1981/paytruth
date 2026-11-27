import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from './utils';

type CardProps = HTMLAttributes<HTMLDivElement>;

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-md border border-border bg-surface shadow-panel transition-[border-color,transform] duration-base hover:border-[var(--accent)]',
        className,
      )}
      {...props}
    />
  );
});

export const CardHeader = forwardRef<HTMLDivElement, CardProps>(function CardHeader(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn('flex flex-col gap-1 border-b border-border px-5 py-4', className)}
      {...props}
    />
  );
});

export const CardBody = forwardRef<HTMLDivElement, CardProps>(function CardBody(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn('px-5 py-5', className)} {...props} />;
});

export const CardFooter = forwardRef<HTMLDivElement, CardProps>(function CardFooter(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn('flex flex-wrap items-center gap-3 border-t border-border px-5 py-4', className)}
      {...props}
    />
  );
});
