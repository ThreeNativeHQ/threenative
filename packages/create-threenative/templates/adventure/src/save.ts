import { type ISave, restoreSave } from "./logic/quest.js";

const SAVE_KEY = "threenative.adventure.save";

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The saved game, or `undefined` for a first run, missing storage or a save that fails validation. */
export function loadSave(): ISave | undefined {
  return restoreSave(storage()?.getItem(SAVE_KEY));
}

/** Writes the save; a full or missing store loses the progress, never the game. */
export function writeSave(save: ISave): boolean {
  try {
    storage()?.setItem(SAVE_KEY, JSON.stringify(save));
    return storage() !== undefined;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  try {
    storage()?.removeItem(SAVE_KEY);
  } catch {
    // Nothing to clear.
  }
}
