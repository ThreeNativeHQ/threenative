import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "accent" | "ghost" | "outline";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg text-[15px] font-semibold leading-none transition-colors";

const VARIANTS: Record<ButtonVariant, string> = {
  accent: "bg-tn-accent text-tn-accent-ink hover:bg-tn-accent/90",
  ghost: "text-tn-fg-muted hover:text-tn-fg",
  outline: "border border-tn-border text-tn-fg hover:border-tn-fg-subtle hover:bg-white/5",
};

const SIZES = { md: "h-[46px] px-6", sm: "h-[38px] px-4" } as const;

export interface IButtonProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly size?: keyof typeof SIZES;
  readonly variant?: ButtonVariant;
}

function classes(variant: ButtonVariant, size: keyof typeof SIZES, extra?: string): string {
  return [BASE, VARIANTS[variant], SIZES[size], extra].filter(Boolean).join(" ");
}

export function ButtonLink({
  children,
  className,
  size = "md",
  variant = "accent",
  ...rest
}: IButtonProps & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={classes(variant, size, className)} {...rest}>
      {children}
    </a>
  );
}

export function Button({
  children,
  className,
  size = "md",
  variant = "accent",
  ...rest
}: IButtonProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={classes(variant, size, className)} type="button" {...rest}>
      {children}
    </button>
  );
}
