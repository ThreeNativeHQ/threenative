import { type INavEntry, navHref, primaryNav, utilityNav } from "../../content/nav.js";
import { useUiStore } from "../../store/ui.js";
import { ButtonLink } from "../ui/Button.js";
import { Icon } from "../ui/Icon.js";
import { NavDropdown } from "./NavDropdown.js";

function PendingEntry({ entry }: { readonly entry: INavEntry }) {
  const reason = entry.target.kind === "pending" ? entry.target.reason : "";
  return (
    <span
      aria-disabled="true"
      className="cursor-default rounded-md px-3 py-2 text-[15px] text-tn-fg-subtle"
      title={reason}
    >
      {entry.label}
    </span>
  );
}

function PrimaryEntry({ entry }: { readonly entry: INavEntry }) {
  if (entry.items !== undefined && entry.items.length > 0) return <NavDropdown entry={entry} />;
  const href = navHref(entry.target);
  if (href === undefined) return <PendingEntry entry={entry} />;
  return (
    <a
      className="rounded-md px-3 py-2 text-[15px] text-tn-fg/90 transition-colors hover:text-tn-fg"
      href={href}
      rel={entry.target.kind === "external" ? "noreferrer" : undefined}
      target={entry.target.kind === "external" ? "_blank" : undefined}
    >
      {entry.label}
    </a>
  );
}

/** Logo, centre nav, utility cluster — the top strip of `REFERENCE.png`. */
export function SiteHeader() {
  const toggleMobileNav = useUiStore((state) => state.toggleMobileNav);
  const [search, source, cta] = utilityNav;

  return (
    <header className="sticky top-0 z-40 border-b border-tn-border/80 bg-tn-bg/95 backdrop-blur">
      <div className="mx-auto flex h-[68px] w-full max-w-[1600px] items-center px-5 lg:px-6">
        <a className="flex shrink-0 items-center gap-2.5" href="/">
          <Icon className="h-[30px] w-[30px] text-tn-accent" name="cube" strokeWidth={1.5} />
          <span className="text-[21px] font-semibold tracking-[-0.02em] text-tn-fg">
            ThreeNative
          </span>
        </a>

        <nav aria-label="Main" className="ml-10 hidden items-center gap-1 lg:flex">
          {primaryNav.map((entry) => (
            <PrimaryEntry entry={entry} key={entry.label} />
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-5 lg:flex">
          {search === undefined ? null : (
            <a
              aria-label={search.label}
              className="text-tn-fg-muted transition-colors hover:text-tn-fg"
              href={navHref(search.target)}
              rel="noreferrer"
              target="_blank"
              title={search.label}
            >
              <Icon className="h-[21px] w-[21px]" name="search" />
            </a>
          )}
          {source === undefined ? null : (
            <a
              className="text-[15px] text-tn-fg transition-colors hover:text-tn-fg-muted"
              href={navHref(source.target)}
              rel="noreferrer"
              target="_blank"
            >
              {source.label}
            </a>
          )}
          {cta === undefined ? null : (
            <ButtonLink href={navHref(cta.target)} size="sm" variant="accent">
              {cta.label}
            </ButtonLink>
          )}
        </div>

        <button
          aria-label="Open the navigation menu"
          className="ml-auto text-tn-fg lg:hidden"
          data-testid="mobile-nav-toggle"
          onClick={toggleMobileNav}
          type="button"
        >
          <Icon className="h-6 w-6" name="menu" />
        </button>
      </div>
    </header>
  );
}
