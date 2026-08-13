export const shooterUi = {
  app: {
    canvas: "shooter-canvas",
    root: "shooter-app",
  },
  hud: {
    copy: {
      clear: (wavesCleared: number) => `clear ${wavesCleared}`,
      eyebrow: "arena / shooter",
      health: "health",
      lives: "lives",
      rules: "clear 5 waves · fail 0 lives",
      targets: (targets: number) => `targets ${targets}`,
      wave: (wave: number) => `wave ${wave} / 5`,
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
  menu: {
    actions: "shooter-menu__actions",
    button: "shooter-menu__button",
    copy: {
      pause: "pause",
      primary: "WASD / arrows move · F hitscan · G projectile",
      restart: "restart",
      resume: "resume",
      secondary: "E radius test · C wall probe · H damage · X lethal · R restart",
    },
    help: "shooter-menu__help",
    helpPrimary: "shooter-menu__help-primary",
    helpSecondary: "shooter-menu__help-secondary",
    root: "shooter-menu",
  },
} as const;
