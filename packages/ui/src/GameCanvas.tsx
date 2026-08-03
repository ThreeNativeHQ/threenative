import type { Game } from "@threenative/core";
import { useEffect, useRef } from "react";

export interface GameCanvasProps<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
> {
  className?: string;
  game: Game<TState, TPhysics>;
}

export function GameCanvas<TState extends Record<string, unknown>, TPhysics>({
  className,
  game,
}: GameCanvasProps<TState, TPhysics>) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void game
      .start()
      .then(() => {
        const canvas = game.ctx?.renderer.domElement;
        if (!cancelled && canvas !== undefined && host.current !== null) {
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
