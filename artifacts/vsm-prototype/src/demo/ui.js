const LEVEL_COLORS = ['#31d6ff', '#48f68c', '#ffbd39', '#ff3f69'];

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

export function createDiagnosticsUI(container) {
  const values = {};
  for (const element of container.querySelectorAll('[data-stat]')) {
    values[element.dataset.stat] = element;
  }
  const residencyCanvas = container.querySelector('[data-residency-map]');

  const update = (stats, residency, renderedKeys) => {
    const fields = {
      requested: stats.requested,
      resident: `${stats.resident} / ${stats.physicalCapacity}`,
      rendered: stats.rendered,
      cached: stats.cached,
      reuseRatio: formatPercent(stats.reuseRatio),
      invalidated: stats.invalidated,
      evicted: stats.evicted,
      overflow: stats.overflow,
      dirtyResident: stats.dirtyResident,
      physicalCapacity: stats.physicalCapacity,
    };
    for (const [name, value] of Object.entries(fields)) {
      if (values[name]) values[name].textContent = String(value);
    }
    drawResidencyMap(residencyCanvas, residency, stats, renderedKeys);
  };

  return { update };
}

export function drawResidencyMap(canvas, residency, stats, renderedKeys = []) {
  if (!canvas) return;
  const context = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 220;
  const cssHeight = canvas.clientHeight || 220;
  if (canvas.width !== Math.round(cssWidth * ratio) || canvas.height !== Math.round(cssHeight * ratio)) {
    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(cssHeight * ratio);
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  context.fillStyle = '#071017';
  context.fillRect(0, 0, cssWidth, cssHeight);

  const axis = stats.atlasPagesPerAxis;
  const gap = 2;
  const cell = Math.min(
    (cssWidth - gap * (axis + 1)) / axis,
    (cssHeight - gap * (axis + 1)) / axis,
  );
  const rendered = new Set(renderedKeys);

  for (let slot = 0; slot < axis * axis; slot += 1) {
    const slotX = slot % axis;
    const slotY = Math.floor(slot / axis);
    const x = gap + slotX * (cell + gap);
    const y = cssHeight - gap - (slotY + 1) * cell - slotY * gap;
    context.fillStyle = '#101e28';
    context.fillRect(x, y, cell, cell);
  }

  for (const entry of residency) {
    const x = gap + entry.slotX * (cell + gap);
    const y = cssHeight - gap - (entry.slotY + 1) * cell - entry.slotY * gap;
    context.fillStyle = LEVEL_COLORS[entry.level] || '#ffffff';
    context.globalAlpha = entry.dirty ? 0.28 : 0.84;
    context.fillRect(x, y, cell, cell);
    context.globalAlpha = 1;
    if (entry.pinned) {
      context.strokeStyle = '#ffffff';
      context.lineWidth = 1;
      context.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
    }
    if (rendered.has(entry.key)) {
      context.strokeStyle = '#ffef6a';
      context.lineWidth = 2;
      context.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
    }
  }
}
