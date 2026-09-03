import { claimText } from "../../content/claims.js";
import { Card } from "../ui/Card.js";
import { Icon } from "../ui/Icon.js";
import { HeroArt } from "./HeroArt.js";

const RUNTIME_DOC =
  "https://github.com/ThreeNativeHQ/threenative/blob/main/docs/architecture/NATIVE-RUNTIME.md";

/**
 * The reference puts a play button over a video still here. There is no recording to link, and a
 * play button over a still that plays nothing is a lie in a screenshot's clothing — so the card
 * ships with drawn art, no play affordance, and a link to something that exists. It gains the
 * player the day a real recording does.
 */
export function ShowcaseCard() {
  return (
    <Card className="grid grid-cols-1 md:grid-cols-[minmax(0,0.92fr)_minmax(0,1fr)]">
      <div className="relative min-h-[200px] overflow-hidden border-b border-tn-border md:min-h-full md:border-b-0 md:border-r">
        <HeroArt className="absolute inset-0 h-full w-full" />
      </div>
      <div className="flex flex-col justify-center gap-5 p-7 lg:p-9">
        <h2 className="text-[30px] font-semibold leading-[1.12] tracking-[-0.02em] lg:text-[34px]">
          Built for
          <br />
          modern 3D teams
        </h2>
        <p className="max-w-[380px] text-[15px] leading-relaxed text-tn-fg-muted">
          {claimText("showcase-body")}
        </p>
        <a
          className="inline-flex items-center gap-2 text-[14px] font-medium text-tn-accent transition-opacity hover:opacity-80"
          href={RUNTIME_DOC}
          rel="noreferrer"
          target="_blank"
        >
          How the runtime works
          <Icon className="h-4 w-4" name="arrowRight" />
        </a>
      </div>
    </Card>
  );
}
