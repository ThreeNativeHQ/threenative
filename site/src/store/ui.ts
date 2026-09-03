import { create } from "zustand";

export type CodeTab = "typescript" | "react" | "cli";
export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

export const packageManagers: readonly PackageManager[] = ["pnpm", "npm", "yarn", "bun"];

export interface IUiState {
  readonly codeTab: CodeTab;
  readonly mobileNavOpen: boolean;
  readonly openMenu: string | undefined;
  readonly packageManager: PackageManager;
  /** The copy confirmation. `undefined` means no toast is showing. */
  readonly toast: string | undefined;
  readonly closeMobileNav: () => void;
  readonly copy: (text: string, label: string) => Promise<void>;
  readonly dismissToast: () => void;
  readonly setCodeTab: (tab: CodeTab) => void;
  readonly setOpenMenu: (label: string | undefined) => void;
  readonly setPackageManager: (manager: PackageManager) => void;
  readonly toggleMobileNav: () => void;
}

/**
 * The only cross-cutting UI state on the site. Anything a single component owns stays in
 * `useState`; this store exists because the drawer, the tab strip and the copy toast are each
 * read or written by more than one component and by the deep-link parser.
 */
export const useUiStore = create<IUiState>((set) => ({
  codeTab: "typescript",
  mobileNavOpen: false,
  openMenu: undefined,
  packageManager: "pnpm",
  toast: undefined,
  closeMobileNav: () => set({ mobileNavOpen: false, openMenu: undefined }),
  copy: async (text, label) => {
    // `navigator.clipboard` is absent under prerender and on an insecure origin. Failing to copy
    // must not throw into the render tree, and it must not claim success either.
    try {
      await navigator.clipboard.writeText(text);
      set({ toast: `${label} copied` });
    } catch {
      set({ toast: `Could not copy ${label} — select it and copy manually` });
    }
  },
  dismissToast: () => set({ toast: undefined }),
  setCodeTab: (codeTab) => set({ codeTab }),
  setOpenMenu: (openMenu) => set({ openMenu }),
  setPackageManager: (packageManager) => set({ packageManager }),
  toggleMobileNav: () =>
    set((state) => ({ mobileNavOpen: !state.mobileNavOpen, openMenu: undefined })),
}));
