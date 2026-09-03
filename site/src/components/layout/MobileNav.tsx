import { useEffect, useRef } from "react";
import { type INavEntry, navHref, primaryNav, utilityNav } from "../../content/nav.js";
import { useUiStore } from "../../store/ui.js";
import { Icon } from "../ui/Icon.js";

function entryHref(entry: INavEntry): string | undefined {
  return navHref(entry.target);
}

/**
 * Mounted beside the header, never inside it: the header's `backdrop-blur` makes it a containing
 * block for `position: fixed` descendants, which collapsed the drawer to the header's own 68px and
 * left it invisible on every phone. The Playwright drawer test is what caught that.
 *
 * It is a native `<dialog>` opened with `showModal()`, so the focus trap and the Escape key are the
 * browser's rather than a hand-rolled key handler's. The drawer reads the same nav model the
 * desktop header does: one model, three renderers.
 */
export function MobileNav() {
  const open = useUiStore((state) => state.mobileNavOpen);
  const close = useUiStore((state) => state.closeMobileNav);
  const panel = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = panel.current;
    if (!open || node === null) return undefined;
    if (!node.open) node.showModal();
    node.addEventListener("close", close);
    return () => node.removeEventListener("close", close);
  }, [open, close]);

  if (!open) return null;

  return (
    <dialog
      aria-label="Navigation"
      className="fixed inset-0 top-[68px] z-50 m-0 h-full max-h-none w-full max-w-none bg-tn-bg text-tn-fg backdrop:bg-black/60 lg:hidden"
      data-testid="mobile-nav"
      ref={panel}
    >
      <div className="flex items-center justify-end border-b border-tn-border px-5 py-3">
        <button aria-label="Close the navigation menu" onClick={close} type="button">
          <Icon className="h-6 w-6 text-tn-fg" name="close" />
        </button>
      </div>
      <nav className="overflow-y-auto px-5 py-6">
        <ul className="flex flex-col gap-1">
          {[...primaryNav, ...utilityNav].map((entry) => {
            const href = entryHref(entry);
            return (
              <li key={entry.label}>
                {href === undefined ? (
                  <span
                    aria-disabled="true"
                    className="block py-3 text-[17px] text-tn-fg-subtle"
                    title={entry.target.kind === "pending" ? entry.target.reason : undefined}
                  >
                    {entry.label}
                  </span>
                ) : (
                  <a className="block py-3 text-[17px] text-tn-fg" href={href} onClick={close}>
                    {entry.label}
                  </a>
                )}
                {entry.items === undefined ? null : (
                  <ul className="mb-2 flex flex-col gap-1 border-l border-tn-border pl-4">
                    {entry.items.map((item) => (
                      <li key={item.label}>
                        <a
                          className="block py-2 text-[15px] text-tn-fg-muted"
                          href={navHref(item.target)}
                          onClick={close}
                        >
                          {item.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </dialog>
  );
}
