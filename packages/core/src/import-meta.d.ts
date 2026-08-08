interface ImportMeta {
  readonly env?: {
    readonly DEV?: boolean;
  };
  readonly hot?: ViteHotContext;
}

interface ViteHotContext {
  readonly data: Record<string, unknown>;
  accept(): void;
  dispose(callback: (data: Record<string, unknown>) => void): void;
  invalidate(message?: string): void;
}
