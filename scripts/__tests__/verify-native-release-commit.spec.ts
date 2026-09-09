import { describe, expect, it } from "vitest";
import { verifyNativeReleaseCommit } from "../verify-native-release-commit.js";

describe("native release commit guard", () => {
  it("accepts a native tag that resolves to the candidate SHA", () => {
    expect(
      verifyNativeReleaseCommit({
        candidateSha: "candidate-sha",
        lookup: () => "candidate-sha",
        tag: "runtime-native-v0.3.0",
      }),
    ).toBe("candidate-sha");
  });

  it("rejects a native tag that resolves to a different SHA", () => {
    expect(() =>
      verifyNativeReleaseCommit({
        candidateSha: "candidate-sha",
        lookup: () => "different-sha",
        tag: "runtime-native-v0.3.0",
      }),
    ).toThrow(/exact candidate SHA/u);
  });

  it("rejects a tag lookup that returned no commit", () => {
    expect(() =>
      verifyNativeReleaseCommit({
        candidateSha: "candidate-sha",
        lookup: () => undefined,
        tag: "runtime-native-v0.3.0",
      }),
    ).toThrow(/could not resolve/u);
  });
});
