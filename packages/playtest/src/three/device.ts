import {
  PLAYTEST_PROTOCOL_LIMITS,
  assertJsonSafe,
  jsonByteLength,
  type IPlaytestBridgeV1,
  type IPlaytestDeviceRequest,
  type IPlaytestDeviceResponse,
  type JsonValue,
} from "../index.js";

const BRIDGE_METHODS = new Set<keyof IPlaytestBridgeV1>([
  "advance",
  "applySetup",
  "describe",
  "drainEvents",
  "focus",
  "ready",
  "sample",
]);

export interface IDeviceBridgeInstallation {
  close(): void;
}

export function connectDevicePlaytestBridge(
  bridge: IPlaytestBridgeV1,
  endpoint: string,
): IDeviceBridgeInstallation {
  const nativeInstallation = connectNativeMailbox(bridge);
  if (nativeInstallation !== undefined) return nativeInstallation;
  let closed = false;
  let reportedError = false;
  let scheduled: number | ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    if (closed) return;
    if (typeof globalThis.requestAnimationFrame === "function") {
      scheduled = globalThis.requestAnimationFrame(() => void poll());
    } else {
      scheduled = setTimeout(() => void poll(), 50);
    }
  };
  const poll = async (): Promise<void> => {
    if (closed) return;
    try {
      const response = await fetch(endpoint);
      if (response.status !== 204) {
        if (!response.ok) throw new Error(`Device bridge poll failed with HTTP ${response.status}.`);
        const request = parseRequest(await response.json());
        await postResponse(endpoint, await dispatch(bridge, request));
      }
    } catch (error) {
      if (!reportedError) {
        reportedError = true;
        console.error(`TN_PLAYTEST_DEVICE_TRANSPORT: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      schedule();
    }
  };
  schedule();
  return {
    close: () => {
      closed = true;
      if (scheduled === undefined) return;
      if (typeof globalThis.cancelAnimationFrame === "function" && typeof scheduled === "number") {
        globalThis.cancelAnimationFrame(scheduled);
      } else clearTimeout(scheduled);
    },
  };
}

function connectNativeMailbox(bridge: IPlaytestBridgeV1): IDeviceBridgeInstallation | undefined {
  const globals = globalThis as typeof globalThis & {
    TN_PLAYTEST_MAILBOX?: { request?: unknown; response?: unknown };
    __THREENATIVE_NATIVE__?: {
      playtest?: {
        receive?(path: string): string | undefined;
        respond?(path: string, payload: string): boolean;
      };
    };
  };
  const mailbox = globals.TN_PLAYTEST_MAILBOX;
  const host = globals.__THREENATIVE_NATIVE__?.playtest;
  if (
    typeof mailbox?.request !== "string"
    || typeof mailbox.response !== "string"
    || typeof host?.receive !== "function"
    || typeof host.respond !== "function"
  ) return undefined;
  let closed = false;
  let frame: number | undefined;
  const respond = (response: IPlaytestDeviceResponse): void => {
    if (!host.respond!(mailbox.response as string, JSON.stringify(response))) {
      console.error("TN_PLAYTEST_DEVICE_TRANSPORT: native mailbox response failed");
    }
  };
  const poll = (): void => {
    if (closed) return;
    const raw = host.receive!(mailbox.request as string);
    if (raw !== undefined) {
      try {
        const request = parseRequest(JSON.parse(raw));
        void dispatch(bridge, request).then(respond);
      } catch (error) {
        respond({
          error: { message: error instanceof Error ? error.message : String(error) },
          id: "invalid",
        });
      }
    }
    frame = globalThis.requestAnimationFrame(poll);
  };
  respond({ id: "ready", result: null });
  frame = globalThis.requestAnimationFrame(poll);
  return {
    close: () => {
      closed = true;
      if (frame !== undefined) globalThis.cancelAnimationFrame(frame);
    },
  };
}

export function readPlaytestEndpoint(): string | undefined {
  const value = (globalThis as typeof globalThis & { TN_PLAYTEST_ENDPOINT?: unknown })
    .TN_PLAYTEST_ENDPOINT;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function dispatch(
  bridge: IPlaytestBridgeV1,
  request: IPlaytestDeviceRequest,
): Promise<IPlaytestDeviceResponse> {
  try {
    if (request.method.startsWith("input.")) {
      return { id: request.id, result: dispatchInput(request.method, request.argument) };
    }
    if (!BRIDGE_METHODS.has(request.method as keyof IPlaytestBridgeV1)) {
      throw new Error(`Bridge operation '${request.method}' is unavailable.`);
    }
    const operation = bridge[request.method as keyof IPlaytestBridgeV1] as
      | ((this: IPlaytestBridgeV1, argument: never) => unknown)
      | undefined;
    if (typeof operation !== "function") throw new Error(`Bridge operation '${request.method}' is unavailable.`);
    const result = await operation.call(bridge, request.argument as never);
    if (result !== undefined) assertBounded(result);
    return { id: request.id, ...(result === undefined ? {} : { result: result as JsonValue }) };
  } catch (error) {
    return { error: { message: error instanceof Error ? error.message : String(error) }, id: request.id };
  }
}

function dispatchInput(method: string, argument: JsonValue | undefined): JsonValue {
  const host = (globalThis as typeof globalThis & {
    __THREENATIVE_NATIVE__?: {
      playtestInput?: {
        keyboard?(type: string, key: string, code: string): void;
        pointer?(type: string, x: number, y: number, buttons: number): void;
      };
    };
  }).__THREENATIVE_NATIVE__?.playtestInput;
  if (!isRecord(argument)) throw new Error(`Device ${method} requires an object argument.`);
  if (method === "input.keyDown" || method === "input.keyUp") {
    if (typeof argument.key !== "string") throw new Error(`Device ${method} requires a key.`);
    const code = argument.key;
    const key = /^Key[A-Z]$/u.test(code) ? code.slice(3).toLowerCase() : code;
    if (typeof host?.keyboard !== "function") throw new Error("Native playtest keyboard input is unavailable.");
    host.keyboard(method === "input.keyDown" ? "keydown" : "keyup", key, code);
    return null;
  }
  if (method === "input.pointer") {
    if (typeof argument.x !== "number" || typeof argument.y !== "number" || typeof argument.buttons !== "number") {
      throw new Error("Device input.pointer requires numeric x, y, and buttons.");
    }
    if (typeof host?.pointer !== "function") throw new Error("Native playtest pointer input is unavailable.");
    const type = argument.type === "down" ? "pointerdown" : argument.type === "up" ? "pointerup" : "pointermove";
    host.pointer(type, argument.x, argument.y, argument.buttons);
    return null;
  }
  throw new Error(`Device input operation '${method}' is unavailable.`);
}

function parseRequest(value: unknown): IPlaytestDeviceRequest {
  assertBounded(value);
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.method !== "string") {
    throw new Error("Device request must contain string id and method fields.");
  }
  return value as unknown as IPlaytestDeviceRequest;
}

async function postResponse(endpoint: string, response: IPlaytestDeviceResponse): Promise<void> {
  const result = await fetch(endpoint, {
    body: JSON.stringify(response),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!result.ok) throw new Error(`Device bridge response failed with HTTP ${result.status}.`);
}

function assertBounded(value: unknown): void {
  assertJsonSafe(value);
  if (jsonByteLength(value) > PLAYTEST_PROTOCOL_LIMITS.maxPayloadBytes) {
    throw new Error(`Device bridge payload exceeds ${PLAYTEST_PROTOCOL_LIMITS.maxPayloadBytes} bytes.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
