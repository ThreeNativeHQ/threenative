import { assertCondition, startBehaviorScene } from "./scene-support.js";

// PRD-177 phase 1: a game that stops and restarts must not receive ghost input from the
// disposed registration. removeEventListener has to actually reverse addEventListener on
// window and document — one dispatch per live registration, nothing to disposed closures.
export function startScene(canvas, dimensions) {
  return startBehaviorScene(canvas, dimensions, "input-restart-lifetime", () => {
    const seen = [];

    const first = (event) => seen.push(`first:${event.code}`);
    window.addEventListener("keydown", first);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA" }));
    window.removeEventListener("keydown", first);

    const second = (event) => seen.push(`second:${event.code}`);
    window.addEventListener("keydown", second);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA" }));

    const firstDocument = () => seen.push("first:document");
    document.addEventListener("ping", firstDocument);
    document.dispatchEvent(new Event("ping"));
    document.removeEventListener("ping", firstDocument);
    const secondDocument = () => seen.push("second:document");
    document.addEventListener("ping", secondDocument);
    document.dispatchEvent(new Event("ping"));

    assertCondition(
      seen.length === 4,
      `expected exactly four deliveries across two register-dispose cycles, got ${seen.length}: ${seen.join(",")}`,
    );
    assertCondition(seen[0] === "first:KeyA", `first window delivery was ${seen[0]}`);
    assertCondition(
      seen[1] === "second:KeyA",
      `disposed window listener ghosted into the restart: ${seen[1]}`,
    );
    assertCondition(seen[2] === "first:document", `first document delivery was ${seen[2]}`);
    assertCondition(
      seen[3] === "second:document",
      `disposed document listener ghosted into the restart: ${seen[3]}`,
    );
    return { events: seen };
  });
}
