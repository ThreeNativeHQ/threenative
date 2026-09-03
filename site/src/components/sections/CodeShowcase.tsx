import { snippet } from "../../lib/snippets.js";
import { useUiStore } from "../../store/ui.js";
import { CodeBlock } from "../code/CodeBlock.js";
import { CodeTabs } from "../code/CodeTabs.js";
import { Card } from "../ui/Card.js";
import { Icon } from "../ui/Icon.js";
import { ShowcaseCard } from "./ShowcaseCard.js";

const BROWSE_API =
  "https://github.com/ThreeNativeHQ/threenative/blob/main/packages/create-threenative/capabilities.json";

/** The tabbed panel and the card beside it — the lower band of `REFERENCE.png`. */
export function CodeShowcase() {
  const codeTab = useUiStore((state) => state.codeTab);
  const active = snippet(codeTab);

  return (
    <section
      className="mx-auto w-full max-w-[1536px] px-5 pb-16 pt-8 lg:px-[68px] lg:pb-20 lg:pt-5"
      id="code"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.98fr)_minmax(0,1.02fr)]">
        <Card className="flex flex-col">
          <CodeTabs />
          <div className="min-h-[268px] flex-1">
            <CodeBlock language={active.language} source={active.source} />
          </div>
          <div className="border-t border-tn-border px-5 py-4">
            <a
              className="inline-flex items-center gap-2 text-[14px] font-medium text-tn-accent transition-opacity hover:opacity-80"
              href={BROWSE_API}
              rel="noreferrer"
              target="_blank"
            >
              Browse API
              <Icon className="h-4 w-4" name="arrowRight" />
            </a>
          </div>
        </Card>
        <ShowcaseCard />
      </div>
    </section>
  );
}
