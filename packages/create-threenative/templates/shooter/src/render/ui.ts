export const shooterUi = {
  app: {
    canvas: "shooter-canvas",
    root: "shooter-app",
  },
  hud: {
    copy: {
      ammo: (ammo: number, reserve: number) => `${ammo} / ${reserve}`,
      clear: (wavesCleared: number) => `clear ${wavesCleared}`,
      eyebrow: "arena / first person",
      health: "health",
      lives: "lives",
      reloading: "reloading",
      rules: "clear 5 waves · fail 0 lives",
      targets: (targets: number) => `targets ${targets}`,
      wave: (wave: number) => `wave ${wave} / 5`,
    },
    ammo: {
      count: "shooter-ammo__count",
      reloading: "shooter-ammo__reloading",
      root: "shooter-ammo",
    },
    eyebrow: "shooter-hud__eyebrow",
    meter: {
      fill: {
        amber: "shooter-meter__fill shooter-meter__fill--amber",
        cyan: "shooter-meter__fill shooter-meter__fill--cyan",
      },
      label: "shooter-meter__label",
      root: "shooter-meter",
      track: "shooter-meter__track",
      value: "shooter-meter__value",
    },
    phase: {
      dead: "shooter-phase shooter-phase--danger",
      lost: "shooter-phase shooter-phase--danger",
      playing: "",
      won: "shooter-phase shooter-phase--success",
    },
    phaseCopy: {
      dead: "respawning",
      lost: "run failed",
      playing: "",
      won: "arena clear",
    },
    root: "shooter-hud",
    rules: "shooter-hud__rules",
    summary: "shooter-hud__summary",
    wave: "shooter-hud__wave",
  },
  crosshair: {
    horizontal: "shooter-crosshair__bar shooter-crosshair__bar--horizontal",
    root: "shooter-crosshair",
    rootAiming: "shooter-crosshair shooter-crosshair--aiming",
    vertical: "shooter-crosshair__bar shooter-crosshair__bar--vertical",
  },
  menu: {
    actions: "shooter-menu__actions",
    button: "shooter-menu__button",
    copy: {
      pause: "pause",
      primary: "WASD move · mouse look · click or F fires · right-click or Q aims · R reloads",
      restart: "restart",
      resume: "resume",
      secondary:
        "shift sprints · ctrl/C crouches · G projectile · E radius · V probe · H damage · X lethal · enter restarts",
    },
    help: "shooter-menu__help",
    helpPrimary: "shooter-menu__help-primary",
    helpSecondary: "shooter-menu__help-secondary",
    root: "shooter-menu",
  },
} as const;
