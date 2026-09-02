import {
  playtestDiagnostic,
  type IPlaytestCaptureProvenance,
  type IPlaytestObservationSnapshot,
  type IPlaytestPathAssertion,
  type IPlaytestScenario,
  type IPlaytestVisualRegionBounds,
  type IPlaytestVisualRegionTarget,
} from "../index.js";
import { PlaytestBridgeError } from "./bridgeClient.js";
import { resolveBrowserArguments } from "./browser.js";
import type { IStandalonePlaytestConfig } from "./config.js";
import { pixelBoundsToNdc } from "./camera.js";
import { entityPosition, length, subtract } from "./shared.js";
import type { IMovementSampleInterval, IRunnerConsoleEntry } from "./shared.js";
import type { Page } from "playwright";
import { PNG } from "pngjs";

interface IElementVisibilitySample {
  bounds?: IPlaytestVisualRegionBounds;
  rendered: boolean;
}

interface IDomElementVisibilitySample extends IElementVisibilitySample {
  clip?: { height: number; width: number; x: number; y: number };
  isolationKey?: string;
  isolationFailure?: string;
}

interface IVisibilityIsolationPropertyState {
  name: string;
  originalPriority: string;
  originalValue: string;
  temporaryPriority: string;
  temporaryValue: string;
}

interface IVisibilityIsolationElementState {
  element: Element;
  properties: IVisibilityIsolationPropertyState[];
}

interface IVisibilityIsolationState {
  elements: Element[];
  hiddenElements: IVisibilityIsolationElementState[];
  markerAttribute: string;
  mutationTracker: IVisibilityIsolationMutationTracker;
  probe: Element;
  probeAttribute: string;
  style: HTMLStyleElement;
}

interface IVisibilityIsolationMutationTracker {
  changed: boolean;
  stop: () => void;
}

interface IVisibilityIsolationCleanupResult {
  cleaned: boolean;
  isolationIntact: boolean;
}

let visibilityIsolationSequence = 0;

