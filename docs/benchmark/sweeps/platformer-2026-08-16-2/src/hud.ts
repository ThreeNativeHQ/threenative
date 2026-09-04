import type { IGameState } from "./game.js";

const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; overflow: hidden; background: #4fa9ec; }
  #app { position: relative; width: 100vw; height: 100vh; }
  canvas { display: block; width: 100%; height: 100%; }
  #hud {
    position: absolute; inset: 0; pointer-events: none;
    font-family: "Baloo 2", "Trebuchet MS", "Segoe UI", sans-serif;
    font-weight: 800; color: #fff; letter-spacing: 0.4px;
    text-shadow: 0 3px 0 rgba(0,0,0,0.28), 0 0 12px rgba(0,0,0,0.18);
    user-select: none;
  }
  .corner { position: absolute; display: flex; flex-direction: column; gap: 10px; }
  .tl { top: 22px; left: 24px; }
  .tr { top: 22px; right: 24px; align-items: flex-end; }
  .bl { bottom: 22px; left: 24px; }
  .br { bottom: 22px; right: 24px; align-items: flex-end; }
  .row { display: flex; align-items: center; gap: 10px; }
  .pill {
    display: flex; align-items: center; gap: 10px;
    padding: 7px 16px 7px 8px; border-radius: 999px;
    background: rgba(18, 46, 78, 0.44);
    border: 2px solid rgba(255,255,255,0.28);
    backdrop-filter: blur(3px);
    font-size: 26px;
  }
  .avatar {
    width: 62px; height: 62px; border-radius: 50%;
    background: radial-gradient(circle at 38% 32%, #ffb05e 0%, #f08a2c 58%, #d2701c 100%);
    border: 4px solid #fff; box-shadow: 0 4px 0 rgba(0,0,0,0.25);
    display: grid; place-items: center; font-size: 30px;
  }
  .coin {
    width: 34px; height: 34px; border-radius: 50%;
    background: radial-gradient(circle at 36% 30%, #ffe375 0%, #f7c527 55%, #e08a12 100%);
    border: 3px solid #b96a08; display: grid; place-items: center;
    color: #b96a08; font-size: 18px; line-height: 1;
  }
  .hearts { display: flex; gap: 6px; font-size: 30px; filter: drop-shadow(0 3px 0 rgba(0,0,0,0.25)); }
  .heart-off { opacity: 0.28; filter: grayscale(1); }
  .objective {
    padding: 8px 18px; border-radius: 14px; font-size: 22px;
    background: rgba(18, 46, 78, 0.44); border: 2px solid rgba(255,255,255,0.28);
  }
  .prompt {
    display: flex; align-items: center; gap: 10px; font-size: 20px;
    padding: 6px 16px 6px 6px; border-radius: 999px;
    background: rgba(18, 46, 78, 0.40); border: 2px solid rgba(255,255,255,0.24);
  }
  .key {
    min-width: 40px; height: 34px; padding: 0 10px; border-radius: 10px;
    background: #f4f7fb; color: #17324f; display: grid; place-items: center;
    font-size: 16px; box-shadow: 0 3px 0 #9db2c6; text-shadow: none;
  }
  .key.round { border-radius: 50%; width: 34px; min-width: 34px; background: #6fe06a; color: #14421a; box-shadow: 0 3px 0 #3a9b3a; }
  #banner {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    text-align: center; font-size: 58px; padding: 26px 54px; border-radius: 26px;
    background: rgba(18, 46, 78, 0.58); border: 4px solid rgba(255,255,255,0.5);
    display: none;
  }
  #banner small { display: block; font-size: 22px; opacity: 0.9; margin-top: 10px; }
`;

export interface IHud {
  update: (state: IGameState) => void;
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
}

export function installHud(host: HTMLElement, total: number): IHud {
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);

  const hud = document.createElement("div");
  hud.id = "hud";
  hud.innerHTML = `
    <div class="corner tl">
      <div class="row">
        <div class="avatar">🦊</div>
        <div class="hearts" id="hearts"></div>
      </div>
      <div class="pill"><span class="coin">★</span><span id="coins">0</span> <span style="opacity:.7">/ ${total}</span></div>
    </div>
    <div class="corner tr">
      <div class="objective" id="objective">Collect the coins &amp; reach the flag</div>
      <div class="pill" style="padding-left:16px"><span id="timer">00:00.00</span></div>
    </div>
    <div class="corner bl">
      <div class="prompt"><span class="key">←</span><span class="key">→</span> RUN</div>
    </div>
    <div class="corner br">
      <div class="prompt"><span class="key round">A</span> SPACE — JUMP</div>
      <div class="prompt"><span class="key">R</span> RESTART</div>
    </div>
    <div id="banner"></div>
  `;
  host.append(hud);

  const coinsEl = hud.querySelector<HTMLElement>("#coins");
  const timerEl = hud.querySelector<HTMLElement>("#timer");
  const heartsEl = hud.querySelector<HTMLElement>("#hearts");
  const bannerEl = hud.querySelector<HTMLElement>("#banner");
  const objectiveEl = hud.querySelector<HTMLElement>("#objective");
  if (!coinsEl || !timerEl || !heartsEl || !bannerEl || !objectiveEl) {
    throw new Error("HUD failed to build its own nodes");
  }

  let lastHearts = -1;
  let lastBanner = "";

  return {
    update(state: IGameState): void {
      coinsEl.textContent = String(state.coins);
      timerEl.textContent = formatTime(state.elapsed);
      if (state.lives !== lastHearts) {
        lastHearts = state.lives;
        heartsEl.innerHTML = [0, 1, 2]
          .map((index) => `<span class="${index < state.lives ? "" : "heart-off"}">❤️</span>`)
          .join("");
      }
      const banner = state.goalReached
        ? `GOAL!<small>${state.coins} / ${total} coins · ${formatTime(state.elapsed)} · press R to play again</small>`
        : "";
      if (banner !== lastBanner) {
        lastBanner = banner;
        bannerEl.innerHTML = banner;
        bannerEl.style.display = banner ? "block" : "none";
        objectiveEl.textContent = state.goalReached
          ? "Stage cleared"
          : "Collect the coins & reach the flag";
      }
    },
  };
}
