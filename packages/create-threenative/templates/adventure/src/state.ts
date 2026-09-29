/**
 * Everything the HUD reads, and nothing it can derive for itself.
 *
 * The rules (`src/logic/`) own the game; the UI is a mirror. Two consequences: the quest text and the
 * keeper's lines come out of the same tables the rules read (`QUEST`, `keeperLines`), so a rewrite
 * cannot leave the panel quoting the old story; and a value that changes every frame is rounded here
 * before it is published, because the store is cloned whole for every playtest observation.
 */
export type GameState = {
  paused: boolean;
  uiReady: boolean;
  /** Half-hearts, 0..6 (three hearts). */
  hp: number;
  gems: number;
  /** Ids of the sigils found, in the order they were taken. */
  sigils: string[];
  /** "meet", "seek", "altar" or "complete". */
  stage: string;
  /** 0..100. */
  stamina: number;
  /** The line the keeper is saying, or "" when nobody is speaking. */
  dialog: string;
  /** Whether a further line follows. */
  dialogMore: boolean;
  /** What pressing the interact key would do right now, or "". */
  prompt: string;
  /** The last thing worth telling the player, and a counter so a repeat still re-shows. */
  toast: string;
  toastId: number;
  /** True from the altar's awakening until the player chooses to stay. */
  victory: boolean;
  dead: boolean;
  /** Counts hits taken, so the HUD can flash on each one even when two land in a row. */
  hurtId: number;
  /** Hero position and heading, rounded to a centimetre. */
  playerX: number;
  playerY: number;
  playerZ: number;
  playerAngle: number;
  /** Hearts of the locked-on briarling (0..3), or 0; and where it is on screen, 0..1, or -1. */
  lockHp: number;
  lockX: number;
  lockY: number;
  kills: number;
  attacks: number;
  rolls: number;
  damageTaken: number;
  /** Briarlings still standing. */
  enemies: number;
  /** Where the untaken sigils are, as flat `[x, z, colour, ...]` triples in tenths of a metre. */
  mapMarks: number[];
  /** True when the HUD is hidden (`C`). */
  cinematic: boolean;
  /** Whole seconds the scene has run. */
  clock: number;
  /** Times the game has been saved. */
  saves: number;
};

export const INITIAL_STATE: GameState = {
  attacks: 0,
  cinematic: false,
  clock: 0,
  damageTaken: 0,
  dead: false,
  hurtId: 0,
  dialog: "",
  dialogMore: false,
  enemies: 6,
  gems: 0,
  hp: 6,
  kills: 0,
  lockHp: 0,
  lockX: -1,
  lockY: -1,
  mapMarks: [],
  paused: false,
  playerAngle: Math.PI,
  playerX: 0,
  playerY: 0,
  playerZ: 12,
  prompt: "",
  rolls: 0,
  saves: 0,
  sigils: [],
  stage: "meet",
  stamina: 100,
  toast: "",
  toastId: 0,
  uiReady: false,
  victory: false,
};
