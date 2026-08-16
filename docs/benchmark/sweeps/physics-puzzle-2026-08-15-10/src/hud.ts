import type { IGameState } from "./state.js";

const STYLE = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #070b16; overflow: hidden;
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif; }
  canvas { display: block; }
  #hud { position: fixed; inset: 0; pointer-events: none; color: #eaf2ff; }
  .panel { position: absolute; background: rgba(8, 14, 28, 0.78);
    border: 1px solid rgba(126, 200, 255, 0.28); border-radius: 10px; padding: 14px 16px;
    backdrop-filter: blur(4px); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45); }
  #hud-left { top: 16px; left: 16px; width: 236px; }
  #hud-right { top: 16px; right: 16px; width: 214px; }
  h1 { font-size: 15px; margin: 0 0 2px; letter-spacing: 0.4px; }
  .sub { font-size: 10px; color: #8fa6c8; margin: 0 0 9px; text-transform: uppercase;
    letter-spacing: 1.3px; }
  .row { display: flex; justify-content: space-between; gap: 14px; font-size: 12px;
    line-height: 1.7; }
  .row span:first-child { color: #9db4d6; }
  .row span:last-child { font-variant-numeric: tabular-nums; font-weight: 600; }
  .legend { margin-top: 10px; font-size: 11px; color: #9db4d6; line-height: 1.6; }
  kbd { background: rgba(126, 200, 255, 0.16); border: 1px solid rgba(126, 200, 255, 0.35);
    border-radius: 4px; padding: 1px 6px; font-size: 11px; color: #dcecff; }
  .chip { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: 12px;
    font-weight: 700; letter-spacing: 0.4px; }
  .chip.playing { background: rgba(90, 160, 255, 0.2); color: #9ecbff; }
  .chip.won { background: rgba(123, 255, 154, 0.2); color: #7bff9a; }
  .chip.idle { background: rgba(150, 165, 190, 0.18); color: #b9c7dd; }
  .chip.running { background: rgba(255, 200, 90, 0.2); color: #ffd782; }
  .chip.complete { background: rgba(123, 255, 154, 0.2); color: #7bff9a; }
  .chip.fail { background: rgba(255, 110, 110, 0.22); color: #ff9e9e; }
  .banner { position: absolute; left: 50%; top: 42px; transform: translateX(-50%);
    font-size: 26px; font-weight: 800; letter-spacing: 2px; color: #7bff9a;
    text-shadow: 0 0 22px rgba(123, 255, 154, 0.55); display: none; }
  .banner.show { display: block; }
`;

export interface IHud {
  update(state: IGameState): void;
}

export function installHud(host: HTMLElement): IHud {
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);

  const hud = document.createElement("div");
  hud.id = "hud";
  hud.innerHTML = `
    <div class="panel" id="hud-left">
      <h1>Crate Vault</h1>
      <p class="sub">Physics puzzle &middot; seed <b id="hud-seed">-</b></p>
      <div class="row"><span>Mission</span><span id="hud-mission"></span></div>
      <div class="row"><span>Crates settled</span><span id="hud-settled">0 / 0</span></div>
      <div class="row"><span>Crates pushed</span><span id="hud-pushes">0</span></div>
      <div class="row"><span>Passed through</span><span id="hud-ghost">0</span></div>
      <div class="row"><span>Tick</span><span id="hud-tick">0</span></div>
      <p class="legend">
        <kbd>&#8594;</kbd> right &middot; <kbd>&#8593;</kbd> forward &middot;
        <kbd>&#8595;</kbd> back<br />
        <kbd>V</kbd> replay the run twice and compare<br />
        Solid crates block and shove. The glowing blue crates are walked straight through.
        Reach the cyan pad &mdash; on foot, or by shoving a crate onto it.
      </p>
    </div>
    <div class="panel" id="hud-right">
      <h1>Determinism</h1>
      <p class="sub">fixed step &middot; fixed seed</p>
      <div class="row"><span>Phase</span><span id="hud-phase"></span></div>
      <div class="row"><span>Runs match</span><span id="hud-match"></span></div>
      <div class="row"><span>Replayed ticks</span><span id="hud-rticks">0</span></div>
      <div class="row"><span>Run A</span><span id="hud-hash-a">-</span></div>
      <div class="row"><span>Run B</span><span id="hud-hash-b">-</span></div>
    </div>
    <div class="banner" id="hud-banner">PAD REACHED</div>
  `;
  host.appendChild(hud);

  const field = (id: string): HTMLElement => {
    const element = hud.querySelector<HTMLElement>(`#${id}`);
    if (element === null) throw new Error(`HUD field '${id}' is missing.`);
    return element;
  };

  const seed = field("hud-seed");
  const mission = field("hud-mission");
  const settled = field("hud-settled");
  const pushes = field("hud-pushes");
  const ghost = field("hud-ghost");
  const tick = field("hud-tick");
  const phase = field("hud-phase");
  const match = field("hud-match");
  const replayTicks = field("hud-rticks");
  const hashA = field("hud-hash-a");
  const hashB = field("hud-hash-b");
  const banner = field("hud-banner");

  return {
    update: (state) => {
      seed.textContent = String(state.seed);
      mission.innerHTML = chip(state.mission, state.mission);
      settled.textContent = `${state.settledCrates} / ${state.crateCount}`;
      pushes.textContent = String(state.pushEvents);
      ghost.textContent = String(state.ghostPasses);
      tick.textContent = String(state.tick);
      phase.innerHTML = chip(state.replayPhase, state.replayPhase);
      match.innerHTML =
        state.replayPhase === "complete"
          ? chip(state.replayMatch ? "identical" : "diverged", state.replayMatch ? "won" : "fail")
          : chip("pending", "idle");
      replayTicks.textContent = String(state.replayTicks);
      hashA.textContent = state.replayHashA === null ? "-" : hex(state.replayHashA);
      hashB.textContent = state.replayHashB === null ? "-" : hex(state.replayHashB);
      banner.classList.toggle("show", state.mission === "won");
    },
  };
}

function chip(label: string, tone: string): string {
  return `<span class="chip ${tone}">${label}</span>`;
}

function hex(value: number): string {
  return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}
