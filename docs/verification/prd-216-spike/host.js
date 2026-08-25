// Phase 0 spike: the smallest honest react-reconciler host config.
// Nodes are plain objects here so the probe measures React, not Three.js.
import ReactReconciler from "react-reconciler";
import { DefaultEventPriority, NoEventPriority } from "react-reconciler/constants.js";

export const stats = { creates: 0, updates: 0, appends: 0, removes: 0, commits: 0 };

function makeNode(type, props) {
  stats.creates += 1;
  return { type, props: { ...props, children: undefined }, children: [] };
}

let currentPriority = NoEventPriority;

const config = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: false,
  noTimeout: -1,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,

  createInstance: (type, props) => makeNode(type, props),
  createTextInstance: (text) => ({ type: "#text", text, children: [] }),
  shouldSetTextContent: () => false,
  getPublicInstance: (instance) => instance,
  getRootHostContext: () => null,
  getChildHostContext: (parent) => parent,

  appendInitialChild: (parent, child) => {
    stats.appends += 1;
    parent.children.push(child);
  },
  appendChild: (parent, child) => {
    stats.appends += 1;
    parent.children.push(child);
  },
  appendChildToContainer: (container, child) => {
    stats.appends += 1;
    container.children.push(child);
  },
  insertBefore: (parent, child, before) => {
    parent.children.splice(parent.children.indexOf(before), 0, child);
  },
  insertInContainerBefore: (container, child, before) => {
    container.children.splice(container.children.indexOf(before), 0, child);
  },
  removeChild: (parent, child) => {
    stats.removes += 1;
    parent.children.splice(parent.children.indexOf(child), 1);
  },
  removeChildFromContainer: (container, child) => {
    stats.removes += 1;
    container.children.splice(container.children.indexOf(child), 1);
  },
  clearContainer: (container) => {
    container.children.length = 0;
  },
  finalizeInitialChildren: () => false,
  commitUpdate: (instance, type, prevProps, nextProps) => {
    stats.updates += 1;
    instance.props = { ...nextProps, children: undefined };
  },
  commitTextUpdate: (instance, _old, next) => {
    instance.text = next;
  },

  prepareForCommit: () => null,
  resetAfterCommit: () => {
    stats.commits += 1;
  },
  preparePortalMount: () => undefined,
  detachDeletedInstance: () => undefined,
  beforeActiveInstanceBlur: () => undefined,
  afterActiveInstanceBlur: () => undefined,
  prepareScopeUpdate: () => undefined,
  getInstanceFromNode: () => null,
  getInstanceFromScope: () => null,

  setCurrentUpdatePriority: (priority) => {
    currentPriority = priority;
  },
  getCurrentUpdatePriority: () => currentPriority,
  resolveUpdatePriority: () =>
    currentPriority !== NoEventPriority ? currentPriority : DefaultEventPriority,
  getCurrentEventPriority: () => DefaultEventPriority,

  shouldAttemptEagerTransition: () => false,
  requestPostPaintCallback: () => undefined,
  maySuspendCommit: () => false,
  preloadInstance: () => true,
  startSuspendingCommit: () => undefined,
  suspendInstance: () => undefined,
  waitForCommitToBeReady: () => null,
  resetFormInstance: () => undefined,
  trackSchedulerEvent: () => undefined,
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
  // biome-ignore lint/style/useNamingConvention: exact React reconciler host API name.
  NotPendingTransition: null,
  // biome-ignore lint/style/useNamingConvention: exact React reconciler host API name.
  HostTransitionContext: {
    $$typeof: Symbol.for("react.context"),
    // biome-ignore lint/style/useNamingConvention: exact React context API name.
    Provider: null,
    // biome-ignore lint/style/useNamingConvention: exact React context API name.
    Consumer: null,
    _currentValue: null,
    _currentValue2: null,
    _threadCount: 0,
  },
};

export const reconciler = ReactReconciler(config);

export function createRootContainer() {
  const container = { type: "#root", children: [] };
  const root = reconciler.createContainer(
    container,
    0, // LegacyRoot=0 / ConcurrentRoot=1
    null,
    false,
    null,
    "tn",
    (error) => {
      throw error;
    },
    null,
  );
  return { container, root };
}
