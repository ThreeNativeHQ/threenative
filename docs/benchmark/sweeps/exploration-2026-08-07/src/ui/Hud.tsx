import type { Game } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import { useEffect, useState } from "react";
import type { AreaId, GameState, PointId } from "../state.js";

const AREA_META: Record<AreaId, { index: string; label: string }> = {
  hub: { index: "00", label: "Starwell Hub" },
  archive: { index: "01", label: "Eastern Archive" },
  grove: { index: "02", label: "Western Lantern Grove" },
};

const POINT_META: Record<PointId, { index: string; title: string; short: string; detail: string }> = {
  beacon: {
    index: "01",
    title: "Starwell Beacon",
    short: "central signal",
    detail: "The old beacon still answers with a low amber pulse. The two gates are listening for the same note.",
  },
  archiveLens: {
    index: "02",
    title: "Archive Lens",
    short: "eastern memory",
    detail: "A teal lens refracts the shape of the hub. Someone built this room to remember the way home.",
  },
  groveMemory: {
    index: "03",
    title: "Grove Memory",
    short: "western echo",
    detail: "The grove holds a warm shard beneath the branches. Its rhythm matches the Starwell exactly.",
  },
};

export function Hud({ game }: { game: Game<GameState, PhysicsContext> }) {
  const area = useGameState(game, (state) => state.area);
  const score = useGameState(game, (state) => state.score);
  const inspected = useGameState(game, (state) => state.inspected);
  const nearbyPoint = useGameState(game, (state) => state.nearbyPoint);
  const lastInspected = useGameState(game, (state) => state.lastInspected);
  const transitionActive = useGameState(game, (state) => state.transitionActive);
  const transitionTitle = useGameState(game, (state) => state.transitionTitle);
  const transitionSubtitle = useGameState(game, (state) => state.transitionSubtitle);
  const [journalOpen, setJournalOpen] = useState(true);
  const currentArea = AREA_META[area];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "j") return;
      setJournalOpen((open) => !open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const lastPoint = lastInspected === null ? null : POINT_META[lastInspected];
  const nearby = nearbyPoint === null ? null : POINT_META[nearbyPoint];

  return (
    <div className="hud-layer pointer-events-none">
      <header className="hud-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <div className="eyebrow">NORTHSTAR / FIELD NOTES</div>
            <div className="brand-title">The quiet route</div>
          </div>
        </div>

        <div className="location-readout">
          <div className="eyebrow">SECTOR // {currentArea.index}</div>
          <div className="location-name">{currentArea.label}</div>
        </div>

        <div className="signal-readout">
          <div className="eyebrow">SIGNAL</div>
          <div className="signal-count">{String(score).padStart(2, "0")}</div>
        </div>
      </header>

      <aside className={`journal-panel ${journalOpen ? "is-open" : "is-collapsed"} pointer-events-auto`}>
        <div className="journal-topline">
          <div>
            <div className="eyebrow">JOURNAL / OBJECTIVE</div>
            <h1>Trace the resonance</h1>
          </div>
          <button
            className="journal-toggle"
            type="button"
            tabIndex={-1}
            aria-expanded={journalOpen}
            onClick={() => setJournalOpen((open) => !open)}
          >
            {journalOpen ? "−" : "+"}
          </button>
        </div>

        <div className="journal-progress">
          <div className="progress-copy">
            <span>{inspected.length} of 3 notes logged</span>
            <span className="progress-value">{Math.round((inspected.length / 3) * 100)}%</span>
          </div>
          <div className="progress-track" aria-hidden="true">
            <span style={{ width: `${(inspected.length / 3) * 100}%` }} />
          </div>
        </div>

        {journalOpen && (
          <>
            <p className="objective-copy">
              Visit each landmark. Press <kbd>E</kbd> when its signal resolves.
            </p>
            <ol className="journal-list">
              {(Object.keys(POINT_META) as PointId[]).map((pointId) => {
                const point = POINT_META[pointId];
                const found = inspected.includes(pointId);
                return (
                  <li className={found ? "is-found" : ""} key={pointId}>
                    <span className="journal-index">{point.index}</span>
                    <span className="journal-entry">
                      <span>{point.title}</span>
                      <small>{found ? "signal logged" : point.short}</small>
                    </span>
                    <span className="journal-status" aria-label={found ? "logged" : "not logged"}>
                      {found ? "●" : "○"}
                    </span>
                  </li>
                );
              })}
            </ol>
          </>
        )}

        <button className="journal-key" type="button" tabIndex={-1} onClick={() => setJournalOpen((open) => !open)}>
          <span>J</span> toggle journal
        </button>
      </aside>

      <div className="objective-ribbon">
        <div className="eyebrow">CURRENT DIRECTIVE</div>
        <div className="objective-line">
          <span className="objective-dot" />
          <span>{inspected.length === 3 ? "Return to the Starwell" : "Map the three listening points"}</span>
        </div>
      </div>

      {nearby !== null && !transitionActive && (
        <div className="inspect-prompt" aria-live="polite">
          <span className="prompt-key">E</span>
          <span>Inspect {nearby.title}</span>
          <span className="prompt-arrow">↗</span>
        </div>
      )}

      {lastPoint !== null && (
        <div className="last-note" aria-live="polite">
          <div className="eyebrow">NOTE LOGGED // {lastInspected && POINT_META[lastInspected].index}</div>
          <strong>{lastPoint.title}</strong>
          <p>{lastPoint.detail}</p>
        </div>
      )}

      <div className={`transition-curtain ${transitionActive ? "is-visible" : ""}`} aria-hidden={!transitionActive}>
        <div className="transition-card">
          <div className="eyebrow">ROUTE SHIFT / SIGNAL LOCKED</div>
          <h2>{transitionTitle || "Aligning the route"}</h2>
          <p>{transitionSubtitle || "The field notes are changing shape."}</p>
          <div className="transition-rule" aria-hidden="true">
            <span />
          </div>
        </div>
      </div>
    </div>
  );
}
