/**
 * The study's staged loading overlay, over the engine's own loading bar until the first frame the
 * engine calls ready. The stages are read off the engine's real startup progress, so the text never
 * claims a stage the launch has not reached; once ready it fades and stops taking pointer input.
 */
export function LoadingOverlay({ progress, ready }: { progress: number; ready: boolean }) {
  const stage = ready
    ? "ENTERING THE STORM"
    : progress < 0.34
      ? "BUILDING THE CLOUD VOLUME"
      : progress < 0.67
        ? "LIGHTING THE COAST"
        : "ENTERING THE STORM";
  const width = ready ? 100 : Math.max(10, Math.round(progress * 100));
  return (
    <div aria-busy={!ready} aria-hidden={ready} className={`loading${ready ? " gone" : ""}`}>
      <div className="loading-inner">
        <div className="loading-title">TEMPEST</div>
        <div aria-live="polite" className="loading-text">
          {stage}
        </div>
        <div className="loading-line">
          <span style={{ width: `${width}%` }} />
        </div>
        <div className="loading-note">
          A procedural, real-time weather study.
          <br />
          Contains lightning flashes. Disable them in
          <br />
          Rendering &amp; Accessibility or press <kbd>X</kbd>.
        </div>
      </div>
    </div>
  );
}
