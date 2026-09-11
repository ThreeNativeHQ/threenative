/** Types for the plain-JavaScript postinstall contract, also bundled into doctor. */
export interface IMcpHost {
  readonly id: string;
  readonly label: string;
  readonly file: string;
  readonly format: string;
  readonly seed?: Readonly<Record<string, string>>;
}

export declare const MCP_HOSTS: readonly IMcpHost[];
export declare function installTarget(
  environment?: NodeJS.ProcessEnv,
  cwd?: string,
): string | undefined;
export declare function ensureJsonMcpConfig(
  target: string,
  file: string,
  format: string,
  seed?: Record<string, unknown>,
): string;
export declare function ensureCodexMcpConfig(target: string): string;
export declare function ensureMcpConfig(target: string): string;
export declare function ensureHostMcpConfigs(target: string): Map<string, string>;
