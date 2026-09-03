import { footerNav, navHref } from "../../content/nav.js";
import { Icon } from "../ui/Icon.js";

/** Reads the same nav model as the header, so a destination cannot exist in one and not the other. */
export function SiteFooter() {
  return (
    <footer className="border-t border-tn-border">
      <div className="mx-auto w-full max-w-[1536px] px-5 py-14 lg:px-[68px]">
        <div className="grid gap-10 md:grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,1fr))] lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
          <div>
            <div className="flex items-center gap-2.5">
              <Icon className="h-7 w-7 text-tn-accent" name="cube" strokeWidth={1.5} />
              <span className="text-[19px] font-semibold tracking-[-0.02em]">ThreeNative</span>
            </div>
            <p className="mt-4 max-w-[320px] text-[14px] leading-relaxed text-tn-fg-subtle">
              MIT licensed, in the open, on GitHub
            </p>
          </div>
          {footerNav
            .filter((entry) => entry.items !== undefined && entry.items.length > 0)
            .map((entry) => (
              <div key={entry.label}>
                <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-tn-fg-subtle">
                  {entry.label}
                </h2>
                <ul className="mt-4 flex flex-col gap-3">
                  {(entry.items ?? []).map((item) => (
                    <li key={item.label}>
                      <a
                        className="text-[14px] text-tn-fg-muted transition-colors hover:text-tn-fg"
                        href={navHref(item.target)}
                        rel={item.target.kind === "external" ? "noreferrer" : undefined}
                        target={item.target.kind === "external" ? "_blank" : undefined}
                      >
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      </div>
    </footer>
  );
}
