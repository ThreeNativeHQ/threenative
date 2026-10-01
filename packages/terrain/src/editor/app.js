import {
  MATERIAL_IDS,
  Mask,
  Terrain,
  applyPlacementOverrides,
  bakeTerrain,
  decodeHeightPNG,
  decodeRAW16,
  makeExport,
} from "../index.js";
import { fillIcons, icon } from "./icons.js";
import { PRESETS, createPreset } from "./presets.js";
export function mountRecoveredEditor({
  initial,
  providedView,
  commit,
  getSnapshot,
  subscribe,
  onEvaluated,
  materialColours,
}) {
  const materialColors = materialColours;
  const abort = new AbortController();
  let disposed = false;
  const $ = (id) => document.getElementById(id);
  const escapeHTML = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const tools = [
    ["sculpt", "Sculpt", "Raise the ground. Hold Shift to lower."],
    ["smooth", "Smooth", "Soften spikes and blend transitions."],
    ["flatten", "Flatten", "Make a building pad at a chosen elevation."],
    ["ramp", "Ramp", "Click two endpoints to connect their elevations."],
    ["stamp", "Stamp", "Place a transformed procedural terrain feature."],
    ["erode", "Erode", "Run a local thermal or hydraulic erosion pass."],
    ["paint", "Paint", "Paint a material or a named biome mask."],
    ["scatter", "Scatter", "Place deterministic assets inside the brush."],
    ["spline", "Spline", "Click control points. Enter finishes the road or river."],
    ["water", "Water", "Flood a connected basin from the clicked point."],
    ["select", "Select", "Select one prop. Drag its handles or edit its transform."],
  ];
  const options = {
    flatten: { height: 24 },
    stamp: { shape: "mountain", mirrorX: false },
    erode: { method: "thermal" },
    paint: { material: "dirt", mode: "material", biome: "forest" },
    scatter: { asset: "pine", count: 180, erase: false },
    spline: { kind: "road", width: 12, depth: 4 },
    water: { kind: "lake", level: 5 },
    ramp: { width: 22 },
  };
  const terrain = Terrain.fromJSON(initial.document.recipe);
  let state = null;
  let renderedRecipe = null;
  const view = providedView;
  let selected = terrain.layers[0]?.id;
  let active = "sculpt";
  let preset = "alpine";
  let navigation = false;
  let points = [];
  let stroke = null;
  let busy = false;
  let sequence = 0;
  let workerBusy = false;
  let evaluationRequests = 0;
  let pending = null;
  let worker = null;
  let exportWorker = null;
  let exportReject = null;
  let timer = null;
  let toastTimer = null;
  const localSaved = false;
  fillIcons();
  function toast(message) {
    clearTimeout(toastTimer);
    $("toast").textContent = message;
    $("toast").classList.remove("hidden");
    toastTimer = setTimeout(() => $("toast").classList.add("hidden"), 4300);
  }
  function attempt(fn) {
    try {
      return fn();
    } catch (e) {
      toast(e.message);
      return undefined;
    }
  }
  function setBusy(value, text = "Building terrain") {
    busy = value;
    $("busy-status").classList.toggle("hidden", !value);
    $("busy-text").textContent = text;
  }
  function workerURL() {
    return new URL("./worker.js", import.meta.url);
  }
  function newWorker() {
    const w = new Worker(workerURL(), { type: "module" });
    w.onmessage = ({ data }) => {
      if (data.type === "progress") {
        if (data.id === sequence)
          $("busy-text").textContent =
            `Evaluating ${data.progress.index + 1}/${data.progress.total}`;
        return;
      }
      workerBusy = false;
      if (data.id === sequence) {
        if (data.type === "error") {
          toast(data.error);
          $("save-status").textContent = "Build failed · last preview retained";
        } else if (data.type === "evaluated") {
          const ready = attempt(() => {
            data.state = view.update(data.state) ?? data.state;
            return true;
          });
          if (!ready) {
            $("save-status").textContent = "Preview failed · last preview retained";
          } else {
            state = data.state;
            renderedRecipe = JSON.stringify(terrain.toJSON());
            renderedRevision = revision;
            onEvaluated?.({ revision, state, ms: data.ms });
            $("mesh-stats").textContent =
              `${(2 * (state.resolution - 1) ** 2).toLocaleString()} tris · ${state.instances.length.toLocaleString()} instances`;
            $("eval-time").textContent = `${Math.round(data.ms)} ms · CPU worker`;
            $("diagnostic-count").textContent = state.diagnostics.length;
            $("diagnostic-list").textContent = state.diagnostics.join("\n") || "No diagnostics.";
            $("save-status").textContent =
              `Rendered ${renderedRevision.slice(0, 8)} · saved on disk`;
          }
        }
      }
      if (pending) dispatch();
      else setBusy(false);
    };
    w.onerror = (e) => {
      e.preventDefault();
      workerBusy = false;
      pending = null;
      setBusy(false);
      toast(`Worker failed: ${e.message}. Serve the source over HTTP or use the standalone HTML.`);
    };
    return w;
  }
  function dispatch() {
    if (workerBusy || !pending) return;
    const job = pending;
    pending = null;
    try {
      worker ??= newWorker();
      workerBusy = true;
      worker.postMessage(job);
      evaluationRequests++;
    } catch (e) {
      workerBusy = false;
      setBusy(false);
      toast(e.message);
    }
  }
  function build() {
    if (disposed) return;
    sequence++;
    pending = {
      id: sequence,
      type: "evaluate",
      recipe: terrain.toJSON(),
      resolution: Number($("preview-resolution").value),
    };
    setBusy(true);
    clearTimeout(timer);
    timer = setTimeout(dispatch, 35);
  }
  function cancelBuild() {
    clearTimeout(timer);
    pending = null;
    sequence++;
    worker?.terminate();
    worker = null;
    workerBusy = false;
    exportWorker?.terminate();
    exportWorker = null;
    exportReject?.(new Error("Export cancelled"));
    exportReject = null;
    for (const b of document.querySelectorAll("[data-export]")) {
      b.disabled = false;
    }
    setBusy(false);
    $("save-status").textContent = "Build cancelled · preview unchanged";
    toast("Build cancelled. Rebuild to evaluate the current stack.");
  }
  function updateHistory() {
    $("undo-btn").disabled = !terrain.canUndo;
    $("redo-btn").disabled = !terrain.canRedo;
  }
  function renderLayers() {
    const layers = terrain.layers;
    if (!layers.some((l) => l.id === selected)) selected = layers.at(-1)?.id;
    $("layer-count").textContent = layers.length;
    const list = $("layer-list");
    list.replaceChildren();
    layers.forEach((l, i) => {
      const row = document.createElement("div");
      row.className = `layer-row${l.id === selected ? " selected" : ""}${l.enabled === false ? " disabled" : ""}`;
      row.draggable = true;
      row.dataset.id = l.id;
      const index = document.createElement("span");
      index.className = "layer-index";
      index.textContent = String(i + 1).padStart(2, "0");
      const glyph = document.createElement("span");
      glyph.className = "layer-icon";
      glyph.innerHTML = icon(
        l.type === "materials" ? "paint" : ["river", "road"].includes(l.type) ? "spline" : l.type,
      );
      const label = document.createElement("div");
      label.className = "layer-label";
      const name = document.createElement("strong");
      const type = document.createElement("small");
      name.textContent = l.name ?? l.id;
      type.textContent = l.type;
      label.append(name, type);
      const eye = document.createElement("button");
      eye.className = "layer-eye";
      eye.innerHTML = icon(l.enabled === false ? "eye-off" : "eye");
      eye.title = l.enabled === false ? "Enable layer" : "Disable layer";
      eye.setAttribute("aria-label", `${eye.title}: ${l.name ?? l.id}`);
      eye.onclick = (e) => {
        e.stopPropagation();
        terrain.toggle(l.id, l.enabled === false);
      };
      row.append(index, glyph, label, eye);
      row.onclick = () => {
        selected = l.id;
        renderLayers();
      };
      row.ondragstart = (e) => e.dataTransfer.setData("text/plain", l.id);
      row.ondragover = (e) => e.preventDefault();
      row.ondrop = (e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData("text/plain");
        attempt(() => terrain.move(id, i));
      };
      list.append(row);
    });
    renderInspector();
    updateHistory();
  }
  function renderInspector() {
    const layer = selected ? terrain.layer(selected) : null;
    for (const id of [
      "selected-name",
      "selected-opacity",
      "selected-json",
      "apply-layer",
      "layer-up",
      "layer-down",
      "layer-duplicate",
      "layer-delete",
    ])
      $(id).disabled = !layer;
    $("selected-type").textContent = layer ? layer.type.toUpperCase() : "LAYER PROPERTIES";
    $("selected-name").value = layer?.name ?? layer?.id ?? "";
    $("selected-opacity").value = layer?.opacity ?? 1;
    $("opacity-value").textContent = `${Math.round((layer?.opacity ?? 1) * 100)}%`;
    $("selected-json").value = layer
      ? JSON.stringify(
          { params: layer.params, ...(layer.mask ? { mask: layer.mask } : {}) },
          null,
          2,
        )
      : "";
    $("layer-error").textContent = "";
  }
  let revision = initial.revision;
  let renderedRevision = null;
  let saving = false;
  let loading = false;
  function useSnapshot(snapshot) {
    if (snapshot.diagnostic) {
      toast(snapshot.diagnostic);
      $("save-status").textContent = "Invalid disk save · valid preview retained";
      return;
    }
    if (snapshot.revision === revision) return;
    const recipeChanged =
      JSON.stringify(terrain.toJSON()) !== JSON.stringify(snapshot.document.recipe);
    const ready = attempt(() => {
      view.setDocument(snapshot.document, snapshot.revision);
      return true;
    });
    if (!ready) {
      $("save-status").textContent = "Preview failed · last preview retained";
      return;
    }
    revision = snapshot.revision;
    if (!recipeChanged) {
      const matchesPreview = renderedRecipe === JSON.stringify(snapshot.document.recipe);
      if (state && matchesPreview)
        state = applyPlacementOverrides(state, snapshot.document.placementOverrides ?? {});
      if (matchesPreview && !busy) {
        renderedRevision = revision;
        $("save-status").textContent = `Applied ${revision.slice(0, 8)} · saved on disk`;
      } else {
        $("save-status").textContent = busy
          ? `Requested ${revision.slice(0, 8)} · building`
          : "Saved recipe not rendered · last preview retained";
      }
      return;
    }
    loading = true;
    terrain.loadJSON(snapshot.document.recipe);
    loading = false;
    renderLayers();
    build();
  }
  async function changed() {
    renderLayers();
    if (loading) return;
    if (saving) {
      loading = true;
      terrain.loadJSON(saved.document.recipe);
      loading = false;
      toast("Wait for the current save");
      return;
    }
    saving = true;
    document.body.dataset.saving = "true";
    try {
      const next = await commit({
        baseRevision: revision,
        document: { ...saved.document, recipe: terrain.toJSON() },
      });
      saved = next;
      revision = next.revision;
      view.setDocument(next.document, next.revision);
      $("save-status").textContent = `Requested ${revision.slice(0, 8)} · building`;
      build();
    } catch (error) {
      toast(error.message);
      const next = await getSnapshot();
      saved = next;
      revision = next.revision;
      view.setDocument(next.document, next.revision);
      loading = true;
      terrain.loadJSON(next.document.recipe);
      loading = false;
      renderLayers();
      build();
    } finally {
      saving = false;
      delete document.body.dataset.saving;
    }
  }
  let saved = initial;
  subscribe((snapshot) => {
    if (!saving) {
      saved = snapshot;
      useSnapshot(snapshot);
    }
  });
  terrain.subscribe(changed);
  function brush() {
    return {
      radius: Number($("brush-radius").value),
      strength: Number($("brush-strength").value),
      falloff: Number($("brush-falloff").value),
      shape: $("brush-shape").value,
      rotation: Number($("brush-rotation").value),
      spacing: Number($("brush-spacing").value),
      jitter: Number($("brush-jitter").value),
    };
  }
  function optionSelect(label, key, choices, value) {
    return `<label class="field-label">${label}<select data-option="${key}">${choices.map((c) => `<option value="${escapeHTML(c)}"${c === value ? " selected" : ""}>${escapeHTML(c[0].toUpperCase() + c.slice(1))}</option>`).join("")}</select></label>`;
  }
  function optionNumber(label, key, value, step = 1) {
    return `<label class="field-label">${label}<input type="number" data-option="${key}" value="${value}" step="${step}"></label>`;
  }
  function renderOptions() {
    const o = options[active] ?? {};
    let html = "";
    if (active === "flatten")
      html = `${optionNumber("Target elevation (m)", "height", o.height)}<p class="small muted">Use the terrain Y coordinate as a guide.</p>`;
    if (active === "stamp")
      html = `${optionSelect("Stamp shape", "shape", ["mountain", "crater", "ridge", "valley", "mesa", "dune"], o.shape)}<p class="small muted">Strength controls amplitude. Rotate in Brush dynamics. JSON also supports anisotropic scale and mirrored heightmaps.</p>`;
    if (active === "erode")
      html = `${optionSelect("Simulation", "method", ["thermal", "hydraulic"], o.method)}<p class="small muted">Evaluates on the current heightfield, then blends inside the brush footprint.</p>`;
    if (active === "paint") {
      html = optionSelect("Paint target", "mode", ["material", "biome"], o.mode);
      if (o.mode === "biome")
        html += `<label class="field-label">Biome name<input data-option="biome" value="${escapeHTML(o.biome)}"></label>`;
      else
        html += `<div class="swatch-grid">${MATERIAL_IDS.map((id, i) => `<button class="swatch${o.material === id ? " active" : ""}" data-material="${id}" title="${id}"><i style="background:rgb(${materialColors[i].map((c) => Math.round(c * 255)).join(",")})"></i><span>${id}</span></button>`).join("")}</div>`;
    }
    if (active === "scatter")
      html = `${
        optionSelect("Asset ID", "asset", ["pine", "boulder", "grass"], o.asset) +
        optionNumber("Requested instances", "count", o.count)
      }<label class="field-label"><span><input type="checkbox" data-option="erase"${o.erase ? " checked" : ""}> Erase this asset inside brush</span></label><p class="small muted">Starter assets are proxies. Register your own Three.js meshes through the adapter.</p>`;
    if (active === "spline")
      html = `${
        optionSelect("Spline type", "kind", ["road", "river"], o.kind) +
        optionNumber("Width (m)", "width", o.width) +
        (o.kind === "river" ? optionNumber("River depth (m)", "depth", o.depth) : "")
      }<p class="small muted">Control points retain their elevations. Edit the layer JSON for precise profiles.</p>`;
    if (active === "water")
      html = `${
        optionSelect("Water body", "kind", ["lake", "ocean"], o.kind) +
        optionNumber("Water level (m)", "level", o.level, 0.5)
      }<p class="small muted">Lake seed must be below the water level. Oceans flood from map boundaries.</p>`;
    if (active === "ramp")
      html = `${optionNumber("Ramp width (m)", "width", o.width)}<p class="small muted">First click: start. Second click: end. The shoulder blends into the terrain.</p>`;
    $("tool-options").innerHTML = html;
  }
  function selectTool(id) {
    stroke = null;
    active = id;
    document.body.dataset.terrainTool = id;
    navigation = false;
    view.setNavigation(false);
    view.setSelection?.(id === "select");
    view.setBrush(null);
    $("navigate-btn").classList.remove("active");
    points = [];
    showPoints();
    const i = tools.findIndex((t) => t[0] === id);
    $("brush-title").textContent = id === "select" ? "Select one prop" : `${tools[i][1]} terrain`;
    $("brush-desc").textContent = tools[i][2];
    $("tool-key").textContent = id === "select" ? "Q" : (i + 1) % 10;
    for (const b of document.querySelectorAll(".tool-button")) {
      b.classList.toggle("active", b.dataset.tool === id);
    }
    renderOptions();
    $("canvas-help").innerHTML =
      `${icon("mouse")}<span>${escapeHTML(tools[i][2])} <b>·</b> Right-drag navigates</span>`;
  }
  for (let i = 0; i < tools.length; i++) {
    const [id, name] = tools[i];
    const b = document.createElement("button");
    b.className = "tool-button";
    b.dataset.tool = id;
    b.innerHTML = `${icon(id === "select" ? "mouse" : id)}<span>${name}</span><small>${id === "select" ? "Q" : (i + 1) % 10}</small>`;
    b.onclick = () => selectTool(id);
    $("tool-grid").append(b);
  }
  $("tool-options").onchange = (e) => {
    const key = e.target.dataset.option;
    if (!key) return;
    options[active][key] =
      e.target.type === "checkbox"
        ? e.target.checked
        : e.target.type === "number"
          ? Number(e.target.value)
          : e.target.value;
    if (key === "mode" || key === "kind") renderOptions();
  };
  $("tool-options").onclick = (e) => {
    const b = e.target.closest("[data-material]");
    if (b) {
      options.paint.material = b.dataset.material;
      renderOptions();
    }
  };
  for (const [id, out, format] of [
    ["brush-radius", "radius-value", (v) => `${v} m`],
    ["brush-strength", "strength-value", (v) => `${Math.round(v * 100)}%`],
    ["brush-falloff", "falloff-value", (v) => `${Math.round(v * 100)}%`],
    ["brush-rotation", "rotation-value", (v) => `${v}°`],
    ["brush-spacing", "spacing-value", (v) => `${Math.round(v * 100)}%`],
    ["brush-jitter", "jitter-value", (v) => `${Math.round(v * 100)}%`],
  ])
    $(id).oninput = () => {
      $(out).textContent = format(Number($(id).value));
    };
  function addStroke(path, lower) {
    if (!path.length) return;
    const b = brush();
    const at = path[0];
    const mask = Mask.circle(at, b.radius, b.falloff);
    const label = `${tools.find((t) => t[0] === active)[1]} stroke`;
    terrain.transaction(() => {
      if (["sculpt", "smooth", "flatten"].includes(active)) {
        const p = { ...b, points: path, label };
        if (active === "sculpt") p.strength = b.strength * 22 * (lower ? -1 : 1);
        if (active === "smooth") p.iterations = 4;
        if (active === "flatten") p.height = options.flatten.height;
        terrain[active](p);
      } else if (active === "stamp")
        terrain.stamp({
          label: `${options.stamp.shape} stamp`,
          at,
          radius: b.radius,
          amplitude: b.strength * 130,
          shape: options.stamp.shape,
          rotation: b.rotation,
          roughness: 0.18,
          falloff: b.falloff,
        });
      else if (active === "erode")
        terrain.erode({
          label: `${options.erode.method} erosion`,
          ...b,
          at,
          method: options.erode.method,
          iterations: 14,
          droplets: 1600,
          maxSteps: 45,
          opacity: b.strength,
          strength: 1,
        });
      else if (active === "paint") {
        const p = { ...b, points: path, label };
        if (options.paint.mode === "biome")
          terrain.biome({ ...p, name: options.paint.biome, value: lower ? 0 : 1 });
        else terrain.paint({ ...p, material: options.paint.material });
      } else if (active === "scatter") {
        const o = options.scatter;
        if (o.erase)
          terrain.clear({ label: `Clear ${o.asset}`, target: "scatter", asset: o.asset, mask });
        else
          terrain.scatter({
            label: `Scatter ${o.asset}`,
            asset: o.asset,
            count: o.count,
            minDistance: o.asset === "pine" ? 4 : 1.5,
            scale: [0.7, 1.35],
            maxSlope: o.asset === "boulder" ? 65 : 36,
            mask,
          });
      } else if (active === "water") {
        const o = options.water;
        terrain.water({
          label: o.kind === "lake" ? "Lake water" : "Ocean water",
          kind: o.kind,
          at,
          radius: o.kind === "ocean" ? terrain.config.size : b.radius,
          level: o.level,
        });
      }
    });
    selected = terrain.layers.at(-1)?.id;
    renderLayers();
  }
  function showPoints() {
    view.showSpline(points);
    $("spline-bar").classList.toggle("hidden", !points.length);
    $("spline-count").textContent =
      `${points.length} control point${points.length === 1 ? "" : "s"}`;
    $("finish-spline").disabled = points.length < 2;
  }
  function finishSpline() {
    if (points.length < 2) return;
    attempt(() => {
      if (active === "ramp")
        terrain.ramp({
          label: "Terrain ramp",
          from: points[0],
          to: points[1],
          width: options.ramp.width,
          shoulder: options.ramp.width * 0.5,
        });
      else {
        const o = options.spline;
        const path = points.map((p) => [...p]);
        if (o.kind === "river")
          for (let i = 1; i < path.length; i++)
            path[i][1] = Math.min(path[i][1], path[i - 1][1] - 0.1);
        terrain[o.kind]({
          label: o.kind === "river" ? "River spline" : "Road spline",
          points: path,
          width: o.width,
          shoulder: o.width * 0.7,
          ...(o.kind === "river" ? { depth: o.depth, enforceDownhill: true } : {}),
        });
      }
      points = [];
      showPoints();
      selected = terrain.layers.at(-1)?.id;
      renderLayers();
    });
  }
  const host = $("viewport");
  host.addEventListener("pointerdown", (e) => {
    if (saving) return;
    if (e.target !== host && !e.target.classList.contains("render-canvas")) return;
    if (e.button !== 0 || e.altKey || navigation) return;
    if (active === "select") return;
    const hit = view.pick(e.clientX, e.clientY);
    if (!hit) return;
    if (active === "spline" || active === "ramp") {
      points.push(hit);
      showPoints();
      if (active === "ramp" && points.length === 2) finishSpline();
      return;
    }
    stroke = { pointer: e.pointerId, path: [[hit[0], hit[2]]], lower: e.shiftKey };
    host.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  host.addEventListener("pointermove", (e) => {
    const hit = view.pick(e.clientX, e.clientY);
    if (!hit) {
      view.setBrush(null);
      return;
    }
    $("coordinates").textContent =
      `X ${hit[0].toFixed(1)} · Y ${hit[1].toFixed(1)} · Z ${hit[2].toFixed(1)} m`;
    const b = brush();
    view.setBrush(navigation || active === "select" ? null : { ...b, at: [hit[0], hit[2]] });
    if (stroke && ["sculpt", "smooth", "flatten", "paint"].includes(active)) {
      const last = stroke.path.at(-1);
      if (
        Math.hypot(last[0] - hit[0], last[1] - hit[2]) > Math.max(0.3, b.radius * 0.04) &&
        stroke.path.length < 2048
      )
        stroke.path.push([hit[0], hit[2]]);
    }
  });
  host.addEventListener("pointerup", (e) => {
    if (stroke?.pointer === e.pointerId) {
      const current = stroke;
      stroke = null;
      if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId);
      attempt(() => addStroke(current.path, current.lower));
    }
  });
  host.addEventListener("pointercancel", () => {
    stroke = null;
  });
  host.addEventListener("pointerleave", () => {
    if (!stroke) view.setBrush(null);
  });
  $("finish-spline").onclick = finishSpline;
  $("cancel-spline").onclick = () => {
    points = [];
    showPoints();
  };
  $("undo-btn").onclick = () => terrain.undo();
  $("redo-btn").onclick = () => terrain.redo();
  $("selected-opacity").oninput = () => {
    $("opacity-value").textContent = `${Math.round(Number($("selected-opacity").value) * 100)}%`;
  };
  $("selected-opacity").onchange = () =>
    attempt(() => terrain.update(selected, { opacity: Number($("selected-opacity").value) }));
  $("selected-name").onchange = () =>
    attempt(() => terrain.update(selected, { name: $("selected-name").value }));
  $("apply-layer").onclick = () => {
    try {
      const patch = JSON.parse($("selected-json").value);
      if (
        !patch ||
        typeof patch !== "object" ||
        Array.isArray(patch) ||
        Object.keys(patch).some((k) => !["params", "mask"].includes(k))
      )
        throw Error('Use {"params": {...}, "mask": {...}}');
      const old = terrain.layer(selected);
      terrain.add({
        ...old,
        params: patch.params ?? old.params,
        mask: patch.mask ?? { type: "all" },
      });
      $("layer-error").textContent = "";
    } catch (e) {
      $("layer-error").textContent = e.message;
    }
  };
  $("layer-up").onclick = () =>
    attempt(() =>
      terrain.move(selected, Math.max(0, terrain.layers.findIndex((l) => l.id === selected) - 1)),
    );
  $("layer-down").onclick = () =>
    attempt(() =>
      terrain.move(
        selected,
        Math.min(terrain.layers.length - 1, terrain.layers.findIndex((l) => l.id === selected) + 1),
      ),
    );
  $("layer-delete").onclick = () => attempt(() => terrain.remove(selected));
  $("layer-duplicate").onclick = () =>
    attempt(() => {
      const layer = terrain.layer(selected);
      let i = 1;
      while (terrain.layers.some((l) => l.id === `${layer.id.slice(0, 85)}-copy-${i}`)) i++;
      layer.id = `${layer.id.slice(0, 85)}-copy-${i}`;
      layer.name = `${(layer.name ?? layer.type).slice(0, 85)} copy`;
      terrain.add(layer);
      selected = layer.id;
      renderLayers();
    });
  for (const b of document.querySelectorAll("[data-panel]"))
    b.onclick = () => {
      for (const x of document.querySelectorAll("[data-panel]")) {
        x.classList.toggle("active", x === b);
      }
      $("tools-panel").classList.toggle("hidden", b.dataset.panel !== "tools");
      $("generate-panel").classList.toggle("hidden", b.dataset.panel !== "generate");
    };
  for (const p of PRESETS) {
    const b = document.createElement("button");
    b.className = `preset-card${p.id === preset ? " active" : ""}`;
    b.dataset.preset = p.id;
    b.innerHTML = `<span class="preset-thumb ${p.id}">${icon(p.id === "desert" ? "terrace" : p.id === "island" ? "water" : "mountain")}</span><span><strong>${p.name}</strong><small>${p.tag}</small></span>`;
    b.onclick = () => {
      preset = p.id;
      for (const el of document.querySelectorAll("[data-preset]")) {
        el.classList.toggle("active", el === b);
      }
    };
    $("preset-list").append(b);
  }
  function namePreset(id) {
    const p = PRESETS.find((x) => x.id === id);
    $("project-name").textContent = p.name;
    $("landscape-title").textContent = p.name;
    $("landscape-subtitle").textContent = p.subtitle;
    $("landscape-tag").textContent = `LANDSCAPE / ${p.tag}`;
  }
  $("generate-world").onclick = () =>
    attempt(() => {
      const next = createPreset(preset, {
        resolution: terrain.config.resolution,
        seed: Number($("seed-input").value),
        size: Number($("world-size").value),
      });
      terrain.loadJSON(next.toJSON());
      namePreset(preset);
      selected = terrain.layers[0]?.id;
      renderLayers();
      points = [];
      showPoints();
      view.frame();
      toast("Landscape regenerated. Undo restores the previous stack.");
    });
  const passes = [
    [
      "noise",
      "Noise",
      () => terrain.noise({ label: "Detail noise", amplitude: 4, scale: 30, warp: 7 }),
    ],
    [
      "mountain",
      "Mountains",
      () =>
        terrain.stamp({
          label: "Mountain mass",
          at: [0, -80],
          radius: [135, 90],
          amplitude: 95,
          shape: "mountain",
        }),
    ],
    [
      "ramp",
      "Valleys",
      () =>
        terrain.stamp({
          label: "Valley basin",
          at: [0, 0],
          radius: [100, 150],
          amplitude: 35,
          shape: "valley",
        }),
    ],
    [
      "erode",
      "Erosion",
      () =>
        terrain.erode({
          label: "Hydraulic erosion",
          method: "hydraulic",
          droplets: 8000,
          maxSteps: 45,
        }),
    ],
    [
      "biome",
      "Biomes",
      () =>
        terrain.biome({
          label: "Forest biome",
          name: "forest",
          mask: Mask.and(Mask.height(5, 100, 10), Mask.slope(0, 35, 8)),
        }),
    ],
    [
      "scatter",
      "Populate",
      () =>
        terrain.scatter({
          label: "Forest population",
          asset: "pine",
          count: 800,
          minDistance: 5,
          mask: Mask.and(Mask.height(5, 100, 10), Mask.slope(0, 35, 8)),
        }),
    ],
  ];
  for (const [ico, label, fn] of passes) {
    const b = document.createElement("button");
    b.innerHTML = icon(ico) + label;
    b.onclick = () => attempt(fn);
    $("pass-grid").append(b);
  }
  $("navigate-btn").onclick = () => {
    navigation = !navigation;
    view.setNavigation(navigation);
    $("navigate-btn").classList.toggle("active", navigation);
    view.setBrush(null);
  };
  $("view-angle").onchange = () => view.setView($("view-angle").value);
  $("render-mode").onchange = () => view.setMode($("render-mode").value);
  $("preview-resolution").onchange = build;
  $("frame-btn").onclick = () => view.frame();
  $("rebuild-btn").onclick = build;
  $("cancel-build").onclick = cancelBuild;
  $("mobile-tools").onclick = () => {
    document.body.dataset.mobilePanel =
      document.body.dataset.mobilePanel === "tools" ? "" : "tools";
  };
  $("mobile-layers").onclick = () => {
    document.body.dataset.mobilePanel =
      document.body.dataset.mobilePanel === "layers" ? "" : "layers";
  };
  $("recipe-btn").onclick = () => {
    $("recipe-editor").value = JSON.stringify(terrain.toJSON(), null, 2);
    $("recipe-error").textContent = "";
    $("recipe-dialog").showModal();
  };
  $("close-recipe").onclick = () => $("recipe-dialog").close();
  $("apply-recipe").onclick = () => {
    try {
      terrain.loadJSON($("recipe-editor").value);
      $("recipe-error").textContent = "";
      toast("Recipe validated and applied.");
    } catch (e) {
      $("recipe-error").textContent = e.message;
    }
  };
  $("copy-recipe").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("recipe-editor").value);
      toast("Recipe copied.");
    } catch {
      const ta = $("recipe-editor");
      ta.focus();
      ta.select();
      toast("Clipboard unavailable. JSON selected; press Ctrl/⌘ C.");
    }
  };
  function download(output) {
    const blob = new Blob([output.bytes], { type: output.type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = output.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  $("export-btn").onclick = () => {
    $("export-error").textContent = "";
    $("export-dialog").showModal();
  };
  $("close-export").onclick = () => $("export-dialog").close();
  async function exportKind(kind) {
    $("export-error").textContent = "";
    if (kind === "project") {
      download(await makeExport(state, terrain.toJSON(), kind));
      return;
    }
    for (const b of document.querySelectorAll("[data-export]")) {
      b.disabled = true;
    }
    setBusy(true, "Baking export");
    try {
      const output = await new Promise((resolve, reject) => {
        exportReject = reject;
        exportWorker = new Worker(workerURL(), { type: "module" });
        exportWorker.onmessage = ({ data }) => {
          if (data.type === "exported") resolve(data.output);
          else if (data.type === "error") reject(new Error(data.error));
          else if (data.type === "progress")
            $("busy-text").textContent = `Baking ${data.progress.index + 1}/${data.progress.total}`;
        };
        exportWorker.onerror = (e) => {
          e.preventDefault();
          reject(new Error(e.message));
        };
        exportWorker.postMessage({
          type: "export",
          id: 1,
          recipe: terrain.toJSON(),
          resolution: Number($("export-resolution").value),
          kind,
        });
      });
      download(output);
      toast(`Export ready: ${output.name}`);
    } catch (e) {
      $("export-error").textContent = e.message;
    } finally {
      exportWorker?.terminate();
      exportWorker = null;
      exportReject = null;
      for (const b of document.querySelectorAll("[data-export]")) {
        b.disabled = false;
      }
      if (!workerBusy && !pending) setBusy(false);
    }
  }
  for (const b of document.querySelectorAll("[data-export]"))
    b.onclick = () => exportKind(b.dataset.export);
  $("import-btn").onclick = () => $("import-file").click();
  $("import-file").onchange = async () => {
    const file = $("import-file").files[0];
    if (!file) return;
    try {
      if (file.size > 64 * 1024 * 1024) throw Error("File is larger than the 64 MB import limit");
      if (file.name.toLowerCase().endsWith(".json")) terrain.loadJSON(await file.text());
      else {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const min = Number($("import-min").value);
        const max = Number($("import-max").value);
        let data;
        if (file.name.toLowerCase().endsWith(".png")) {
          data = await decodeHeightPNG(bytes);
          if (!data.hasEmbeddedRange) data = await decodeHeightPNG(bytes, { min, max });
        } else {
          const n = Math.sqrt(bytes.length / 2);
          if (!Number.isInteger(n)) throw Error("RAW16 import requires a square heightfield");
          data = decodeRAW16(bytes, { width: n, height: n, min, max, littleEndian: true });
        }
        terrain.heightmap({
          label: "Imported heightmap",
          data: { width: data.width, height: data.height, values: data.values },
          blend: "replace",
        });
      }
      toast("File imported as an undoable edit.");
      $("export-error").textContent = "";
    } catch (e) {
      $("export-error").textContent = e.message;
    } finally {
      $("import-file").value = "";
    }
  };
  const keydown = (e) => {
    if (saving) return;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
    if (active === "select" && (e.ctrlKey || e.metaKey || e.key === "Escape")) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? terrain.redo() : terrain.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      terrain.redo();
      return;
    }
    if (document.querySelector("dialog[open]")) return;
    if (/^[0-9]$/.test(e.key)) selectTool(tools[(Number(e.key) + 9) % 10][0]);
    if (e.key.toLowerCase() === "q") selectTool("select");
    if (e.key.toLowerCase() === "v") $("navigate-btn").click();
    if (e.key.toLowerCase() === "f") view.frame();
    if (e.key === "Enter") finishSpline();
    if (e.key === "Escape") {
      points = [];
      stroke = null;
      showPoints();
    }
  };
  window.addEventListener("keydown", keydown, { signal: abort.signal });
  window.strata = {
    Terrain,
    Mask,
    get revision() {
      return revision;
    },
    get renderedRevision() {
      return renderedRevision;
    },
    get terrain() {
      return terrain;
    },
    get state() {
      return state;
    },
    get workerBusy() {
      return workerBusy;
    },
    get evaluationRequests() {
      return evaluationRequests;
    },
    get busy() {
      return busy;
    },
    get view() {
      return view;
    },
    rebuild: build,
    cancel: cancelBuild,
    dispose: () => {
      disposed = true;
      abort.abort();
      clearTimeout(timer);
      clearTimeout(toastTimer);
      worker?.terminate();
      exportWorker?.terminate();
      exportReject?.(new Error("Editor disposed"));
    },
    export: exportKind,
    bake: (opts) => {
      if (!state) throw Error("Wait for initial build");
      return bakeTerrain(state, opts);
    },
    registerAsset: (id, object) => {
      if (!view.registerAsset) throw Error("Three.js renderer is not active");
      return view.registerAsset(id, object);
    },
  };
  $("view-angle").value = "perspective";
  $("view-angle").disabled = false;
  const preview = $("preview-resolution");
  const resolution = String(terrain.config.resolution);
  if (![...preview.options].some((option) => option.value === resolution))
    preview.add(new Option(`${resolution}²`, resolution));
  preview.value = resolution;
  $("world-size").value = terrain.config.size;
  $("seed-input").value = terrain.config.seed;
  $("landscape-title").textContent = "Project terrain";
  $("landscape-subtitle").textContent = `${terrain.config.size} m · shared authoring document`;
  $("landscape-tag").textContent = "LANDSCAPE / PROJECT";
  selectTool("sculpt");
  renderLayers();
  view.setDocument(initial.document, initial.revision);
  build();
  $("renderer-badge").textContent = view.backend;
  return window.strata;
}
