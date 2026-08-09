import { assertCondition, startBehaviorScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startBehaviorScene(canvas, dimensions, "local-storage", () => {
    const key = "__tn_conformance_local_storage__";
    localStorage.removeItem(key);
    assertCondition(
      localStorage.getItem(key) === null,
      "missing localStorage key must return null",
    );
    localStorage.setItem(key, 42);
    assertCondition(localStorage.getItem(key) === "42", "localStorage must stringify values");
    assertCondition(localStorage.length >= 1, "localStorage length must include the inserted key");
    localStorage.removeItem(key);
    assertCondition(
      localStorage.getItem(key) === null,
      "localStorage removeItem must remove the key",
    );
    return { roundTrip: true };
  });
}
