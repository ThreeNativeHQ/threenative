import { createStockShadowView } from './createStockShadowView.js';
import { createVirtualShadowView } from './createVirtualShadowView.js';
import { createDiagnosticsUI } from './ui.js';

function resolveConfig(explicitConfig = {}) {
  const search = new URLSearchParams(window.location.search);
  return {
    mode: search.get('mode') || explicitConfig.mode || 'comparison',
    width: Number(search.get('width') || explicitConfig.width || window.innerWidth),
    height: Number(search.get('height') || explicitConfig.height || window.innerHeight),
    warmupFrames: Number(search.get('warmupFrames') || explicitConfig.warmupFrames || 24),
    invalidationFrame: Number(search.get('invalidationFrame') || explicitConfig.invalidationFrame || 32),
    captureMode: explicitConfig.captureMode === true || search.get('captureMode') === 'true',
  };
}

function installCameraControls(canvas, view, onChange) {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let yaw = 0;
  let pitch = 0;
  const base = view.camera.position.clone();
  const target = view.cameraTarget.clone();
  const offset = base.clone().sub(target);
  const radius = offset.length();
  yaw = Math.atan2(offset.x, offset.z);
  pitch = Math.asin(offset.y / radius);

  const apply = () => {
    const cosPitch = Math.cos(pitch);
    view.camera.position.set(
      target.x + radius * Math.sin(yaw) * cosPitch,
      target.y + radius * Math.sin(pitch),
      target.z + radius * Math.cos(yaw) * cosPitch,
    );
    view.camera.lookAt(target);
    view.camera.updateMatrixWorld(true);
    onChange?.();
  };

  canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    yaw -= (event.clientX - lastX) * 0.004;
    pitch = Math.max(0.08, Math.min(1.15, pitch + (event.clientY - lastY) * 0.003));
    lastX = event.clientX;
    lastY = event.clientY;
    apply();
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  return { apply };
}

function summarizeResidency(residency) {
  const byLevel = [0, 0, 0, 0];
  for (const entry of residency) byLevel[entry.level] += 1;
  return byLevel;
}

function countValidPageTableEntries(pageTableData) {
  let count = 0;
  for (let index = 2; index < pageTableData.length; index += 4) {
    if (pageTableData[index] > 0) count += 1;
  }
  return count;
}

