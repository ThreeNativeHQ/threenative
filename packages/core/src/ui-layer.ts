/**
 * The UI layer's platform seam: one bridge and one hit-region protocol, host-independent.
 *
 * A game's `src/ui/` renders through the platform's own browser-class renderer on every
 * target — react-dom, Tailwind, CSS, SVG and fonts unchanged. Everything the UI needs from
 * the game and everything the game needs from the UI crosses through here.
 *
 * @see ./ui-bridge.js for the message channel, ./ui-hit-regions.js for the input protocol.
 */
export {
  GAME_STATE_MESSAGE,
  HIT_REGIONS_MESSAGE,
  UI_BRIDGE_GLOBALS,
  UI_INTENT_MESSAGE,
  connectUiBridge,
  type IUiBridge,
  type IUiMessage,
  type UiBridgeEnd,
  type UiBridgeTransport,
} from "./ui-bridge.js";
export {
  onUiIntent,
  publishUiState,
  sendUiIntent,
  subscribeUiState,
  type IPublishableStore,
  type IUiStateMirror,
  type IUiStatePublisher,
} from "./ui-state.js";
export {
  INTERACTIVE_ATTRIBUTE,
  publishHitRegions,
  type IHitRegion,
  type IHitRegionRegistry,
} from "./ui-hit-regions.js";
