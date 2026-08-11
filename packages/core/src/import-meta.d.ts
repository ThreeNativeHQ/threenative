interface IImportMeta {
  readonly env?: {
    readonly DEV?: boolean;
  };
  readonly hot?: IViteHotContext;
}

interface IViteHotContext {
  readonly data: Record<string, unknown>;
  accept(): void;
  dispose(callback: (data: Record<string, unknown>) => void): void;
  invalidate(message?: string): void;
}
