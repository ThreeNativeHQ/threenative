import { useEffect, useRef } from "react";
import { type INavEntry, navHref } from "../../content/nav.js";
import { useUiStore } from "../../store/ui.js";
import { Icon } from "../ui/Icon.js";

/**
 * A nav entry that opens a menu. Every item inside points somewhere real; the trigger itself is
 * a `pending` target, which is why it is a button and never a link.
 */
export function NavDropdown({ entry }: { readonly entry: INavEntry }) {
  const openMenu = useUiStore((state) => state.openMenu);
  const setOpenMenu = useUiStore((state) => state.setOpenMenu);
  const container = useRef<HTMLDivElement>(null);
  const open = openMenu === entry.label;

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpenMenu(undefined);
    };
    const onPointerDown = (event: MouseEvent): void => {
      if (!container.current?.contains(event.target as Node)) setOpenMenu(undefined);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, setOpenMenu]);

  return (
    <div className="relative" ref={container}>
      <button
        aria-expanded={open}
        aria-haspopup="true"
        className="flex items-center gap-1.5 rounded-md px-3 py-2 text-[15px] text-tn-fg/90 transition-colors hover:text-tn-fg"
        onClick={() => setOpenMenu(open ? undefined : entry.label)}
        type="button"
      >
        {entry.label}
        <Icon
          className={`h-3.5 w-3.5 text-tn-fg-subtle transition-transform ${open ? "rotate-180" : ""}`}
          name="chevronDown"
        />
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-50 mt-2 w-[320px] rounded-xl border border-tn-border bg-tn-surface p-2 shadow-2xl shadow-black/60">
          <ul>
            {(entry.items ?? []).map((item) => {
              const href = navHref(item.target);
              return (
                <li key={item.label}>
                  <a
                    className="flex flex-col gap-1 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/5"
                    href={href}
                    onClick={() => setOpenMenu(undefined)}
                    rel={item.target.kind === "external" ? "noreferrer" : undefined}
                    target={item.target.kind === "external" ? "_blank" : undefined}
                  >
                    <span className="text-[14px] font-semibold text-tn-fg">{item.label}</span>
                    <span className="text-[13px] leading-snug text-tn-fg-subtle">
                      {item.summary}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
