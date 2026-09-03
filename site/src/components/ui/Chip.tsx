import type { ReactNode } from "react";

/** One item of the hero's dotted row. The separator is drawn by the row, not by the chip. */
export function Chip({ children }: { readonly children: ReactNode }) {
  return <li className="text-[14px] text-tn-fg-muted">{children}</li>;
}

export function ChipRow({ children }: { readonly children: ReactNode }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-2 [&>li+li]:before:mr-3 [&>li+li]:before:text-tn-fg-subtle [&>li+li]:before:content-['•']">
      {children}
    </ul>
  );
}
