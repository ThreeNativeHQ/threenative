import { UiLayer, useUiState } from "@threenative/ui";
import { createRoot } from "react-dom/client";

const masks = Array.from({ length: 16 }, (_, bit) => 1 << bit);
function Probe() {
  const state = useUiState<{ sequence: number }>();
  if (!state) return null;
  return (
    <div
      style={{
        position: "fixed",
        left: 16,
        top: 16,
        width: 160,
        height: 24,
        display: "flex",
        background: "#ff00ff",
      }}
    >
      {masks.map((mask) => (
        <div key={mask} style={{ width: 8, height: 24, flexShrink: 0 }}>
          <div style={{ height: 12, background: state.sequence & mask ? "#ffffff" : "#000000" }} />
          <div style={{ height: 12, background: state.sequence & mask ? "#000000" : "#ffffff" }} />
        </div>
      ))}
      <div style={{ width: 16, height: 24, background: "#00ffff" }} />
    </div>
  );
}

const root = document.getElementById("tn-ui");
if (!root) throw new Error("Missing UI root");
createRoot(root).render(
  <UiLayer>
    <Probe />
  </UiLayer>,
);
