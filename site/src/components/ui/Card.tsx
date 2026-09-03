import type { ReactNode } from "react";

/** The panel shape shared by the code showcase and the card beside it. */
export function Card({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={["overflow-hidden rounded-xl border border-tn-border bg-tn-surface", className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}
