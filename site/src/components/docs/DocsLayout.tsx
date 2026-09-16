import type { ReactNode } from "react";
import { docPageForPath, docsGroups, docsNeighbours, docsPages } from "../../content/docs.js";
import { CopyButton } from "../code/CopyButton.js";

export interface IDocsTocItem {
  readonly id: string;
  readonly label: string;
}

export interface IDocsLayoutProps {
  readonly path: string;
  readonly toc?: readonly IDocsTocItem[];
  readonly sourceHref?: string;
  readonly children: ReactNode;
}

function DocsNavigation({ path }: { readonly path: string }) {
  return (
    <nav aria-label="Documentation">
      {docsGroups.map((group) => (
        <div className="mb-7" key={group}>
          <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-tn-fg-subtle">
            {group}
          </p>
          <div className="space-y-0.5">
            {docsPages
              .filter((page) => page.group === group)
              .map((page) => {
                const active = page.path === path;
                return (
                  <a
                    aria-current={active ? "page" : undefined}
                    className={[
                      "block rounded-lg px-2.5 py-2 text-[14px] transition-colors",
                      active
                        ? "bg-white/[0.06] font-medium text-tn-fg"
                        : "text-tn-fg-muted hover:bg-white/[0.035] hover:text-tn-fg",
                    ].join(" ")}
                    href={page.path}
                    key={page.path}
                  >
                    {page.label}
                  </a>
                );
              })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function MobileDocsNavigation({ path }: { readonly path: string }) {
  return (
    <div className="border-b border-tn-border lg:hidden">
      <div className="mx-auto flex max-w-[1536px] gap-2 overflow-x-auto px-5 py-3">
        {docsPages.map((page) => (
          <a
            aria-current={page.path === path ? "page" : undefined}
            className={[
              "shrink-0 rounded-full border px-3 py-1.5 text-[13px] transition-colors",
              page.path === path
                ? "border-tn-accent/40 bg-tn-accent/10 text-tn-accent"
                : "border-tn-border text-tn-fg-muted hover:text-tn-fg",
            ].join(" ")}
            href={page.path}
            key={page.path}
          >
            {page.label}
          </a>
        ))}
      </div>
    </div>
  );
}

function Pager({ path }: { readonly path: string }) {
  const { previous, next } = docsNeighbours(path);
  if (previous === undefined && next === undefined) return null;
  return (
    <nav
      aria-label="Documentation pagination"
      className="mt-16 grid gap-3 border-t border-tn-border pt-8 sm:grid-cols-2"
    >
      {previous === undefined ? (
        <span />
      ) : (
        <a
          className="rounded-xl border border-tn-border bg-tn-surface/60 p-4 transition-colors hover:border-white/20"
          href={previous.path}
        >
          <span className="text-[12px] uppercase tracking-[0.16em] text-tn-fg-subtle">
            Previous
          </span>
          <span className="mt-1 block text-[15px] font-medium text-tn-fg">← {previous.label}</span>
        </a>
      )}
      {next === undefined ? (
        <span />
      ) : (
        <a
          className="rounded-xl border border-tn-border bg-tn-surface/60 p-4 text-right transition-colors hover:border-white/20"
          href={next.path}
        >
          <span className="text-[12px] uppercase tracking-[0.16em] text-tn-fg-subtle">Next</span>
          <span className="mt-1 block text-[15px] font-medium text-tn-fg">{next.label} →</span>
        </a>
      )}
    </nav>
  );
}

export function DocsLayout({ path, toc = [], sourceHref, children }: IDocsLayoutProps) {
  const page = docPageForPath(path);
  if (page === undefined) throw new Error(`TN_SITE_DOCS_ROUTE: ${path} has no docs metadata.`);

  return (
    <>
      <MobileDocsNavigation path={path} />
      <div className="mx-auto flex w-full max-w-[1536px] gap-10 px-5 py-10 lg:px-8 xl:gap-14 2xl:px-[68px]">
        <aside className="hidden w-[210px] shrink-0 lg:block">
          <div className="sticky top-[96px]">
            <DocsNavigation path={path} />
          </div>
        </aside>

        <article className="min-w-0 flex-1 pb-16">
          <div className="mx-auto max-w-[820px] xl:mx-0">
            <div className="mb-4 flex items-center gap-2 text-[13px] text-tn-fg-subtle">
              <a className="transition-colors hover:text-tn-fg" href="/docs">
                Docs
              </a>
              <span aria-hidden="true">/</span>
              <span>{page.label}</span>
            </div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-tn-accent">
              {page.eyebrow}
            </p>
            <h1 className="mt-4 max-w-[760px] text-[40px] font-bold leading-[1.04] tracking-[-0.035em] text-tn-fg sm:text-[50px]">
              {page.title}
            </h1>
            <p className="mt-5 max-w-[720px] text-[18px] leading-8 text-tn-fg-muted">
              {page.summary}
            </p>
            {sourceHref === undefined ? null : (
              <a
                className="mt-5 inline-flex text-[13px] font-medium text-tn-fg-subtle underline decoration-tn-border underline-offset-4 transition-colors hover:text-tn-fg"
                href={sourceHref}
                rel="noreferrer"
                target="_blank"
              >
                View source evidence ↗
              </a>
            )}

            <div className="docs-copy mt-12 text-[16px] leading-7 text-tn-fg-muted">{children}</div>
            <Pager path={path} />
          </div>
        </article>

        {toc.length === 0 ? null : (
          <aside className="hidden w-[190px] shrink-0 xl:block">
            <div className="sticky top-[96px] border-l border-tn-border pl-5">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-tn-fg-subtle">
                On this page
              </p>
              <nav aria-label="On this page" className="space-y-2">
                {toc.map((item) => (
                  <a
                    className="block text-[13px] leading-5 text-tn-fg-subtle transition-colors hover:text-tn-fg"
                    href={`#${item.id}`}
                    key={item.id}
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            </div>
          </aside>
        )}
      </div>
    </>
  );
}

export function DocCodeBlock({
  code,
  label = "code",
}: { readonly code: string; readonly label?: string }) {
  return (
    <div className="my-6 overflow-hidden rounded-xl border border-tn-border bg-[#07090c]">
      <div className="flex items-center justify-between border-b border-tn-border px-4 py-2.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-tn-fg-subtle">
          {label}
        </span>
        <CopyButton label={label} text={code} />
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-6 text-[#d8dee9]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function DocCallout({
  title,
  children,
}: { readonly title: string; readonly children: ReactNode }) {
  return (
    <aside className="my-7 rounded-xl border border-tn-accent/20 bg-tn-accent/[0.055] p-5">
      <p className="text-[13px] font-semibold text-tn-accent">{title}</p>
      <div className="mt-2 text-[14px] leading-6 text-tn-fg-muted">{children}</div>
    </aside>
  );
}

export function DocSection({
  id,
  title,
  children,
}: { readonly id: string; readonly title: string; readonly children: ReactNode }) {
  return (
    <section
      className="scroll-mt-28 border-t border-tn-border/80 py-9 first:border-t-0 first:pt-0"
      id={id}
    >
      <h2 className="mb-4 text-[26px] font-semibold tracking-[-0.02em] text-tn-fg">{title}</h2>
      {children}
    </section>
  );
}