/** Proves a DOM target contributes visible pixels and is not hidden by another painted node. */
export async function sampleElementVisibility(
  page: Page,
  target: IPlaytestVisualRegionTarget,
): Promise<IElementVisibilitySample> {
  const isolationKey = `__threenativePlaytestVisibilityIsolation${visibilityIsolationSequence++}`;
  const domSample = await page.evaluate(({ requestedTarget, isolationKey }): IDomElementVisibilitySample => {
    const node = requestedTarget.id === undefined
      ? (() => {
          try {
            return requestedTarget.selector === undefined ? null : document.querySelector(requestedTarget.selector);
          } catch {
            return null;
          }
        })()
      : document.getElementById(requestedTarget.id);
    if (node === null) return { rendered: false };

    const rect = node.getBoundingClientRect();
    const bounds: IPlaytestVisualRegionBounds | undefined = [rect.height, rect.width, rect.left, rect.top].every(Number.isFinite) && rect.width > 0 && rect.height > 0
      ? { height: rect.height, width: rect.width, x: rect.left, y: rect.top }
      : undefined;
    if (bounds === undefined) return { rendered: false };

    let rendered = true;
    for (let current: Element | null = node; rendered && current !== null; current = current.parentElement) {
      const style = window.getComputedStyle(current);
      const opacity = Number.parseFloat(style.opacity);
      const contentVisibility = style.getPropertyValue?.("content-visibility") || style.contentVisibility;
      rendered = style.display !== "none"
        && style.visibility !== "hidden"
        && style.visibility !== "collapse"
        && contentVisibility !== "hidden"
        && (!Number.isFinite(opacity) || opacity > 0);
    }
    if (!rendered) return { bounds, rendered: false };

    const left = Math.max(0, bounds.x);
    const top = Math.max(0, bounds.y);
    const right = Math.min(window.innerWidth, bounds.x + bounds.width);
    const bottom = Math.min(window.innerHeight, bounds.y + bounds.height);
    if (right <= left || bottom <= top) return { bounds, rendered: false };

    const centerX = Math.min(Math.max(bounds.x + bounds.width / 2, 0), Math.max(0, window.innerWidth - 1));
    const centerY = Math.min(Math.max(bounds.y + bounds.height / 2, 0), Math.max(0, window.innerHeight - 1));
    const pointerEventsStyle = document.createElement("style");
    pointerEventsStyle.textContent = "* { pointer-events: auto !important; }";
    if (document.head === null) return { bounds, rendered: false };
    document.head.appendChild(pointerEventsStyle);
    try {
      const topmost = document.elementFromPoint(centerX, centerY);
      rendered = topmost === node || (topmost !== null && node.contains(topmost));
    } catch {
      rendered = false;
    } finally {
      try {
        pointerEventsStyle.remove();
      } catch {
        rendered = false;
      }
    }

    if (!rendered) return { bounds, rendered: false };

    const markerAttribute = `data-threenative-visibility-${isolationKey}`;
    const probeAttribute = `data-threenative-visibility-probe-${isolationKey}`;
    const markedElements = [node];
    const hiddenElements: IVisibilityIsolationElementState[] = [];
    let isolationStyle: HTMLStyleElement | undefined;
    let isolationProbe: Element | undefined;
    let stopMutationTracking: (() => void) | undefined;
    const restoreHiddenElements = (): boolean => {
      let cleaned = true;
      for (const { element, properties } of hiddenElements) {
        try {
          const inlineStyle = (element as HTMLElement).style;
          for (const property of properties) {
            if (inlineStyle.getPropertyValue(property.name) !== property.temporaryValue
              || inlineStyle.getPropertyPriority(property.name) !== property.temporaryPriority) continue;
            if (property.originalValue === "") inlineStyle.removeProperty(property.name);
            else inlineStyle.setProperty(property.name, property.originalValue, property.originalPriority);
          }
        } catch {
          cleaned = false;
        }
      }
      return cleaned;
    };
    const cleanupIsolation = (): boolean => {
      let cleaned = true;
      try {
        stopMutationTracking?.();
      } catch {
        cleaned = false;
      }
      try {
        isolationStyle?.remove();
      } catch {
        cleaned = false;
      }
      if (!restoreHiddenElements()) cleaned = false;
      for (const element of markedElements) {
        try {
          element.removeAttribute(markerAttribute);
        } catch {
          cleaned = false;
        }
      }
      try {
        isolationProbe?.removeAttribute(probeAttribute);
      } catch {
        cleaned = false;
      }
      try {
        isolationProbe?.removeAttribute("style");
      } catch {
        cleaned = false;
      }
      try {
        isolationProbe?.remove();
      } catch {
        cleaned = false;
      }
      return cleaned;
    };
    try {
      node.setAttribute(markerAttribute, "");

      const documentElement = document.documentElement ?? null;
      const body = document.body ?? null;
      const targetContainsDocumentElement = documentElement !== null
        && (node === documentElement || node.contains(documentElement));
      const targetContainsBody = body !== null
        && (node === body || node.contains(body));
      if (document.head === null) throw new Error("Cannot isolate a visibility target without document.head");
      isolationProbe = document.createElement("span");
      isolationProbe.setAttribute(probeAttribute, "");
      isolationProbe.setAttribute("style", [
        "position: fixed !important",
        "top: 0 !important",
        "left: 0 !important",
        "width: 0 !important",
        "height: 0 !important",
        "margin: 0 !important",
        "padding: 0 !important",
        "border: 0 !important",
        "display: block !important",
        "flex: none !important",
      ].join("; "));
      const probeParent = targetContainsDocumentElement || targetContainsBody || body === null ? document.head : body;
      if (probeParent === null) throw new Error("Cannot isolate a visibility target without a probe parent");
      probeParent.appendChild(isolationProbe);
      if (window.getComputedStyle(isolationProbe).visibility !== "visible") {
        throw new Error("Cannot verify a visible visibility isolation probe");
      }
      const documentElements = documentElement === null
        ? []
        : [documentElement, ...documentElement.querySelectorAll("*")];
      for (const element of documentElements) {
        if (element === isolationProbe || element === node || node.contains(element)) continue;
        const inlineStyle = (element as HTMLElement).style;
        const properties = [
          { name: "visibility", temporaryValue: "hidden" },
          ...(element === documentElement || element === body
            ? [
                { name: "background-color", temporaryValue: "transparent" },
                { name: "background-image", temporaryValue: "none" },
              ]
            : []),
        ].map(({ name, temporaryValue }) => ({
          name,
          originalPriority: inlineStyle.getPropertyPriority(name),
          originalValue: inlineStyle.getPropertyValue(name),
          temporaryPriority: "important",
          temporaryValue,
        }));
        hiddenElements.push({ element, properties });
        for (const property of properties) {
          inlineStyle.setProperty(property.name, property.temporaryValue, property.temporaryPriority);
          property.temporaryValue = inlineStyle.getPropertyValue(property.name);
          property.temporaryPriority = inlineStyle.getPropertyPriority(property.name);
        }
      }
      isolationStyle = document.createElement("style");
      isolationStyle.textContent = [
        targetContainsDocumentElement ? "" : "html { background: transparent !important; visibility: hidden !important; }",
        targetContainsBody ? "" : "body { background: transparent !important; visibility: hidden !important; }",
        `body *:not([${markerAttribute}]):not([${markerAttribute}] *) { visibility: hidden !important; }`,
        `[${markerAttribute}] { visibility: visible !important; }`,
        targetContainsDocumentElement || targetContainsBody || body === null
          ? `[${probeAttribute}] { visibility: hidden !important; }`
          : "",
      ].filter(Boolean).join("\n");
      document.head.appendChild(isolationStyle);
      const targetVisibility = window.getComputedStyle(node).visibility;
      const probeVisibility = window.getComputedStyle(isolationProbe).visibility;
      const transparentBackground = (element: Element | null): boolean => {
        if (element === null) return true;
        const style = window.getComputedStyle(element);
        return (style.backgroundColor === "transparent" || style.backgroundColor === "rgba(0, 0, 0, 0)")
          && style.backgroundImage === "none";
      };
      const rootsAreTransparent = (targetContainsDocumentElement || transparentBackground(documentElement))
        && (targetContainsBody || transparentBackground(body));
      const nonTargetElementsAreHidden = hiddenElements.every(({ element }) => window.getComputedStyle(element).visibility === "hidden");
      if (targetVisibility !== "visible" || probeVisibility !== "hidden" || !rootsAreTransparent || !nonTargetElementsAreHidden) {
        throw new Error("Cannot verify active visibility isolation rules");
      }
      const trackedElements = new Map<Element, Set<string>>();
      const mutationTracker: IVisibilityIsolationMutationTracker = { changed: false, stop: () => undefined };
      const restorations: Array<() => void> = [];
      for (const { element, properties } of hiddenElements) {
        const names = new Set(properties.map(({ name }) => name));
        trackedElements.set(element, names);
        const style = (element as HTMLElement).style;
        const originalSetProperty = style.setProperty;
        const temporarySetProperty = function(this: CSSStyleDeclaration, property: string, value: string, priority?: string): void {
          originalSetProperty.call(this, property, value, priority);
          const normalizedPriority = priority?.trim().toLowerCase();
          if (this === style && names.has(property.trim().toLowerCase())
            && (normalizedPriority === undefined || normalizedPriority === "" || normalizedPriority === "important")) {
            mutationTracker.changed = true;
          }
        };
        const originalDescriptor = Object.getOwnPropertyDescriptor(style, "setProperty");
        Object.defineProperty(style, "setProperty", { configurable: true, value: temporarySetProperty });
        restorations.push(() => {
          if (style.setProperty !== temporarySetProperty) return;
          if (originalDescriptor === undefined) Reflect.deleteProperty(style, "setProperty");
          else Object.defineProperty(style, "setProperty", originalDescriptor);
        });
      }
      const propertyState = (style: CSSStyleDeclaration, name: string): { priority: string; value: string } => ({
        priority: style.getPropertyPriority(name),
        value: style.getPropertyValue(name),
      });
      const propertyStatesDiffer = (first: CSSStyleDeclaration, second: CSSStyleDeclaration, names: Set<string>): boolean => [...names].some((name) => {
        const firstState = propertyState(first, name);
        const secondState = propertyState(second, name);
        return firstState.value !== secondState.value || firstState.priority !== secondState.priority;
      });
      const styleFromText = (text: string | null): CSSStyleDeclaration => {
        const style = document.createElement("span").style;
        style.cssText = text ?? "";
        return style;
      };
      const trackElementMutationRecords = (
        element: Element,
        elementRecords: readonly MutationRecord[],
        names: Set<string>,
      ): void => {
        elementRecords.forEach((record, index) => {
          const nextRecord = elementRecords[index + 1];
          const before = styleFromText(record.oldValue);
          const after = styleFromText(nextRecord === undefined ? element.getAttribute("style") : nextRecord.oldValue);
          if (propertyStatesDiffer(before, after, names)) mutationTracker.changed = true;
        });
      };
      const mutationRecords = (records: readonly MutationRecord[]): void => {
        for (const element of trackedElements.keys()) {
          const names = trackedElements.get(element);
          if (names === undefined) continue;
          const elementRecords = records.filter((record) => record.type === "attributes"
            && record.attributeName === "style"
            && record.target === element);
          if (elementRecords.length === 0) continue;
          trackElementMutationRecords(element, elementRecords, names);
        }
      };
      const observer = trackedElements.size === 0 || typeof MutationObserver === "undefined"
        ? undefined
        : new MutationObserver(mutationRecords);
      let tracking = true;
      const stop = (): void => {
        if (!tracking) return;
        tracking = false;
        if (observer !== undefined) {
          mutationRecords(observer.takeRecords());
          observer.disconnect();
        }
        for (let index = restorations.length - 1; index >= 0; index -= 1) restorations[index]?.();
      };
      stopMutationTracking = stop;
      if (observer !== undefined) {
        for (const element of trackedElements.keys()) {
          observer.observe(element, { attributeFilter: ["style"], attributeOldValue: true, attributes: true });
        }
      }
      mutationTracker.stop = stop;
      (window as unknown as Record<string, IVisibilityIsolationState>)[isolationKey] = {
        elements: markedElements,
        hiddenElements,
        markerAttribute,
        mutationTracker,
        probe: isolationProbe,
        probeAttribute,
        style: isolationStyle,
      };
      return {
        bounds,
        clip: { height: bottom - top, width: right - left, x: left, y: top },
        isolationKey,
        rendered: true,
      };
    } catch (error) {
      const cleaned = cleanupIsolation();
      const reason = error instanceof Error ? error.message : "temporary visibility isolation could not be verified";
      return {
        bounds,
        isolationFailure: cleaned ? reason : `${reason}; temporary isolation cleanup was incomplete`,
        rendered: false,
      };
    }
  }, { isolationKey, requestedTarget: target }).catch(() => undefined);

  if (domSample?.isolationFailure !== undefined) {
    const targetDescription = target.id === undefined ? `selector '${target.selector ?? ""}'` : `id '${target.id}'`;
    throw new PlaytestBridgeError(playtestDiagnostic(
      "TN_PLAYTEST_OBSERVATION_UNAVAILABLE",
      `Could not verify DOM visibility isolation for ${targetDescription}: ${domSample.isolationFailure}.`,
      "Allow the playtest's temporary visibility styles, or remove the page policy that blocks them, then rerun the playtest.",
    ));
  }
  if (domSample === undefined || !domSample.rendered || domSample.clip === undefined) {
    return { ...(domSample?.bounds === undefined ? {} : { bounds: domSample.bounds }), rendered: false };
  }
  if (domSample.isolationKey === undefined) return { bounds: domSample.bounds, rendered: false };
  let screenshot: Buffer | undefined;
  let cleanupResult: IVisibilityIsolationCleanupResult | undefined;
  try {
    screenshot = await page.screenshot({ clip: domSample.clip, omitBackground: true });
  } catch {
    screenshot = undefined;
  } finally {
    cleanupResult = await page.evaluate((key): IVisibilityIsolationCleanupResult => {
      const state = (window as unknown as Record<string, IVisibilityIsolationState | undefined>)[key];
      if (state === undefined) return { cleaned: false, isolationIntact: false };
      let isolationIntact = true;
      try {
        state.mutationTracker.stop();
      } catch {
        isolationIntact = false;
      }
      if (state.mutationTracker.changed) isolationIntact = false;
      for (const { element, properties } of state.hiddenElements) {
        try {
          const inlineStyle = (element as HTMLElement).style;
          for (const property of properties) {
            if (inlineStyle.getPropertyValue(property.name) === property.temporaryValue
              && inlineStyle.getPropertyPriority(property.name) === property.temporaryPriority) continue;
            isolationIntact = false;
          }
        } catch {
          isolationIntact = false;
        }
      }
      let cleaned = true;
      try {
        state.style.remove();
      } catch {
        cleaned = false;
      }
      for (const element of state.elements) {
        try {
          element.removeAttribute(state.markerAttribute);
        } catch {
          cleaned = false;
        }
      }
      for (const { element, properties } of state.hiddenElements) {
        try {
          const inlineStyle = (element as HTMLElement).style;
          for (const property of properties) {
            if (inlineStyle.getPropertyValue(property.name) !== property.temporaryValue
              || inlineStyle.getPropertyPriority(property.name) !== property.temporaryPriority) continue;
            if (property.originalValue === "") inlineStyle.removeProperty(property.name);
            else inlineStyle.setProperty(property.name, property.originalValue, property.originalPriority);
          }
        } catch {
          cleaned = false;
        }
      }
      try {
        state.probe.removeAttribute(state.probeAttribute);
      } catch {
        cleaned = false;
      }
      try {
        state.probe.removeAttribute("style");
      } catch {
        cleaned = false;
      }
      try {
        state.probe.remove();
      } catch {
        cleaned = false;
      }
      try {
        delete (window as unknown as Record<string, IVisibilityIsolationState | undefined>)[key];
      } catch {
        cleaned = false;
      }
      return { cleaned, isolationIntact };
    }, domSample.isolationKey).catch(() => undefined);
  }
  if (cleanupResult?.isolationIntact !== true) {
    throw new PlaytestBridgeError(playtestDiagnostic(
      "TN_PLAYTEST_OBSERVATION_UNAVAILABLE",
      "Temporary DOM visibility isolation changed while sampling; the rendered-pixel observation is unavailable.",
      "Keep page-owned visibility and root background styles stable while playtest sampling runs, then rerun the playtest.",
    ));
  }
  if (cleanupResult.cleaned !== true) {
    throw new PlaytestBridgeError(playtestDiagnostic(
      "TN_PLAYTEST_OBSERVATION_UNAVAILABLE",
      "Could not restore temporary DOM visibility isolation after sampling.",
      "Rerun the playtest after ensuring the target page permits temporary DOM attribute and style restoration.",
    ));
  }
  return {
    bounds: domSample.bounds,
    rendered: screenshot !== undefined && containsPaintedPixels(screenshot),
  };
}

