import { clamp } from "./terrain.js";

/** The three lights the keeper asks for, in the order the HUD lists them. */
export const SIGILS = ["brook", "briar", "elder"] as const;
export type SigilId = (typeof SIGILS)[number];
export type Stage = "meet" | "seek" | "altar" | "complete";

/** What survives a restart. Everything else is the moment, not the save. */
export interface ISave {
  gems: number;
  hp: number;
  openedChests: string[];
  sigils: SigilId[];
  sound: boolean;
  stage: Stage;
  version: 1;
}

/** Six half-hearts: three hearts. */
export const MAX_HP = 6;

export function newGame(): ISave {
  return { gems: 0, hp: MAX_HP, openedChests: [], sigils: [], sound: false, stage: "meet", version: 1 };
}

const isSigil = (id: unknown): id is SigilId => SIGILS.includes(id as SigilId);

export function meetKeeper(save: ISave): boolean {
  if (save.stage !== "meet") return false;
  save.stage = "seek";
  return true;
}

/** Takes a sigil. Refused before the keeper has asked, for an unknown id, and for a repeat. */
export function collectSigil(save: ISave, id: string): boolean {
  if (save.stage === "meet" || !isSigil(id) || save.sigils.includes(id)) return false;
  save.sigils.push(id);
  if (save.sigils.length === SIGILS.length && save.stage !== "complete") save.stage = "altar";
  return true;
}

export function activateAltar(save: ISave): boolean {
  if (save.stage !== "altar" || save.sigils.length !== SIGILS.length) return false;
  save.stage = "complete";
  return true;
}

/**
 * Reads a save back, fail-closed: anything malformed is `undefined`, never a half-restored game.
 * The stage is re-derived from the sigils so a hand-edited file cannot skip the quest.
 */
export function restoreSave(raw: string | null | undefined): ISave | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    const a = JSON.parse(raw) as Partial<ISave> | null;
    if (a === null || typeof a !== "object" || a.version !== 1 || !Array.isArray(a.sigils)) return undefined;
    const save = newGame();
    save.sigils = [...new Set(a.sigils)].filter(isSigil);
    save.stage =
      save.sigils.length === SIGILS.length
        ? a.stage === "complete"
          ? "complete"
          : "altar"
        : save.sigils.length > 0 || a.stage === "seek"
          ? "seek"
          : "meet";
    save.hp = Number.isFinite(a.hp) ? clamp(Math.round(a.hp as number), 1, MAX_HP) : MAX_HP;
    save.gems = Number.isFinite(a.gems) ? clamp(Math.floor(a.gems as number), 0, 999) : 0;
    save.openedChests = Array.isArray(a.openedChests) ? a.openedChests.filter((id) => id === "oak") : [];
    save.sound = a.sound === true;
    return save;
  } catch {
    return undefined;
  }
}

/** The quest panel's two lines for a stage. */
export const QUEST: Readonly<Record<Stage, readonly [title: string, detail: string]>> = {
  altar: ["A promise to keep", "Bring the sigils to the altar in the north."],
  complete: ["The grove remembers", "The woods are yours to wander."],
  meet: ["A voice in the clearing", "Find Mira beside the old stone stair."],
  seek: ["Gather the lost lights", "Find the three sigils. Follow your map."],
};
