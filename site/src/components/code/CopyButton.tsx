import { useEffect } from "react";
import { useUiStore } from "../../store/ui.js";
import { Icon } from "../ui/Icon.js";

export interface ICopyButtonProps {
  readonly className?: string;
  /** Named in the toast, so the confirmation says what landed on the clipboard. */
  readonly label: string;
  readonly text: string;
}

export function CopyButton({ className, label, text }: ICopyButtonProps) {
  const copy = useUiStore((state) => state.copy);
  return (
    <button
      aria-label={`Copy ${label}`}
      className={[
        "rounded-md p-1.5 text-tn-fg-subtle transition-colors hover:bg-white/5 hover:text-tn-fg",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid="copy-button"
      onClick={() => void copy(text, label)}
      type="button"
    >
      <Icon className="h-[18px] w-[18px]" name="copy" />
    </button>
  );
}

/** The confirmation the copy button raises. Mounted once, beside the route body. */
export function CopyToast() {
  const toast = useUiStore((state) => state.toast);
  const dismiss = useUiStore((state) => state.dismissToast);

  useEffect(() => {
    if (toast === undefined) return undefined;
    const timer = setTimeout(dismiss, 2400);
    return () => clearTimeout(timer);
  }, [toast, dismiss]);

  if (toast === undefined) return null;
  return (
    <output
      aria-live="polite"
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-tn-border bg-tn-surface-2 px-4 py-2.5 text-[14px] text-tn-fg shadow-2xl shadow-black/60"
      data-testid="copy-toast"
    >
      {toast}
    </output>
  );
}