function containsPaintedPixels(screenshot: Buffer): boolean {
  try {
    const png = PNG.sync.read(screenshot);
    for (let offset = 0; offset < png.data.length; offset += 4) {
      if ((png.data[offset + 3] ?? 0) > 0) return true;
    }
  } catch {
    return false;
  }
  return false;
}

export async function sampleHud(page: Page, assertions: readonly IPlaytestPathAssertion[]): Promise<Record<string, unknown>> {
  if (assertions.length === 0) return {};
  const snapshots: Record<string, unknown> = await page.evaluate((requestedAssertions) => Object.fromEntries(requestedAssertions.flatMap(({ id, path }) => {
    const element = path === undefined
      ? document.getElementById(id)
      : (() => {
          try {
            return document.querySelector(path);
          } catch {
            return null;
          }
        })();
    if (element === null) return [];
    const text = element.textContent?.trim() ?? "";
    const rawValue = element.getAttribute("data-value");
    const value = rawValue === null ? undefined : Number.isFinite(Number(rawValue)) ? Number(rawValue) : rawValue;
    const snapshot = value === undefined ? text : value;
    return [[id, path === undefined ? snapshot : { [path]: snapshot }] as const];
  })), assertions);
  for (const assertion of assertions) {
    if (assertion.visible === undefined || !Object.hasOwn(snapshots, assertion.id)) continue;
    const visibility = await sampleElementVisibility(
      page,
      assertion.path === undefined ? { id: assertion.id } : { selector: assertion.path },
    );
    const snapshot = snapshots[assertion.id];
    if (assertion.path === undefined) {
      snapshots[assertion.id] = { text: snapshot, visible: visibility.rendered };
      continue;
    }
    const pathSnapshot = typeof snapshot === "object" && snapshot !== null && !Array.isArray(snapshot)
      ? (snapshot as Record<string, unknown>)[assertion.path]
      : snapshot;
    snapshots[assertion.id] = { [assertion.path]: { text: pathSnapshot, visible: visibility.rendered } };
  }
  return snapshots;
}

