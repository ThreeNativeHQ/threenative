import { claimText } from "../../content/claims.js";
import { features } from "../../content/features.js";
import { Icon } from "../ui/Icon.js";

/** The four-column band under the hero, with the reference's hairline dividers. */
export function FeatureRow() {
  return (
    <section className="border-y border-tn-border" id="features">
      <div className="mx-auto grid w-full max-w-[1536px] grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((feature, index) => (
          <div
            className={`flex gap-4 px-5 py-7 lg:py-[26px] ${
              index === 0
                ? "lg:pl-[68px] lg:pr-8"
                : "border-tn-border px-5 sm:odd:border-l lg:border-l lg:px-11"
            } ${index < 2 ? "" : "border-t border-tn-border sm:border-t lg:border-t-0"}`}
            key={feature.claimId}
          >
            <Icon className="mt-0.5 h-7 w-7 shrink-0 text-tn-accent" name={feature.icon} />
            <div>
              <h2 className="text-[15px] font-semibold text-tn-fg">{feature.title}</h2>
              <p className="mt-1.5 max-w-[248px] text-[13.5px] leading-[1.55] text-tn-fg-muted">
                {claimText(feature.claimId)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
