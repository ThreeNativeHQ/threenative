import type { ReactNode } from "react";
import { docPageForPath, docsGroups, docsNeighbours, docsPages } from "../../content/docs.js";
import { CopyButton } from "../code/CopyButton.js";
import { DocsSearch } from "./DocsSearch.js";
import { DocsToc, type IDocsTocItem, useActiveSection } from "./DocsToc.js";

export type { IDocsTocItem } from "./DocsToc.js";

export interface IDocsLayoutProps {
  readonly path: string;
  readonly toc?: readonly IDocsTocItem[];
  readonly sourceHref?: string;
  readonly children: ReactNode;
}

const EMPTY_TOC: readonly IDocsTocItem[] = [];

function DocsNavigation({ path }: { readonly path: string }) {
  return (
    <nav aria-label="Documentation">
      {docsGroups.map((group) => (
        <div className="mb-7" key={group}>
          <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-tn-fg-subtle">{group}</p>
          <div className="space-y-0.5">
            {docsPages.filter((page) => page.group === group).map((page) => (
              <a
                aria-current={page.path === path ? "page" : undefined}
                className={`block rounded-lg px-2.5 py-2 text-[14px] transition-colors ${page.path === path ? "bg-white/[0.06] font-medium text-tn-fg" : "text-tn-fg-muted hover:bg-white/[0.035] hover:text-tn-fg"}`}
                href={page.path}
                key={page.path}
              >{page.label}</a>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function Pager({ path }: { readonly path: string }) {
  const { previous, next } = docsNeighbours(path);
  return (
    <nav aria-label="Documentation pagination" className="mt-12 grid gap-3 border-t border-tn-border pt-8 sm:grid-cols-2">
      {previous ? (
        <a className="rounded-xl border border-tn-border bg-tn-surface/60 p-4 hover:border-white/20" href={previous.path}>
          <span className="text-[12px] uppercase tracking-[0.16em] text-tn-fg-subtle">Previous</span>
          <span className="mt-1 block text-[15px] font-medium text-tn-fg">← {previous.label}</span>
        </a>
      ) : <span />}
      {next ? (
        <a className="rounded-xl border border-tn-border bg-tn-surface/60 p-4 text-right hover:border-white/20" href={next.path}>
          <span className="text-[12px] uppercase tracking-[0.16em] text-tn-fg-subtle">Next</span>
          <span className="mt-1 block text-[15px] font-medium text-tn-fg">{next.label} →</span>
        </a>
      ) : <span />}
    </nav>
  );
}

export function DocsLayout({ path, toc = EMPTY_TOC, sourceHref, children }: IDocsLayoutProps) {
  const page = docPageForPath(path);
  const activeSection = useActiveSection(toc);
  if (page === undefined) throw new Error(`TN_SITE_DOCS_ROUTE: ${path} has no docs metadata.`);

  return (
    <div className={`mx-auto grid w-full max-w-[1536px] gap-8 px-5 py-8 lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-10 lg:px-8 lg:py-10 ${toc.length ? "xl:grid-cols-[210px_minmax(0,1fr)_190px]" : ""} xl:gap-12 2xl:px-[68px]`}>
      <aside className="min-w-0 lg:sticky lg:top-[96px] lg:max-h-[calc(100dvh_-_120px)] lg:self-start lg:overflow-y-auto">
        <a className="sr-only rounded-md p-2 text-tn-accent focus:not-sr-only" href="#docs-content">Skip to documentation content</a>
        <DocsSearch />
        <div className="hidden lg:block"><DocsNavigation path={page.path} /></div>
        <details className="rounded-lg border border-tn-border p-3 lg:hidden" data-testid="mobile-docs-navigation">
          <summary className="cursor-pointer text-[14px] font-medium text-tn-fg">Browse docs · {page.label}</summary>
          <div className="mt-5"><DocsNavigation path={page.path} /></div>
        </details>
      </aside>
      <article className="min-w-0 pb-16" id="docs-content" tabIndex={-1}>
        <div className="mx-auto max-w-[820px] xl:mx-0">
          <nav aria-label="Breadcrumb" className="mb-4 text-[13px] text-tn-fg-subtle">
            <ol className="flex items-center gap-2">
              <li><a className="hover:text-tn-fg" href="/docs">Docs</a></li>
              <li aria-hidden="true">/</li>
              <li aria-current="page">{page.label}</li>
            </ol>
          </nav>
          <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-tn-accent">{page.eyebrow}</p>
          <h1 className="mt-4 max-w-[760px] text-[36px] font-bold leading-[1.08] tracking-[-0.035em] text-tn-fg sm:text-[48px]">{page.title}</h1>
          <p className="mt-5 max-w-[720px] text-[18px] leading-8 text-tn-fg-muted">{page.summary}</p>
          {sourceHref ? (
            <a className="mt-5 inline-flex text-[13px] text-tn-fg-subtle underline underline-offset-4 hover:text-tn-fg" href={sourceHref} rel="noreferrer" target="_blank">View source evidence ↗</a>
          ) : null}
          {toc.length ? (
            <details className="mt-7 rounded-lg border border-tn-border p-4 xl:hidden">
              <summary className="cursor-pointer text-[13px] font-medium text-tn-fg">On this page</summary>
              <div className="mt-4"><DocsToc active={activeSection} items={toc} /></div>
            </details>
          ) : null}
          <div className="docs-copy mt-10 text-[16px] leading-7 text-tn-fg-muted">{children}</div>
          <a className="mt-8 inline-flex text-[13px] text-tn-fg-subtle underline underline-offset-4 hover:text-tn-fg" href={`https://github.com/ThreeNativeHQ/threenative/edit/develop/${page.sourceFile}`} rel="noreferrer" target="_blank">Edit this page on GitHub ↗</a>
          <Pager path={page.path} />
        </div>
      </article>
      {toc.length ? (
        <aside className="hidden min-w-0 xl:block">
          <div className="sticky top-[96px] max-h-[calc(100dvh_-_120px)] overflow-y-auto border-l border-tn-border pl-5">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-tn-fg-subtle">On this page</p>
            <DocsToc active={activeSection} items={toc} />
          </div>
        </aside>
      ) : null}
    </div>
  );
}

export function DocCodeBlock({ code, label = "code" }: { readonly code: string; readonly label?: string }) {
  return (
    <div className="my-6 overflow-hidden rounded-xl border border-tn-border bg-[#07090c]">
      <div className="flex items-center justify-between border-b border-tn-border px-4 py-2.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-tn-fg-subtle">{label}</span>
        <CopyButton label={label} text={code} />
      </div>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: code samples need keyboard access to horizontal scrolling. */}
      <pre aria-label={`${label} code sample`} className="overflow-x-auto p-4 font-mono text-[13px] leading-6 text-[#d8dee9]" tabIndex={0}><code>{code}</code></pre>
    </div>
  );
}

export function DocCallout({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <aside className="my-7 rounded-xl border border-tn-accent/20 bg-tn-accent/[0.055] p-5">
      <p className="text-[13px] font-semibold text-tn-accent">{title}</p>
      <div className="mt-2 text-[14px] leading-6 text-tn-fg-muted">{children}</div>
    </aside>
  );
}

export function DocSection({ id, title, children }: { readonly id: string; readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="scroll-mt-28 border-t border-tn-border/80 py-9 first:border-t-0 first:pt-0" id={id}>
      <h2 className="mb-4 text-[26px] font-semibold tracking-[-0.02em] text-tn-fg">
        <a className="group" href={`#${id}`}>{title}<span aria-hidden="true" className="ml-2 text-tn-accent opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">#</span></a>
      </h2>
      {children}
    </section>
  );
}