export function pairObservations(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { after?: unknown; before?: unknown }> {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  return Object.fromEntries([...ids].map((id) => [id, {
    ...(before[id] === undefined ? {} : { before: before[id] }),
    ...(after[id] === undefined ? {} : { after: after[id] }),
  }]));
}

export function observedMovementSample(
  samples: readonly IMovementSampleInterval[],
): { after: IPlaytestObservationSnapshot; before: IPlaytestObservationSnapshot; entity: string } | undefined {
  const inputOff = samples.filter(({ inputDriven }) => !inputDriven);
  if (inputOff.length === 0) return undefined;
  return samples
    .filter(({ inputDriven }) => inputDriven)
    .flatMap((sample) => observedMovementEntities(sample.before, sample.after).flatMap(({ id, distance }) => {
      const inputOffBaseline = inputOff.every((offSample) => {
        const offEntity = observedMovementEntities(offSample.before, offSample.after).find(({ id: offId }) => offId === id);
        return offEntity !== undefined && offEntity.distance === 0 && movementRate(offSample, id) !== undefined;
      });
      const inputOnRate = movementRate(sample, id);
      return !inputOffBaseline || inputOnRate === undefined || inputOnRate <= 0
        ? []
        : [{ ...sample, distance, entity: id, contrast: inputOnRate }];
    }))
    .sort((left, right) => right.distance - left.distance || right.contrast - left.contrast || left.entity.localeCompare(right.entity))[0];
}

export function observedMovementEntities(
  before: IPlaytestObservationSnapshot,
  after: IPlaytestObservationSnapshot,
): Array<{ distance: number; id: string }> {
  const beforeEntities = new Map(
    (before.entities ?? [])
      .filter(({ transform }) => transform?.position !== undefined)
      .map(({ id, transform }) => [id, transform!.position!] as const),
  );
  return (after.entities ?? []).flatMap((entity) => {
    const beforePosition = beforeEntities.get(entity.id);
    const afterPosition = entity.transform?.position;
    return beforePosition === undefined || afterPosition === undefined || entity.visible === false
      ? []
      : [{ distance: length(subtract(afterPosition, beforePosition)), id: entity.id }];
  });
}

export function movementRate(sample: IMovementSampleInterval, entity: string): number | undefined {
  const beforePosition = entityPosition(sample.before, entity);
  const afterPosition = entityPosition(sample.after, entity);
  if (beforePosition === undefined || afterPosition === undefined) return undefined;
  const duration = movementDuration(sample);
  return duration === undefined ? undefined : length(subtract(afterPosition, beforePosition)) / duration;
}

export function movementDuration(sample: IMovementSampleInterval): number | undefined {
  if (sample.before.clock.mode !== sample.after.clock.mode) return undefined;
  const duration = sample.before.clock.mode === "fixed-step"
    ? positiveFiniteDelta(sample.before.clock.tick, sample.after.clock.tick)
    : positiveFiniteDelta(sample.before.clock.timeMs, sample.after.clock.timeMs);
  return duration;
}

export function positiveFiniteDelta(before: number | undefined, after: number | undefined): number | undefined {
  if (
    typeof before !== "number"
    || typeof after !== "number"
    || !Number.isFinite(before)
    || !Number.isFinite(after)
  ) return undefined;
  const delta = after - before;
  return Number.isFinite(delta) && delta > 0 ? delta : undefined;
}

export function entityRotation(snapshot: IPlaytestObservationSnapshot | undefined, id: string): [number, number, number, number] | undefined {
  return snapshot?.entities?.find((entity) => entity.id === id)?.transform?.rotation;
}

export function resourceObservations(before: IPlaytestObservationSnapshot | undefined, after: IPlaytestObservationSnapshot | undefined) {
  const ids = new Set([...Object.keys(before?.resources ?? {}), ...Object.keys(after?.resources ?? {})]);
  return Object.fromEntries([...ids].map((id) => [id, { before: before?.resources?.[id], after: after?.resources?.[id] }]));
}

/**
 * A published diagnostic that is unmistakably a *readout* rather than an error.
 *
 * The bridge's `diagnostics` channel is typed `() => JsonValue[]` and the generated project
 * AGENTS.md says it "returns current runtime diagnostics", so a game publishes its debug HUD
 * through it — that is the documented use. Every entry then landed in `recentRuntimeErrors`, and
 * a proof with `noRuntimeDiagnostics` failed the build for owning a frame counter. Round 9 lost
 * a sealed scenario to `{id:"fps",label:"FPS",value:30}` being counted as a runtime error.
 *
 * This does **not** guess. Ambiguous entries stay errors, because this package fails closed and
 * an error counter that quietly stops counting is the exact defect it exists to prevent. Only
 * the unambiguous readout shape — a labelled scalar, carrying no error marker — is reclassified,
 * and nothing is dropped: readouts move to `runtimeReadouts` on the same object and stay observable.
 */
export function isRuntimeReadout(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
  const record = entry as Record<string, unknown>;
  if (record.severity === "error" || record.error !== undefined) return false;
  if (typeof record.type === "string" && ["assert", "error", "pageerror"].includes(record.type)) return false;
  const value = record.value;
  return (
    typeof record.label === "string"
    && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
  );
}

export function normalizedRuntimeDiagnostics(
  snapshot: IPlaytestObservationSnapshot | undefined,
  scenario: IPlaytestScenario,
  consoleEntries: IRunnerConsoleEntry[],
): { recentRuntimeErrors: unknown[]; runtimeReadouts: unknown[]; scene: { renderedEntities: unknown[] } } {
  const published = snapshot?.diagnostics ?? [];
  return {
    recentRuntimeErrors: [
      ...published.filter((entry) => !isRuntimeReadout(entry)),
      ...consoleEntries.filter(({ source, type }) => source !== "browser-console" && ["assert", "error", "pageerror"].includes(type)),
    ],
    runtimeReadouts: published.filter(isRuntimeReadout),
    scene: {
      renderedEntities: (snapshot?.entities ?? []).map((entity) => ({
        id: entity.id,
        projectedBounds: entity.bounds === undefined ? undefined : pixelBoundsToNdc(entity.bounds, scenario.viewport),
        visible: entity.visible,
      })),
    },
  };
}

export async function readCaptureProvenance(
  page: Page,
  config: IStandalonePlaytestConfig,
  scenario: IPlaytestScenario,
): Promise<IPlaytestCaptureProvenance> {
  const observed = await page.evaluate(async () => {
    type Adapter = {
      features?: Iterable<string>;
      info?: Record<string, unknown>;
      limits?: Record<string, number | undefined>;
      requestAdapterInfo?: () => Promise<Record<string, unknown>>;
    };
    const gpu = (globalThis.navigator as Navigator & { gpu?: { requestAdapter(): Promise<Adapter | null> } }).gpu;
    const adapter = gpu === undefined ? null : await gpu.requestAdapter().catch(() => null);
    const infoCandidate = adapter?.info;
    const legacyInfo = await adapter?.requestAdapterInfo?.().catch(() => undefined);
    const info = infoCandidate === undefined || Object.keys(infoCandidate).length === 0
      ? legacyInfo ?? infoCandidate
      : infoCandidate;
    const adapterIdentityKeys = ["architecture", "description", "device", "vendor"];
    const adapterIdentityEntries: Array<[string, string]> = info === undefined
      ? []
      : adapterIdentityKeys.flatMap((key) => {
          const value = info[key];
          const text = String(value ?? "");
          return text.length === 0 ? [] : [[key, text]];
        });
    const webgpuAdapterEntries = [...adapterIdentityEntries];
    if (adapterIdentityEntries.length > 0 && adapter?.features !== undefined) {
      const features = [...adapter.features].map(String).sort();
      if (features.length > 0) webgpuAdapterEntries.push(["features", features.join(",")]);
    }
    if (adapterIdentityEntries.length > 0) {
      for (const key of ["maxBindGroups", "maxTextureDimension2D", "maxStorageBufferBindingSize"]) {
        const value = adapter?.limits?.[key];
        if (typeof value === "number" && Number.isFinite(value)) webgpuAdapterEntries.push([`limit.${key}`, String(value)]);
      }
    }
    const webgpuAdapterInfo = adapterIdentityEntries.length === 0
      ? undefined
      : Object.fromEntries(webgpuAdapterEntries);
    const canvas = document.querySelector("canvas");
    const engine = canvas?.getAttribute("data-engine")?.toLowerCase() ?? "";
    let rendererKind: "webgl" | "webgpu" | undefined;
    if (engine.includes("webgpu")) rendererKind = "webgpu";
    else if (engine.includes("webgl")) rendererKind = "webgl";
    else if (adapter !== null && canvas !== null) {
      try {
        if (canvas.getContext("webgpu") !== null) rendererKind = "webgpu";
      } catch {
        // A canvas can reject a second context request; the adapter and engine marker remain authoritative.
      }
    }
    let webglAdapterInfo: Record<string, string> | undefined;
    if (rendererKind === undefined || rendererKind === "webgl") {
      try {
        const context = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
        if (context !== null && context !== undefined) {
          rendererKind = "webgl";
          const debugInfo = context.getExtension("WEBGL_debug_renderer_info") as {
            UNMASKED_RENDERER_WEBGL: number;
            UNMASKED_VENDOR_WEBGL: number;
          } | null;
          const vendor = String(context.getParameter(debugInfo?.UNMASKED_VENDOR_WEBGL ?? context.VENDOR) ?? "");
          const renderer = String(context.getParameter(debugInfo?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER) ?? "");
          const webglEntries: Array<[string, string]> = [
            ["renderer", renderer],
            ["vendor", vendor],
          ];
          webglAdapterInfo = Object.fromEntries(webglEntries.filter(([, value]) => value.length > 0));
        }
      } catch {
        // Report the missing renderer or adapter below instead of guessing.
      }
    }
    return {
      adapter: rendererKind === "webgl" ? webglAdapterInfo : webgpuAdapterInfo,
      rendererKind,
    };
  });
  if (observed.adapter === undefined || Object.keys(observed.adapter).length === 0) {
    throw new PlaytestBridgeError(playtestDiagnostic(
      "TN_PLAYTEST_CAPTURE_PROVENANCE_MISSING",
      `Visual capture could not read a renderer adapter description (kind=${observed.rendererKind ?? "unknown"}).`,
      "Run the visual playtest with a working GPU/WebGPU adapter or WebGL renderer; the runner will not write unknown adapter provenance.",
    ));
  }
  if (observed.rendererKind === undefined) {
    throw new PlaytestBridgeError(playtestDiagnostic(
      "TN_PLAYTEST_CAPTURE_PROVENANCE_MISSING",
      "Visual capture could not identify the page renderer kind.",
      "Expose a WebGPU/WebGL canvas before capturing the visual artifact, then rerun the playtest.",
    ));
  }
  return {
    adapter: observed.adapter,
    browserArgs: resolveBrowserArguments(config.browserArgs),
    captureMethod: "page.screenshot",
    rendererKind: observed.rendererKind,
    target: scenario.target,
    viewport: { ...scenario.viewport },
  };
}
