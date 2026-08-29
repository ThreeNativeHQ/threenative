import { describe, expect, it, vi } from "vitest";
import { PingPongField } from "./ping-pong-field.js";

describe("PingPongField", () => {
  it("disposes the field color storage buffer when detached", () => {
    const field = new PingPongField();
    const dispose = vi.spyOn(field.fieldColors.value, "dispose");

    field.detach();

    expect(dispose).toHaveBeenCalledOnce();
  });
});
