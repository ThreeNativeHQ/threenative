import { useCallback, useEffect, useRef, useState } from "react";
import { searchDocs } from "../../content/docs.js";

/** Native modal semantics, local topic search, and an explicit keyboard loop. */
export function DocsSearch() {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const firstResult = useRef<HTMLAnchorElement>(null);
  const [query, setQuery] = useState("");
  const results = searchDocs(query);
  const open = useCallback(() => {
    if (dialog.current?.open) return;
    setQuery("");
    dialog.current?.showModal();
    input.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.isComposing || event.repeat || event.altKey || event.shiftKey) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (dialog.current?.open) dialog.current.close();
        else open();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="mb-6 flex w-full items-center justify-between gap-3 rounded-lg border border-tn-border bg-tn-surface px-3 py-2.5 text-left text-[13px] text-tn-fg-muted hover:border-tn-accent/50 hover:text-tn-fg"
        onClick={open}
        type="button"
      >
        Search docs
        <kbd className="text-[11px] text-tn-fg-subtle">Ctrl / ⌘ K</kbd>
      </button>
      <dialog
        aria-labelledby="docs-search-title"
        className="m-auto w-[calc(100%_-_2rem)] max-w-[640px] max-h-[85dvh] overflow-y-auto overscroll-contain rounded-2xl border border-tn-border bg-tn-bg p-5 text-tn-fg shadow-2xl backdrop:bg-black/70"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            // A search input can consume Escape to clear itself before the dialog cancels.
            event.preventDefault();
            event.currentTarget.close();
            return;
          }
          if (event.key !== "Tab") return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled])',
            ),
          ).filter((control) => control.getClientRects().length > 0);
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        ref={dialog}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-[18px] font-semibold" id="docs-search-title">Search documentation</h2>
          <button className="rounded-md border border-tn-border px-3 py-1.5 text-[13px]" onClick={() => dialog.current?.close()} type="button">Close</button>
        </div>
        <label className="sr-only" htmlFor="docs-search-input">Search documentation topics</label>
        <input
          autoComplete="off"
          className="w-full rounded-lg border border-tn-border bg-tn-surface px-4 py-3 text-[16px] outline-none focus:border-tn-accent"
          id="docs-search-input"
          maxLength={200}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" && firstResult.current) {
              event.preventDefault();
              firstResult.current.focus();
            }
            if (event.key === "Enter" && firstResult.current) {
              event.preventDefault();
              firstResult.current.click();
            }
          }}
          placeholder="Physics, Android, engine comparison…"
          ref={input}
          type="search"
          value={query}
        />
        <p className="mt-3 text-[12px] text-tn-fg-subtle" role="status">
          {results.length === 0 ? "No matching topics. Try a broader search." : `${results.length} documentation topics`}
        </p>
        <nav aria-label="Search results" className="mt-3 space-y-1">
          {results.map((page, index) => (
            <a className="block rounded-lg p-3 hover:bg-tn-surface focus:bg-tn-surface" href={page.path} key={page.path} ref={index === 0 ? firstResult : undefined}>
              <span className="text-[14px] font-medium">{page.label}</span>
              <span className="ml-2 text-[11px] text-tn-accent">{page.group}</span>
              <span className="mt-1 block text-[13px] leading-5 text-tn-fg-muted">{page.summary}</span>
            </a>
          ))}
        </nav>
        <p className="mt-4 text-[12px] text-tn-fg-subtle">Searches guide titles, summaries and topic keywords. Enter opens the first result; Escape closes.</p>
      </dialog>
    </>
  );
}
