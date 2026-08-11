import type { IGame } from "@threenative/core";
import { useGameState } from "@threenative/ui";
import { Fragment } from "react";
import type { AbyssState } from "../scenes/Abyss.js";

const PLANKTON = 90_000;
const formatter = new Intl.NumberFormat("en-US");

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

const KEYS: readonly (readonly [string, string])[] = [
  ["move", "mouse, touch, or WASD / arrows"],
  ["pulse", "hold click or space — draws pearls in, burns lamp energy"],
  ["survive", "a new hunter joins every ten seconds"],
];

function Key({ children }: { children: string }) {
  return (
    <kbd className="whitespace-nowrap border border-line bg-hull px-2 py-0.5 font-[inherit] text-text">
      {children}
    </kbd>
  );
}

function Final({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.34em] text-dim">{label}</span>
      <b className="text-[30px] font-normal tabular-nums text-lume">{value}</b>
    </div>
  );
}

export function Veil({ game }: { game: IGame<AbyssState> }) {
  const { best, elapsed, score, status } = useGameState(game);
  if (status === "play") return null;
  const over = status === "over";

  return (
    <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(120%_90%_at_50%_45%,rgb(4_8_13_/_35%),rgb(4_8_13_/_94%)_70%)] p-6 backdrop-blur-[2px]">
      <div className="flex w-[min(560px,100%)] flex-col gap-[18px] border border-line bg-[linear-gradient(180deg,rgb(13_28_38_/_84%),rgb(7_17_25_/_92%))] p-card">
        {over ? (
          <>
            <div className="text-[10px] uppercase tracking-[0.34em] text-dim">
              the lamp goes dark
            </div>
            <h2 className="m-0 text-title-over font-normal uppercase leading-[0.9] tracking-[0.12em] text-lamp">
              Hull breached
            </h2>
            <p className="m-0 max-w-[52ch] font-lede text-[14.5px] normal-case leading-[1.65] tracking-normal text-text">
              The hunters found you. The plankton scatter, and the current takes what is left.
            </p>
            <div className="flex flex-wrap gap-x-[34px] border-t border-line pt-4">
              <Final label="pearls" value={formatter.format(score)} />
              <Final label="survived" value={clock(elapsed)} />
              <Final label="best" value={formatter.format(best)} />
            </div>
          </>
        ) : (
          <>
            <div className="text-[10px] uppercase tracking-[0.34em] text-dim">
              Three.js r185 · WebGPURenderer · {formatter.format(PLANKTON)} GPU-simulated particles
            </div>
            <h1 className="m-0 text-title font-normal uppercase leading-[0.86] tracking-[0.16em] text-balance text-lume [text-shadow:0_0_40px_rgb(111_232_255_/_25%)]">
              Abyss
            </h1>
            <p className="m-0 max-w-[52ch] font-lede text-[14.5px] normal-case leading-[1.65] tracking-normal text-text">
              You are an anglerfish lure in the midnight zone. Your lamp stirs a cloud of{" "}
              <em className="not-italic text-lume">bioluminescent plankton</em> — every one of them
              simulated in a TSL compute shader. Gather the{" "}
              <em className="not-italic text-lume">pearls</em> they cluster around. Avoid the{" "}
              <span className="text-hunter">hunters</span>, because a bright lamp tells them exactly
              where you are.
            </p>
            <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 border-y border-line py-4 text-[11px] uppercase tracking-[0.1em] text-dim">
              {KEYS.map(([key, description]) => (
                <Fragment key={key}>
                  <Key>{key}</Key>
                  <span className="self-center">{description}</span>
                </Fragment>
              ))}
            </div>
          </>
        )}
        <button
          className="motion-safe:transition-[background,transform] self-start border-0 bg-lume px-[26px] py-[15px] font-[inherit] text-xs uppercase tracking-[0.24em] text-ink duration-150 hover:bg-lume-bright active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-lamp"
          id="startBtn"
          onClick={() => globalThis.dispatchEvent(new CustomEvent("abyss:start"))}
          type="button"
        >
          {over ? "Dive again" : "Begin the dive"}
        </button>
      </div>
    </div>
  );
}
