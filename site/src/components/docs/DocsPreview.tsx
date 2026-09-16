import { docsPages } from "../../content/docs.js";

export function DocsPreview() {
  const featured = docsPages.filter((page) => page.path !== "/docs");
  return (
    <section className="border-t border-tn-border bg-tn-surface/25">
      <div className="mx-auto w-full max-w-[1536px] px-5 py-20 lg:px-[68px] lg:py-24">
        <div className="grid gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-end">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-tn-accent">Docs</p>
            <h2 className="mt-4 max-w-[520px] text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] text-tn-fg lg:text-[42px]">
              Understand the stack before you commit to it.
            </h2>
            <p className="mt-4 max-w-[540px] text-[16px] leading-7 text-tn-fg-muted">
              Start with the working path, compare the engine tradeoffs, then inspect the retained
              benchmark evidence instead of taking performance copy on faith.
            </p>
            <a
              className="mt-6 inline-flex text-[14px] font-medium text-tn-accent transition-opacity hover:opacity-80"
              href="/docs"
            >
              Open documentation →
            </a>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {featured.map((page) => (
              <a
                className="group min-h-[178px] rounded-xl border border-tn-border bg-tn-bg/55 p-5 transition-colors hover:border-white/20 hover:bg-tn-surface"
                href={page.path}
                key={page.path}
              >
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tn-fg-subtle">
                  {page.eyebrow}
                </span>
                <span className="mt-3 block text-[17px] font-semibold leading-6 text-tn-fg">
                  {page.label}
                </span>
                <span className="mt-2 block text-[13px] leading-5 text-tn-fg-subtle">
                  {page.summary}
                </span>
                <span className="mt-5 block text-[13px] font-medium text-tn-fg transition-transform group-hover:translate-x-0.5">
                  Read →
                </span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
