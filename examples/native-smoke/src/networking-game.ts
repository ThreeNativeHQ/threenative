import { type INetworkConnection, type INetworkOptions, connect } from "@threenative/core/net";

export interface INetworkingConfig {
  readonly enabled: boolean;
  readonly endpoint?: string;
  readonly issuerUrl?: string;
  readonly room?: string;
  readonly playerId?: string;
}

export type NetworkingStatus = "disabled" | "connecting" | "connected" | "disconnected";

export interface INetworkingState extends Record<string, unknown> {
  networkConnected: boolean;
  networkError: string;
  networkRetry: number;
  networkSessionId: string;
  networkStatus: NetworkingStatus;
}

interface INetworkingStore<TState extends INetworkingState> {
  getState(): TState;
  set(patch: Partial<TState>): void;
  flush(): void;
}

export interface INetworkingGame<TState extends INetworkingState> {
  enter(store: INetworkingStore<TState>): void;
  update(store: INetworkingStore<TState>): void;
  retry(): void;
  exit(): void;
}

interface IStagedGrant {
  readonly expiresAt: string;
  readonly issuerAuthorization: string;
}

interface IIssuedCredential {
  readonly credential: string;
  readonly expiresAt: string;
}

const NETWORK_SESSION_ASSET = "networking-session.json";
const APPLICATION_PROTOCOL = "threenative-smoke/1";
const CHANNELS = [
  { id: 1, delivery: "unreliable" },
  { id: 2, delivery: "unreliable" },
  { id: 3, delivery: "reliable-ordered" },
  { id: 4, delivery: "reliable-ordered" },
] as const;

function invalid(message: string): Error {
  return new Error(`TN_NETWORK_CONFIG: ${message}`);
}

function parseObject(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw invalid(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function parseHttpsUrl(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw invalid(`${name} must be an HTTPS URL`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw invalid(`${name} must be an HTTPS URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash)
    throw invalid(`${name} must be an HTTPS URL without credentials or a fragment`);
  return parsed.toString();
}

function parseNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw invalid(`${name} must be a nonempty string`);
  return value;
}

function parseExpiry(value: unknown, name: string, maximumMs: number): string {
  if (typeof value !== "string") throw new Error(`TN_NETWORK_AUTH: ${name} is missing`);
  const expiresAt = Date.parse(value);
  const now = Date.now();
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + maximumMs)
    throw new Error(`TN_NETWORK_AUTH: ${name} is expired or outside its validity window`);
  return value;
}

function stagedGrant(value: unknown): IStagedGrant {
  const record = parseObject(value, "networking session");
  if (Object.keys(record).sort().join(",") !== "expiresAt,issuerAuthorization")
    throw new Error("TN_NETWORK_AUTH: networking session has unexpected keys");
  return {
    expiresAt: parseExpiry(record.expiresAt, "grant expiry", 15 * 60 * 1000),
    issuerAuthorization: parseNonEmptyString(record.issuerAuthorization, "grant authorization"),
  };
}

function issuedCredential(value: unknown): IIssuedCredential {
  const record = parseObject(value, "issuer response");
  if (Object.keys(record).sort().join(",") !== "credential,expiresAt")
    throw new Error("TN_NETWORK_AUTH: issuer response has unexpected keys");
  return {
    credential: parseNonEmptyString(record.credential, "issued credential"),
    expiresAt: parseExpiry(record.expiresAt, "join-token expiry", 65 * 1000),
  };
}

async function readJson(response: Response, name: string): Promise<unknown> {
  if (!response.ok) throw new Error(`TN_NETWORK_AUTH: ${name} returned HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error(`TN_NETWORK_AUTH: ${name} returned invalid JSON`);
  }
}

async function issueCredential(config: INetworkingConfig): Promise<string> {
  if (!config.enabled || config.issuerUrl === undefined || config.playerId === undefined)
    throw invalid("enabled networking requires issuerUrl and playerId");
  const grantResponse = await fetch(NETWORK_SESSION_ASSET);
  const grant = stagedGrant(await readJson(grantResponse, "networking session"));
  const response = await fetch(config.issuerUrl, {
    body: JSON.stringify({ playerId: config.playerId }),
    headers: {
      Authorization: `Bearer ${grant.issuerAuthorization}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  return issuedCredential(await readJson(response, "credential issuer")).credential;
}

function publicFailure(): string {
  return "network connection failed; press Retry";
}

function patch<TState extends INetworkingState>(
  store: INetworkingStore<TState>,
  values: Partial<INetworkingState>,
): void {
  store.set(values as Partial<TState>);
  store.flush();
}

export function createNetworkingGame<TState extends INetworkingState>(
  config: INetworkingConfig,
): INetworkingGame<TState> {
  let connection: INetworkConnection | undefined;
  let connecting: Promise<void> | undefined;
  let generation = 0;
  let closed = true;
  let retryRequested = false;

  const start = (store: INetworkingStore<TState>, retry: boolean): void => {
    if (!config.enabled || connecting !== undefined || !closed) return;
    closed = false;
    const run = ++generation;
    const current = store.getState();
    patch(store, {
      networkConnected: false,
      networkError: "",
      networkRetry: retry ? current.networkRetry + 1 : current.networkRetry,
      networkSessionId: "",
      networkStatus: "connecting",
    });
    const work = issueCredential(config).then((credential) => {
      if (run !== generation || closed || config.endpoint === undefined)
        throw new Error("TN_NETWORK_AUTH: connection was canceled");
      const options: INetworkOptions = {
        applicationProtocol: APPLICATION_PROTOCOL,
        channels: CHANNELS,
        credential,
      };
      return connect(config.endpoint, options);
    });
    connecting = work
      .then((opened) => {
        if (run !== generation || closed) {
          void opened.close();
          return;
        }
        connection = opened;
        patch(store, {
          networkConnected: true,
          networkError: "",
          networkSessionId: opened.getStats().sessionId,
          networkStatus: "connected",
        });
      })
      .catch(() => {
        if (run !== generation || closed) return;
        patch(store, {
          networkConnected: false,
          networkError: publicFailure(),
          networkSessionId: "",
          networkStatus: "disconnected",
        });
      })
      .finally(() => {
        if (run === generation) connecting = undefined;
      });
  };

  return {
    enter(store) {
      closed = true;
      retryRequested = false;
      if (!config.enabled) {
        patch(store, {
          networkConnected: false,
          networkError: "",
          networkSessionId: "",
          networkStatus: "disabled",
        });
        return;
      }
      start(store, false);
    },
    update(store) {
      if (retryRequested && connecting === undefined) {
        retryRequested = false;
        const previous = connection;
        connection = undefined;
        if (previous !== undefined) void previous.close();
        closed = true;
        start(store, true);
      }
      const active = connection;
      if (active === undefined) return;
      const batch = active.poll();
      if (!batch.disconnected) return;
      connection = undefined;
      closed = true;
      patch(store, {
        networkConnected: false,
        networkError: publicFailure(),
        networkSessionId: "",
        networkStatus: "disconnected",
      });
      void active.close();
    },
    retry() {
      retryRequested = true;
    },
    exit() {
      generation += 1;
      closed = true;
      retryRequested = false;
      const active = connection;
      connection = undefined;
      if (active !== undefined) void active.close();
    },
  };
}
