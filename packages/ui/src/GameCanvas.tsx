import type { IGame } from "@threenative/core";
import { useEffect, useRef } from "react";

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

  useEffect(() => {
    let cancelled = false;
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
      })
      .catch((error: unknown) => {
        if (!cancelled) throw error;
      });

    return () => {
      cancelled = true;
      game.stop();
    };
  }, [game]);

  return (
    <div
      ref={host}
      className={className}
      data-threenative-canvas="true"
      style={{ height: "100%", width: "100%" }}
    />
  );
}
