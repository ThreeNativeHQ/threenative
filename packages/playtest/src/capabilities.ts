export type PlaytestCapability =
  | "browser.canvas"
  | "browser.console"
  | "browser.dom"
  | "browser.input"
  | "browser.network"
  | "browser.screenshot"
  | "browser.trace"
  | "camera.observe"
  | "entity.bounds"
  | "entity.observe"
  | "entity.setup"
  | "runtime.animation"
  | "runtime.components"
  | "runtime.contacts"
  | "runtime.diagnostics"
  | "runtime.events"
  | "runtime.fixedStep"
  | "runtime.physics"
  | "runtime.resources"
  | "runtime.state"
  | "runtime.tags"
  | "runtime.ui"
  | "runtime.world";

export interface IPlaytestCapabilityDescriptor {
  description: string;
  name: PlaytestCapability;
  protocolVersion: 1;
}

export const PLAYTEST_CAPABILITY_REGISTRY: readonly IPlaytestCapabilityDescriptor[] = [
  capability("browser.canvas", "Samples canvas pixels and health."),
  capability("browser.console", "Captures browser console and page errors."),
  capability("browser.dom", "Reads bounded DOM observations."),
  capability("browser.input", "Delivers keyboard and pointer input."),
  capability("browser.network", "Captures failed browser requests."),
  capability("browser.screenshot", "Captures viewport screenshots."),
  capability("browser.trace", "Captures a bounded Playwright trace."),
  capability("camera.observe", "Samples the active camera transform and projection."),
  capability("entity.bounds", "Projects registered entity bounds into the viewport."),
  capability("entity.observe", "Samples registered entity transforms and visibility."),
  capability("entity.setup", "Applies bounded transforms to registered entities."),
  capability("runtime.animation", "Samples application-owned animation state."),
  capability("runtime.components", "Samples registered JSON-safe component state."),
  capability("runtime.contacts", "Samples bounded collision and trigger contacts."),
  capability("runtime.diagnostics", "Samples application-owned runtime diagnostics."),
  capability("runtime.events", "Drains bounded application event observations."),
  capability("runtime.fixedStep", "Advances an application-owned deterministic tick."),
  capability("runtime.physics", "Samples bounded application-owned physics observations."),
  capability("runtime.resources", "Reads and writes registered JSON-safe application state."),
  capability("runtime.state", "Samples application-owned state-machine state."),
  capability("runtime.tags", "Samples bounded application-owned entity tags."),
  capability("runtime.ui", "Samples registered JSON-safe UI and HUD state."),
  capability("runtime.world", "Samples bounded runtime world metadata."),
];

const KNOWN_CAPABILITIES = new Set<string>(PLAYTEST_CAPABILITY_REGISTRY.map(({ name }) => name));

export function unknownPlaytestCapabilities(capabilities: readonly string[]): string[] {
  return capabilities.filter((name) => !KNOWN_CAPABILITIES.has(name));
}

export function missingPlaytestCapabilities(required: readonly string[], available: readonly string[]): string[] {
  const availableSet = new Set(available);
  return [...new Set(required)].filter((name) => !availableSet.has(name)).sort();
}

function capability(name: PlaytestCapability, description: string): IPlaytestCapabilityDescriptor {
  return { description, name, protocolVersion: 1 };
}
