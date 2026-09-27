import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

/**
 * The cadence gate's React page: the same page-local burst as the plain-DOM page, owned by React.
 *
 * PRD-398's acceptance criterion asks for a React-local update beside the DOM one, and a CSS
 * animation cannot supply it. The reported symptom is a React HUD refreshing late, so what has to be
 * measured is a change that reaches the screen only through React's own commit path. This component
 * keeps the counter in `useState`, ticks it from a rAF loop and renders the value, so every visible
 * change here is a React render; the 10 s burst / 1 s idle rhythm is the same idle the criterion asks
 * to repeat after, and it is this component's state that stops rather than a stylesheet's.
 *
 * It is a fixture and not the input proof: `ui/main.ts` stays plain DOM. This file is loaded only by
 * the cadence gate's `--lane react`, which bundles it in place of that entry.
 */
const ACTIVE_MS = 10_000;
const IDLE_MS = 1_000;

function Ticker() {
  const [idle, setIdle] = useState(false);
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    let frame = requestAnimationFrame(function animate(now: number): void {
      const quiet = now % (ACTIVE_MS + IDLE_MS) >= ACTIVE_MS;
      setIdle(quiet);
      if (!quiet) setTicks((value) => value + 1);
      frame = requestAnimationFrame(animate);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div id="react-pulse" className={idle ? "idle" : undefined}>
      <span>REACT TICKS</span> <b>{ticks}</b>
    </div>
  );
}

const reactRoot = document.getElementById("react-root");
if (reactRoot !== null) createRoot(reactRoot).render(<Ticker />);