export async function boot(THREE, explicitConfig = {}) {
  window.__TN_VSM_READY__ = false;
  window.__TN_VSM_ERROR__ = null;
  window.__TN_VSM_DEBUG__ = null;

  const config = resolveConfig(explicitConfig);
  const allowedModes = new Set(['comparison', 'debug', 'invalidation']);
  const mode = allowedModes.has(config.mode) ? config.mode : 'comparison';
  document.body.dataset.mode = mode;

  const stockCanvas = document.querySelector('#stock-canvas');
  const virtualCanvas = document.querySelector('#virtual-canvas');
  const diagnostics = createDiagnosticsUI(document.querySelector('#diagnostics'));
  const stockPanel = document.querySelector('#stock-panel');
  const virtualPanel = document.querySelector('#virtual-panel');
  const modeLabel = document.querySelector('[data-mode-label]');
  modeLabel.textContent = mode === 'comparison'
    ? 'SIDE-BY-SIDE PROOF'
    : mode === 'debug'
      ? 'CLIPMAP + PAGE DEBUG'
      : 'SELECTIVE INVALIDATION';

  const layout = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const stockVisible = mode === 'comparison';
    const stockWidth = stockVisible ? Math.floor(width * 0.5) : 0;
    const virtualWidth = stockVisible ? width - stockWidth : width;
    const canvasHeight = height;
    stockPanel.hidden = !stockVisible;
    stockPanel.style.width = `${stockWidth}px`;
    virtualPanel.style.width = `${virtualWidth}px`;
    return { stockWidth, virtualWidth, canvasHeight };
  };

  const dimensions = layout();
  const stockView = mode === 'comparison'
    ? createStockShadowView(THREE, stockCanvas, {
        width: dimensions.stockWidth,
        height: dimensions.canvasHeight,
      })
    : null;
  const virtualView = createVirtualShadowView(THREE, virtualCanvas, {
    width: dimensions.virtualWidth,
    height: dimensions.canvasHeight,
    mode,
    renderBudget: mode === 'comparison' ? 32 : 40,
  });

  let cameraDirty = false;
  installCameraControls(virtualCanvas, virtualView, () => { cameraDirty = true; });
  if (stockView) installCameraControls(stockCanvas, stockView, () => {});

  let frame = 0;
  let stableFrames = 0;
  let moved = false;
  const invalidationProof = {
    moved: false,
    invalidatedPages: 0,
    renderedAfterMove: 0,
    moveDistance: 0,
  };

  const publishProof = (stats) => {
    const residency = virtualView.virtualShadowMap.getResidencySnapshot();
    const pageTableValidEntries = countValidPageTableEntries(
      virtualView.virtualShadowMap.pageTableData,
    );
    window.__TN_VSM_DEBUG__ = {
      feature: 'ThreeNative Virtual Shadow Maps',
      implementation: 'virtual pages + bounded physical atlas + page table + clipmap fallback',
      honestScope: 'WebGL2 CPU receiver-demand vertical slice; GPU depth/compute demand is deferred',
      mode,
      threeRevision: THREE.REVISION,
      frame,
      stats,
      cumulative: stats.cumulative,
      residentByLevel: summarizeResidency(residency),
      pageTableValidEntries,
      atlas: {
        pageSize: stats.pageSize,
        pagesPerAxis: stats.atlasPagesPerAxis,
        textureSize: stats.atlasTextureSize,
        physicalCapacity: stats.physicalCapacity,
        virtualAddressPages: stats.virtualAddressPages,
      },
      clipExtents: [...virtualView.virtualShadowMap.options.clipExtents],
      invalidationProof: { ...invalidationProof },
      conventionalComparison: stockView ? {
        technique: 'single Three.js PCF soft shadow map',
        resolution: [1024, 1024],
        virtualized: false,
      } : null,
      assertions: {
        boundedPhysicalPool: stats.resident <= stats.physicalCapacity,
        validPageTable: pageTableValidEntries > 0,
        renderedVirtualPages: stats.cumulative.rendered > 0,
        cacheReuseObserved: stats.cumulative.cached > 0,
        noOverflow: stats.cumulative.overflow === 0,
      },
    };
  };

  const renderFrame = () => {
    try {
      frame += 1;
      if (mode === 'invalidation' && frame === config.invalidationFrame) {
        virtualView.movableCaster.position.x += 15;
        virtualView.movableCaster.position.z -= 3;
        virtualView.movableCaster.rotation.y += 0.65;
        virtualView.movableCaster.updateMatrixWorld(true);
        moved = true;
        invalidationProof.moved = true;
        invalidationProof.moveDistance = Math.sqrt(15 * 15 + 3 * 3);
      }

      if (stockView) stockView.render();
      const stats = virtualView.render(frame);
      const residency = virtualView.virtualShadowMap.getResidencySnapshot();
      diagnostics.update(
        stats,
        residency,
        virtualView.virtualShadowMap.getLastRenderedKeys(),
      );

      if (moved) {
        invalidationProof.invalidatedPages += stats.invalidated;
        invalidationProof.renderedAfterMove += stats.rendered;
      }

      stableFrames = stats.dirtyResident === 0 && stats.reuseRatio > 0.82
        ? stableFrames + 1
        : 0;
      publishProof(stats);

      const normalReady = frame >= config.warmupFrames && stableFrames >= 4;
      const invalidationReady = moved
        && invalidationProof.invalidatedPages > 0
        && invalidationProof.renderedAfterMove > 0
        && stats.dirtyResident === 0;
      const ready = (mode !== 'invalidation' && normalReady)
        || (mode === 'invalidation' && invalidationReady);
      if (ready) {
        window.__TN_VSM_READY__ = true;
        document.body.dataset.ready = 'true';
      }

      cameraDirty = false;
      if (!(config.captureMode && ready)) window.requestAnimationFrame(renderFrame);
    } catch (error) {
      window.__TN_VSM_ERROR__ = String(error.stack || error);
      document.body.dataset.error = 'true';
      console.error(error);
    }
  };

  window.addEventListener('resize', () => {
    const next = layout();
    if (stockView) stockView.resize(next.stockWidth, next.canvasHeight);
    virtualView.resize(next.virtualWidth, next.canvasHeight);
  });

  window.requestAnimationFrame(renderFrame);
  return { mode, stockView, virtualView };
}
