export interface HudModel {
  score: number;
  health: number;
  ammo: number;
  reserve: number;
  targetsHit: number;
  timeRemaining: number;
  phase: "playing" | "complete" | "failed";
  locked: boolean;
  reloading: boolean;
  hitFlash: number;
}

const FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

function element(style: string, text = ""): HTMLDivElement {
  const node = document.createElement("div");
  node.style.cssText = style;
  node.textContent = text;
  return node;
}

export class Hud {
  private readonly score: HTMLDivElement;
  private readonly health: HTMLDivElement;
  private readonly time: HTMLDivElement;
  private readonly ammo: HTMLDivElement;
  private readonly objective: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private readonly marker: HTMLDivElement;

  constructor(root: HTMLElement) {
    const overlay = element(
      `position:fixed;inset:0;pointer-events:none;font-family:${FONT};` +
        "text-shadow:0 1px 3px rgba(0,0,0,0.55);user-select:none;",
    );

    this.score = element(
      "position:absolute;left:14px;top:14px;color:#ffffff;font-size:27px;font-weight:700;letter-spacing:0.5px;",
      "SCORE 0000",
    );
    this.health = element(
      "position:absolute;left:16px;top:48px;color:#43dd6f;font-size:16px;font-weight:700;letter-spacing:0.5px;",
      "HEALTH 100",
    );
    this.time = element(
      "position:absolute;right:14px;top:14px;color:#ffa32a;font-size:24px;font-weight:700;letter-spacing:0.5px;",
      "TIME 60",
    );
    this.ammo = element(
      "position:absolute;right:14px;top:64%;color:#ffffff;font-size:27px;font-weight:700;letter-spacing:0.5px;",
      "30 / 90",
    );
    this.objective = element(
      "position:absolute;left:0;right:0;top:84px;text-align:center;color:#ffffff;font-size:16px;font-weight:700;letter-spacing:1.1px;",
      "CLICK TO LOCK · HIT 12 TARGETS",
    );
    this.banner = element(
      "position:absolute;left:0;right:0;top:46%;text-align:center;color:#ffffff;font-size:38px;font-weight:700;letter-spacing:2px;display:none;",
    );

    const crosshair = element(
      "position:absolute;left:50%;top:50%;width:15px;height:15px;transform:translate(-50%,-50%);",
    );
    crosshair.innerHTML =
      '<div style="position:absolute;left:7px;top:0;width:1.5px;height:15px;background:#ffffff;"></div>' +
      '<div style="position:absolute;top:7px;left:0;height:1.5px;width:15px;background:#ffffff;"></div>';
    this.marker = element(
      "position:absolute;left:50%;top:50%;width:26px;height:26px;transform:translate(-50%,-50%) rotate(45deg);opacity:0;",
    );
    this.marker.innerHTML =
      '<div style="position:absolute;left:12px;top:0;width:2px;height:26px;background:#ff5a4d;"></div>' +
      '<div style="position:absolute;top:12px;left:0;height:2px;width:26px;background:#ff5a4d;"></div>';

    const legend = element(
      "position:absolute;left:14px;bottom:14px;background:rgba(12,14,18,0.55);padding:7px 14px;" +
        "border-radius:2px;color:#c9cccf;font-size:13px;font-weight:600;letter-spacing:0.4px;",
    );
    const key = (label: string, action: string) =>
      `<span style="color:#ffa32a">${label}</span> <span style="color:#e6e8ea">${action}</span>`;
    legend.innerHTML = [
      key("WASD", "Move"),
      key("Mouse 1 / Space", "Fire"),
      key("R", "Reload"),
      key("Enter", "Retry"),
    ].join('<span style="color:#5a5f66;margin:0 8px">|</span>');

    overlay.append(this.score, this.health, this.time, this.ammo, this.objective, this.banner, crosshair, this.marker, legend);
    root.appendChild(overlay);
  }

  update(model: HudModel): void {
    this.marker.style.opacity = String(Math.min(1, Math.max(0, model.hitFlash / 0.18)));
    this.score.textContent = `SCORE ${String(Math.max(0, Math.round(model.score))).padStart(4, "0")}`;
    this.health.textContent = `HEALTH ${Math.max(0, Math.ceil(model.health))}`;
    this.health.style.color = model.health <= 30 ? "#ff5a4d" : "#43dd6f";
    this.time.textContent = `TIME ${Math.max(0, Math.ceil(model.timeRemaining))}`;
    this.ammo.textContent = model.reloading ? "RELOADING" : `${model.ammo} / ${model.reserve}`;

    if (model.phase === "playing") {
      const remaining = Math.max(0, 12 - model.targetsHit);
      this.objective.textContent = model.locked
        ? `HIT ${remaining} TARGET${remaining === 1 ? "" : "S"}`
        : `CLICK TO LOCK · HIT ${remaining} TARGET${remaining === 1 ? "" : "S"}`;
      this.banner.style.display = "none";
    } else {
      this.objective.textContent = "PRESS ENTER TO RETRY";
      this.banner.style.display = "block";
      this.banner.textContent = model.phase === "complete" ? "RANGE CLEAR" : "RUN OVER";
      this.banner.style.color = model.phase === "complete" ? "#43dd6f" : "#ff5a4d";
    }
  }
}
