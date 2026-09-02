import game from "./game.js";
import { EFFECT_LABELS } from "./scenes/Gallery.js";

void game.start();

const PAGE_SIZE = 9;
const pageCount = Math.ceil(EFFECT_LABELS.length / PAGE_SIZE);
const labels = document.getElementById("labels");
const pageLabel = document.getElementById("page-label");
let page = 0;

function renderLabels(): void {
  if (labels === null) return;
  labels.replaceChildren();
  for (const [slot, label] of EFFECT_LABELS.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  ).entries()) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.style.gridColumn = String((slot % 3) + 1);
    cell.style.gridRow = String(Math.floor(slot / 3) + 1);
    const panel = document.createElement("div");
    panel.className = "label";
    panel.dataset.group = label.group;
    panel.innerHTML = `<strong>${label.name}</strong><small>${label.credit}</small>`;
    cell.append(panel);
    labels.append(cell);
  }
  if (pageLabel !== null) pageLabel.textContent = `Page ${page + 1}/${pageCount}`;
}

window.addEventListener("keydown", (event) => {
  if (event.code !== "KeyN") return;
  page = (page + 1) % pageCount;
  renderLabels();
});

document.getElementById("retrigger")?.addEventListener("click", () => {
  window.dispatchEvent(new Event("threenative-gallery-retrigger"));
});

renderLabels();
