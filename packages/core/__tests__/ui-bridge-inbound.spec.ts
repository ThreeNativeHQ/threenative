import { describe, expect, it } from "vitest";
import { UI_BRIDGE_GLOBALS, connectUiBridge } from "../src/ui-bridge.js";

/** A host scope: the game end finds `__tnUiPost`, so it takes the platform transport. */
function hostScope(): Record<string, unknown> {
  return { [UI_BRIDGE_GLOBALS.gamePost]: () => undefined };
}

function deliverFromHost(scope: Record<string, unknown>, message: object): void {
  (scope[UI_BRIDGE_GLOBALS.gameReceive] as (frame: string) => void)(JSON.stringify(message));
}

describe("ui bridge inbound global", () => {
  it("gives every connection on one end the host's frame", () => {
    const scope = hostScope();
    const first: string[] = [];
    const second: string[] = [];
    connectUiBridge({ end: "game", scope }).onMessage((m) => first.push(m.type));
    connectUiBridge({ end: "game", scope }).onMessage((m) => second.push(m.type));

    deliverFromHost(scope, { type: "click", id: 7 });

    expect(first).toEqual(["click"]);
    expect(second).toEqual(["click"]);
  });

  it("keeps the survivor connected when one closes, and clears the global when none are left", () => {
    const scope = hostScope();
    const survivor: string[] = [];
    const closing = connectUiBridge({ end: "game", scope });
    connectUiBridge({ end: "game", scope }).onMessage((m) => survivor.push(m.type));

    closing.close();
    deliverFromHost(scope, { type: "click", id: 1 });
    expect(survivor).toEqual(["click"]);

    const last = connectUiBridge({ end: "game", scope });
    last.close();
    expect(scope[UI_BRIDGE_GLOBALS.gameReceive]).toBeTypeOf("function");
  });

  it("removes the host global once the last connection closes", () => {
    const scope = hostScope();
    const only = connectUiBridge({ end: "game", scope });
    expect(scope[UI_BRIDGE_GLOBALS.gameReceive]).toBeTypeOf("function");
    only.close();
    expect(scope[UI_BRIDGE_GLOBALS.gameReceive]).toBeUndefined();
  });
});
