import { useEffect } from "react";
import { CopyToast } from "./components/code/CopyButton.js";
import { MobileNav } from "./components/layout/MobileNav.js";
import { SiteFooter } from "./components/layout/SiteFooter.js";
import { SiteHeader } from "./components/layout/SiteHeader.js";
import { CodeShowcase } from "./components/sections/CodeShowcase.js";
import { FeatureRow } from "./components/sections/FeatureRow.js";
import { Hero } from "./components/sections/Hero.js";
import { LogoWall } from "./components/sections/LogoWall.js";
import { type IRoute, findRoute } from "./routes.js";
import { type CodeTab, useUiStore } from "./store/ui.js";

const CODE_TABS: readonly CodeTab[] = ["typescript", "react", "cli"];

function isCodeTab(value: string | null): value is CodeTab {
  return value !== null && CODE_TABS.some((tab) => tab === value);
}

function Home() {
  return (
    <>
      <Hero />
      <FeatureRow />
      <CodeShowcase />
      <LogoWall />
    </>
  );
}

function NotFound() {
  return (
    <section className="mx-auto w-full max-w-[1536px] px-5 py-28 lg:px-[68px]">
      <p className="text-[14px] font-medium uppercase tracking-[0.2em] text-tn-accent">404</p>
      <h1 className="mt-4 text-[38px] font-bold leading-[1.1] tracking-[-0.02em] lg:text-[46px]">
        Page not found
      </h1>
      <p className="mt-5 max-w-[440px] text-[16px] leading-relaxed text-tn-fg-muted">
        The page you asked for is not part of this site.
      </p>
      <a
        className="mt-8 inline-flex text-[15px] font-medium text-tn-accent hover:opacity-80"
        href="/"
      >
        Back to the home page
      </a>
    </section>
  );
}

/** Deep links select the code tab: `/?tab=react` lands on the React sample. */
function useTabDeepLink(): void {
  const setCodeTab = useUiStore((state) => state.setCodeTab);
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (isCodeTab(tab)) setCodeTab(tab);
  }, [setCodeTab]);
}

export function App({ route }: { readonly route: IRoute }) {
  useTabDeepLink();
  return (
    <div className="flex min-h-screen flex-col bg-tn-bg">
      <SiteHeader />
      <MobileNav />
      <main className="flex-1">{route.path === "/" ? <Home /> : <NotFound />}</main>
      <SiteFooter />
      <CopyToast />
    </div>
  );
}

export function AppForPath({ path }: { readonly path: string }) {
  const route = findRoute(path) ?? findRoute("/404");
  if (route === undefined) throw new Error(`TN_SITE_NO_ROUTE: ${path} has no route and no 404.`);
  return <App route={route} />;
}
