import { DocCallout, DocCodeBlock, DocSection, DocsLayout } from "./DocsLayout.js";

const DESKTOP = `pnpm create threenative my-game --template minimal
cd my-game
pnpm install
pnpm build:desktop`;

const ANDROID = `pnpm exec threenative build --target android
pnpm exec threenative build --target android --mode release --format aab`;

export function NativeRuntime() {
  return (
    <DocsLayout
      path="/docs/native-runtime"
      sourceHref="https://github.com/ThreeNativeHQ/threenative/blob/main/packages/runtime-native/README.md"
      toc={[
        { id: "contract", label: "Portable entry" },
        { id: "desktop", label: "Desktop build" },
        { id: "prebuilt", label: "Prebuilt runtime" },
        { id: "android", label: "Android release" },
        { id: "source", label: "Source builds" },
      ]}
    >
      <DocSection id="contract" title="The native host consumes the portable game entry">
        <p>
          <code className="font-mono text-tn-fg">@threenative/runtime-native</code> is an optional
          host for desktop, Android and iOS. It is not a second renderer or scene API: the project&apos;s
          portable game entry remains the contract, with Three.js and the same
          <code className="ml-1 font-mono text-tn-fg">src/game.ts</code> at the center.
        </p>
        <DocCallout title="No WebView">
          The native path is owned by the runtime host rather than embedding the browser application
          in a WebView. That is why the portable source contract matters: game code crosses targets,
          while the platform host changes underneath it.
        </DocCallout>
      </DocSection>

      <DocSection id="desktop" title="Native compilation stays opt-in">
        <p>
          Installing or using the web path does not require CMake, an Android NDK or Xcode. Add the
          native package and platform tooling when the project is ready to qualify a native target.
          The minimal template already carries the desktop build command.
        </p>
        <DocCodeBlock code={DESKTOP} label="desktop" />
        <p>
          The generated config points <code className="font-mono text-tn-fg">nativeEntry</code> at
          <code className="ml-1 font-mono text-tn-fg">src/game.ts</code>, so the packager bundles the
          same application entry rather than a native-only rewrite.
        </p>
      </DocSection>

      <DocSection id="prebuilt" title="Published packages consume verified prebuilt hosts">
        <p>
          An installed runtime package does not ship the C++ source tree and build system. Native
          packaging downloads the versioned prebuilt artifact listed by the release manifest and
          verifies its SHA-256 before using it. That makes the normal consumer path a packaging step,
          not a local engine compilation step.
        </p>
        <p className="mt-4">
          Android still needs the Android SDK and a JDK. The installed-package path does not need an
          NDK or CMake because it is not rebuilding the host from source.
        </p>
      </DocSection>

      <DocSection id="android" title="Release output is explicit and signed by the game owner">
        <DocCodeBlock code={ANDROID} label="android" />
        <p>
          Debug output is the default. Release APK or AAB output is an explicit mode and requires
          the project&apos;s signing key; the packager does not fall back to a debug key when release
          signing is missing. Produced release artifacts are checked again with the platform signing
          tools before the command reports success.
        </p>
      </DocSection>

      <DocSection id="source" title="Build the host from source only when you mean to">
        <p>
          <code className="font-mono text-tn-fg">THREENATIVE_RUNTIME_SOURCE</code> is for a full
          ThreeNative source checkout with the runtime build files and staged native dependencies.
          It is not a switch that turns an installed npm package into a source checkout. For ordinary
          consumers, the verified prebuilt path is the intended path.
        </p>
      </DocSection>
    </DocsLayout>
  );
}
