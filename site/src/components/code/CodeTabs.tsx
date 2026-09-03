import { snippets } from "../../lib/snippets.js";
import { type CodeTab, useUiStore } from "../../store/ui.js";
import { CopyButton } from "./CopyButton.js";

/** The tab strip from the reference: an accent underline on the active tab, copy button right. */
export function CodeTabs() {
  const codeTab = useUiStore((state) => state.codeTab);
  const setCodeTab = useUiStore((state) => state.setCodeTab);
  const active = snippets.find((item) => item.tab === codeTab) ?? snippets[0];

  return (
    <div className="flex items-center border-b border-tn-border bg-tn-surface-2 pr-2">
      <div className="flex" role="tablist">
        {snippets.map((item) => {
          const selected = item.tab === codeTab;
          return (
            <button
              aria-selected={selected}
              className={`border-b-2 px-6 py-3 text-[14px] transition-colors ${
                selected
                  ? "border-tn-accent text-tn-accent"
                  : "border-transparent text-tn-fg-muted hover:text-tn-fg"
              }`}
              data-testid={`code-tab-${item.tab}`}
              key={item.tab}
              onClick={() => setCodeTab(item.tab as CodeTab)}
              role="tab"
              type="button"
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {active === undefined ? null : (
        <CopyButton className="ml-auto" label={`the ${active.label} sample`} text={active.source} />
      )}
    </div>
  );
}
