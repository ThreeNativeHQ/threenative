import type { IGame } from "@threenative/core";
import { useEffect, useRef, useState } from "react";

export interface IGameCanvasProps<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
> {
  className?: string;
  game: IGame<TState, TPhysics>;
}

export function GameCanvas<TState extends Record<string, unknown>, TPhysics>({
  className,
  game,
}: IGameCanvasProps<TState, TPhysics>) {
  const host = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    const publishStartupPhase = (): void => {
      const phase = game.ctx?.startup.phase;
      if (!cancelled && phase !== undefined && host.current !== null)
        host.current.dataset.threenativeStartup = phase;
    };
    const startupTimer = globalThis.setInterval(publishStartupPhase, 100);
    setFailure(undefined);
    void game
      .start()
      .then(() => {
        const canvas = game.ctx?.renderer.domElement;
        if (!cancelled && canvas !== undefined && host.current !== null) {
          // The core creates a bare canvas and appends it to <body>. Left
          // unstyled it keeps the 300x150 intrinsic size and, being the last
          // body child, paints over everything. Mounting it here means it
          // fills the host and inherits the host's place in the stack.
          canvas.style.display = "block";
          canvas.style.width = "100%";
          canvas.style.height = "100%";
          canvas.style.touchAction = "none";
          host.current.replaceChildren(canvas);
        }
        publishStartupPhase();
      })
      .catch((error: unknown) => {
        // A rejected start must be visible, not an unhandled promise rejection that
        // nobody renders: the DOM carries the message so a person or a playtest can
        // see the canvas never came up. Styling stays the project's.
        if (cancelled) return;
        setFailure(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
      globalThis.clearInterval(startupTimer);
      game.stop();
    };
  }, [game]);

  return (
    <div
      ref={host}
      className={className}
      data-threenative-canvas="true"
      data-threenative-startup="starting"
      style={{ height: "100%", width: "100%" }}
    >
      {failure === undefined ? null : (
        <div data-threenative-canvas-error="true" role="alert">
          {failure}
        </div>
      )}
    </div>
  );
}
