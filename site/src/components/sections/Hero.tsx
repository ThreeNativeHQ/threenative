import { useState } from "react";
import { claimText } from "../../content/claims.js";
import { installCommand } from "../../lib/snippets.js";
import { packageManagers, useUiStore } from "../../store/ui.js";
import { CopyButton } from "../code/CopyButton.js";
import { Button, ButtonLink } from "../ui/Button.js";
import { Chip, ChipRow } from "../ui/Chip.js";
import { Icon } from "../ui/Icon.js";
import { HeroArt } from "./HeroArt.js";

const CHIP_CLAIMS = ["chip-cross-platform", "chip-webgpu-first", "chip-open-source"];

function InstallPanel() {
  const manager = useUiStore((state) => state.packageManager);
  const setManager = useUiStore((state) => state.setPackageManager);
  const command = installCommand(manager);

  return (
    <div
      className="mt-5 max-w-[520px] overflow-hidden rounded-xl border border-tn-border bg-tn-surface"
      data-testid="install-panel"
    >
      <div className="flex items-center border-b border-tn-border bg-tn-surface-2 pr-1.5">
        {packageManagers.map((item) => (
          <button
            aria-pressed={item === manager}
            className={`border-b-2 px-4 py-2 text-[13px] transition-colors ${
              item === manager
                ? "border-tn-accent text-tn-accent"
                : "border-transparent text-tn-fg-muted hover:text-tn-fg"
            }`}
            data-testid={`package-manager-${item}`}
            key={item}
            onClick={() => setManager(item)}
            type="button"
          >
            {item}
          </button>
        ))}
        <CopyButton className="ml-auto" label="the install command" text={command} />
      </div>
      <pre
        className="overflow-x-auto px-5 py-4 font-mono text-[13.5px] leading-[1.7] text-[#c8ced6]"
        data-testid="install-command"
      >
        {command}
      </pre>
    </div>
  );
}

/** Headline, subhead, CTA pair, install reveal, chips, art. */
export function Hero() {
  const [showInstall, setShowInstall] = useState(false);

  return (
    <section className="relative isolate overflow-hidden" id="install">
      <HeroArt className="absolute inset-y-0 right-0 hidden h-full w-[58%] lg:block" />
      <div className="relative mx-auto w-full max-w-[1536px] px-5 pb-14 pt-12 lg:px-[68px] lg:pb-10 lg:pt-[62px]">
        <div className="max-w-[620px]">
          <h1 className="tn-rise max-w-[600px] text-[38px] font-bold leading-[1.08] tracking-[-0.028em] text-tn-fg sm:text-[46px] lg:text-[54px]">
            {claimText("hero-headline")}
          </h1>
          <p className="mt-5 max-w-[470px] text-[16px] leading-[1.62] text-tn-fg-muted lg:text-[17px]">
            {claimText("hero-subhead")}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Button
              aria-expanded={showInstall}
              data-testid="install-cta"
              onClick={() => setShowInstall((open) => !open)}
              variant="accent"
            >
              <Icon className="h-[18px] w-[18px]" name="terminal" strokeWidth={2} />
              Install via CLI
            </Button>
            <ButtonLink href="#features" variant="outline">
              Explore Features
            </ButtonLink>
          </div>
          {showInstall ? <InstallPanel /> : null}
          <div className="mt-8">
            <ChipRow>
              {CHIP_CLAIMS.map((id) => (
                <Chip key={id}>{claimText(id)}</Chip>
              ))}
            </ChipRow>
          </div>
        </div>
      </div>
      <HeroArt className="h-[240px] w-full lg:hidden" />
    </section>
  );
}
