import type { Recording } from "@threenative/core";
import { browserRecording } from "./browser-recording.js";

export { browserRecording };

export function recordingFingerprint(recording: Recording): string {
  let hash = 2_166_136_261;
  for (const character of JSON.stringify(recording)) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
