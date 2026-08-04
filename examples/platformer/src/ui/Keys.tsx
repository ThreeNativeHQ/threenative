import { useEffect, useState } from "react";

/**
 * The keyboard legend, shown until the player moves and then faded out. The
 * reference frame shows gamepad glyphs; this says what actually works here
 * without cluttering the shot forever.
 */
export function Keys() {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onKey = () => setDismissed(true);
    window.addEventListener("keydown", onKey, { once: true });
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className={`pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-xl bg-shade/50 px-4 py-2 text-center text-sm font-semibold text-white/90 ring-1 ring-white/15 backdrop-blur-sm transition-opacity duration-700 ${
        dismissed ? "opacity-0" : "opacity-100"
      }`}
    >
      <kbd className="font-bold">← ↑ ↓ →</kbd> move &nbsp;·&nbsp;
      <kbd className="font-bold">Space</kbd> jump &nbsp;·&nbsp;
      <kbd className="font-bold">Shift</kbd> dash
    </div>
  );
}
