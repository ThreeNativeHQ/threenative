import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	ANDROID_16KB_ABIS,
	assertAndroid16KbAlignment,
} from "./check-android-16kb-alignment.mjs";

// Keep the existing V8 API/ABI and reviewed upstream patches, not an unrelated engine upgrade.
// The source commit also pins Chromium's build/DEPS inputs. Increment recipe when flags change.
export const ANDROID_V8_BUILD = Object.freeze({
	recipe: 5,
	version: "11.0.226.16",
	inspectorFix: "182d9c05e78b1ddb1cb8242cd3628a7855a0336f",
	source: "7999223ca1644726339aae43d9435c721c8a4bb0",
	patches: "fc31185d224f9aaddc28765882009591de5ca4d0",
	depotTools: "08f3e8c0eb66d6de3a048a757d0ff708dbc8ea34",
	ndk: "28.2.13676358",
	loadAlignment: 16384,
});
const RECEIPT = "build-receipt.json";
const TARGETS = Object.freeze({
	"arm64-v8a": { cpu: "arm64", machine: 183, triple: "aarch64-linux-android" },
	x86_64: { cpu: "x64", machine: 62, triple: "x86_64-linux-android" },
});

export function androidV8GnArgs(abi) {
	if (!Object.hasOwn(TARGETS, abi))
		throw new Error(`Unsupported Android V8 ABI: ${abi}`);
	return [
		'target_os="android"',
		`target_cpu="${TARGETS[abi].cpu}"`,
		"is_component_build=false",
		"is_debug=false",
		"symbol_level=0",
		"use_custom_libcxx=false",
		"use_custom_libcxx_for_host=true",
		"use_sysroot=true",
		"icu_use_data_file=false",
		"treat_warnings_as_errors=false",
		"default_min_sdk_version=21",
		"v8_enable_sandbox=false",
		"v8_enable_pointer_compression=true",
		"v8_enable_lite_mode=false",
		"v8_use_external_startup_data=true",
		"clang_use_chrome_plugins=false",
		'clang_base_path="//android-ndk-r28c/toolchains/llvm/prebuilt/linux-x86_64"',
	].join(" ");
}

function sha256(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function payloadFiles(root, directory = "") {
	const result = [];
	for (const entry of readdirSync(join(root, directory)).sort()) {
		const relative = directory ? `${directory}/${entry}` : entry;
		if (relative === RECEIPT) continue;
		const stats = lstatSync(join(root, relative));
		if (stats.isSymbolicLink())
			throw new Error(`V8 payload must not contain symlinks: ${relative}`);
		if (stats.isDirectory()) result.push(...payloadFiles(root, relative));
		else if (stats.isFile() && stats.size > 0) result.push(relative);
		else
			throw new Error(
				`V8 payload has an empty or non-regular file: ${relative}`,
			);
	}
	return result;
}

/** Inspect the actual payload; a receipt is integrity evidence, never a device-launch claim. */
export function createAndroidV8Receipt(root, options = {}) {
	const files = payloadFiles(root);
	const required = [
		"include/v8.h",
		"include/v8-version.h",
		"licenses/V8-LICENSE",
		"licenses/BUILD-SCRIPTS-LICENSE",
		"licenses/ICU-LICENSE",
		"licenses/NDK-NOTICE",
	];
	for (const abi of ANDROID_16KB_ABIS) {
		required.push(
			`lib/${abi}/libv8android.so`,
			`lib/${abi}/libc++_shared.so`,
			`snapshot_blob/${abi}/snapshot_blob.bin`,
		);
	}
	for (const path of required) {
		if (!files.includes(path)) throw new Error(`Android V8 is missing ${path}`);
	}
	const versionHeader = readFileSync(
		join(root, "include/v8-version.h"),
		"utf8",
	);
	const parts = [
		"MAJOR_VERSION",
		"MINOR_VERSION",
		"BUILD_NUMBER",
		"PATCH_LEVEL",
	].map(
		(part) =>
			new RegExp(`^#define V8_${part} (\\d+)\\s*$`, "mu").exec(
				versionHeader,
			)?.[1],
	);
	if (parts.join(".") !== ANDROID_V8_BUILD.version) {
		throw new Error(
			`Android V8 headers do not match ${ANDROID_V8_BUILD.version}`,
		);
	}
	const libraries = files.filter((path) => path.endsWith(".so"));
	for (const path of libraries) {
		const [, abi] = path.split("/");
		const bytes = readFileSync(join(root, path));
		if (
			!path.startsWith("lib/") ||
			!Object.hasOwn(TARGETS, abi) ||
			bytes.length < 64 ||
			!bytes
				.subarray(0, 7)
				.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1])) ||
			bytes.readUInt16LE(16) !== 3 ||
			bytes.readUInt16LE(18) !== TARGETS[abi].machine
		) {
			throw new Error(
				`Android V8 ${path} has an invalid ELF class/type/machine for its ABI`,
			);
		}
	}
	const inspected = assertAndroid16KbAlignment(
		libraries.map((path) => join(root, path)),
		options,
	);
	return {
		schemaVersion: 1,
		build: { ...ANDROID_V8_BUILD },
		args: Object.fromEntries(
			ANDROID_16KB_ABIS.map((abi) => [abi, androidV8GnArgs(abi)]),
		),
		files: Object.fromEntries(
			files.map((path) => [path, sha256(join(root, path))]),
		),
		libraries: inspected.map(({ alignments }, index) => ({
			path: libraries[index],
			alignments,
		})),
	};
}

export function verifyAndroidV8Installation(root, options = {}) {
	const path = join(root, RECEIPT);
	if (!existsSync(path))
		throw new Error(`Android V8 build receipt is missing: ${path}`);
	const receipt = JSON.parse(readFileSync(path, "utf8"));
	const args = Object.fromEntries(
		ANDROID_16KB_ABIS.map((abi) => [abi, androidV8GnArgs(abi)]),
	);
	if (
		receipt.schemaVersion !== 1 ||
		JSON.stringify(receipt.build) !== JSON.stringify(ANDROID_V8_BUILD) ||
		JSON.stringify(receipt.args) !== JSON.stringify(args)
	) {
		throw new Error(
			"Android V8 cache has a different build recipe; rebuild the dependency",
		);
	}
	const actual = createAndroidV8Receipt(root, options);
	if (
		!receipt.files ||
		Object.keys(receipt.files).length !== Object.keys(actual.files).length
	) {
		throw new Error("Android V8 receipt does not cover the complete payload");
	}
	for (const [file, hash] of Object.entries(actual.files)) {
		if (receipt.files[file] !== hash)
			throw new Error(`Android V8 ${file} checksum mismatch`);
	}
	return actual;
}

export function resolveAndroidV8Ndk(env = process.env) {
	const sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
	const root =
		env.ANDROID_NDK_HOME ??
		env.ANDROID_NDK_ROOT ??
		env.ANDROID_NDK ??
		(sdk ? join(sdk, "ndk", ANDROID_V8_BUILD.ndk) : undefined);
	const properties = root && join(root, "source.properties");
	const revision =
		properties && existsSync(properties)
			? /^[ \t]*Pkg\.Revision[ \t]*=[ \t]*(\S+)[ \t]*$/mu.exec(
					readFileSync(properties, "utf8"),
				)?.[1]
			: undefined;
	if (revision !== ANDROID_V8_BUILD.ndk) {
		throw new Error(
			`Android V8 requires NDK ${ANDROID_V8_BUILD.ndk}; install it with sdkmanager ` +
				`"ndk;${ANDROID_V8_BUILD.ndk}" and select that NDK with ANDROID_NDK_HOME`,
		);
	}
	return resolve(root);
}

function replaceOnce(path, before, after) {
	const text = readFileSync(path, "utf8");
	if (text.split(before).length !== 2)
		throw new Error(`Pinned V8 patch context changed in ${path}`);
	writeFileSync(path, text.replace(before, after));
}

// The reviewed upstream commit was written against a newer V8 parent that already declares
// String16::getTrimmedOffsetAndLength(). The pinned 11.0.226.16 source predates that unrelated
// declaration, so retain the commit's edits while removing only its context-only line.
export function adaptAndroidV8InspectorPatch(patch) {
	const absentPinnedContext =
		"   std::pair<size_t, size_t> getTrimmedOffsetAndLength() const;\n";
	const occurrences = patch.split(absentPinnedContext).length - 1;
	if (occurrences !== 1) {
		throw new Error(
			"Pinned V8 inspector backport context changed; expected one absent declaration",
		);
	}
	return patch.replace(absentPinnedContext, "");
}

/** Linux x86_64 source-build lane. Consumers continue to use engine-qualified runtime assets. */
export function provisionAndroidV8(
	destination,
	{ force = false, env = process.env } = {},
) {
	const work = join(dirname(destination), ".v8-source");
	const backup = join(work, "previous");
	// A terminated promotion can leave the only prior install in the rollback directory.
	// Recover it before cache checks or a forced preparation can remove source state.
	if (!existsSync(destination) && existsSync(backup)) renameSync(backup, destination);
	if (!force && existsSync(destination)) {
		try {
			const receipt = verifyAndroidV8Installation(destination);
			console.log(
				`Verified Android V8 ${receipt.build.version}: both ABI/snapshot/STL payloads`,
			);
			return receipt;
		} catch (error) {
			console.warn(`Replacing stale Android V8 cache: ${error.message}`);
		}
	}
	if (process.platform !== "linux" || process.arch !== "x64") {
		throw new Error(
			"Rebuilding Android V8 requires a Linux x86_64 source-build host. " +
				"Use the Linux Android build lane; the historical 4 KB archive is not a fallback.",
		);
	}
	const ndk = resolveAndroidV8Ndk(env);
	const jobs = Number(env.THREENATIVE_V8_BUILD_JOBS ?? 3);
	if (!Number.isInteger(jobs) || jobs < 1 || jobs > 32) {
		throw new Error(
			"THREENATIVE_V8_BUILD_JOBS must be an integer between 1 and 32",
		);
	}
	mkdirSync(dirname(destination), { recursive: true });
	// Keep the prepared checkout and Ninja outputs under a deterministic path. A hosted runner can
	// time out while compiling one ABI; retaining the exact recipe lets the next producer resume
	// instead of paying the seven-thousand-object cold build again.
	const statePath = join(work, ".recipe.json");
	const state = `${JSON.stringify({
		build: ANDROID_V8_BUILD,
		buildScript: sha256(fileURLToPath(import.meta.url)),
	}, null, 2)}\n`;
	const upstream = join(work, "buildscripts");
	const source = join(upstream, "v8");
	const depot = join(upstream, "scripts/depot_tools");
	const stage = join(work, "payload");
	const tools = join(ndk, "toolchains/llvm/prebuilt/linux-x86_64");
	const baseEnv = { ...env, DEPOT_TOOLS_UPDATE: "0", DEPOT_TOOLS_METRICS: "0" };
	const run = (program, args, cwd = upstream, runEnv = baseEnv) =>
		execFileSync(program, args, { cwd, env: runEnv, stdio: "inherit" });
	const checkout = (directory, url, revision) => {
		mkdirSync(directory, { recursive: true });
		run("git", ["init"], directory);
		run("git", ["fetch", "--depth=1", url, revision], directory);
		run("git", ["checkout", "--detach", "FETCH_HEAD"], directory);
		const actual = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: directory,
			encoding: "utf8",
		}).trim();
		if (actual !== revision)
			throw new Error(`V8 source revision mismatch: ${actual} != ${revision}`);
	};
	let prepared = false;
	if (!force && existsSync(statePath)) {
		try {
			prepared =
				readFileSync(statePath, "utf8") === state &&
				existsSync(source) &&
				existsSync(depot);
		} catch {
			prepared = false;
		}
	}
	try {
		if (!prepared) {
			rmSync(work, { recursive: true, force: true });
			mkdirSync(work, { recursive: true });
			console.log(`Preparing Android V8 source in ${work}`);
			checkout(
				upstream,
				"https://github.com/Kudo/v8-android-buildscripts.git",
				ANDROID_V8_BUILD.patches,
			);
			checkout(
				depot,
				"https://chromium.googlesource.com/chromium/tools/depot_tools.git",
				ANDROID_V8_BUILD.depotTools,
			);
			const depotEnv = { ...baseEnv, PATH: `${depot}:${baseEnv.PATH ?? ""}` };
			run(
				join(depot, "gclient"),
				[
					"config",
					"--name",
					"v8",
					"--unmanaged",
					"https://chromium.googlesource.com/v8/v8.git",
				],
				upstream,
				depotEnv,
			);
			run(
				join(depot, "gclient"),
				[
					"sync",
					"--revision",
					`v8@${ANDROID_V8_BUILD.source}`,
					"--deps=android",
					"--no-history",
					"--nohooks",
				],
				upstream,
				depotEnv,
			);
			run(join(depot, "gclient"), ["runhooks"], upstream, depotEnv);
			replaceOnce(
				join(upstream, "scripts/env.sh"),
				'NDK_VERSION="r23c"',
				'NDK_VERSION="r28c"',
			);
			run("bash", ["scripts/patch.sh", "android"]);

			// V8's reviewed char16_t backport restores libc++ 19 compatibility without disabling
			// the inspector. Depth two retains the parent; a shallow root would diff the whole tree.
			run(
				"git",
				[
					"fetch",
					"--depth",
					"2",
					"https://chromium.googlesource.com/v8/v8.git",
					ANDROID_V8_BUILD.inspectorFix,
				],
				source,
			);
			const upstreamInspectorPatch = execFileSync(
				"git",
				[
					"diff",
					`${ANDROID_V8_BUILD.inspectorFix}^`,
					ANDROID_V8_BUILD.inspectorFix,
					"--",
				],
				{ cwd: source, env: baseEnv, encoding: "utf8", maxBuffer: 1024 * 1024 },
			);
			if (upstreamInspectorPatch.length === 0)
				throw new Error("Pinned V8 inspector backport is empty");
			const inspectorPatch = adaptAndroidV8InspectorPatch(upstreamInspectorPatch);
			execFileSync("git", ["apply", "--check", "--recount", "-"], {
				cwd: source,
				env: baseEnv,
				input: inspectorPatch,
			});
			execFileSync("git", ["apply", "--recount", "-"], {
				cwd: source,
				env: baseEnv,
				input: inspectorPatch,
			});
			const clangVersions = readdirSync(join(tools, "lib/clang"));
			if (clangVersions.length !== 1)
				throw new Error("Pinned NDK has an ambiguous Clang resource version");
			replaceOnce(
				join(source, "build/config/android/BUILD.gn"),
				"/clang/12.0.9/lib/linux/$arch_dir",
				`/clang/${clangVersions[0]}/lib/linux/$arch_dir`,
			);
			replaceOnce(
				join(source, "build/config/android/BUILD.gn"),
				'    ldflags += [ "-Wl,-z,max-page-size=4096" ]',
				'    ldflags += [ "-Wl,-z,max-page-size=16384", "-Wl,-z,common-page-size=16384" ]',
			);
			replaceOnce(
				join(source, "BUILD.gn"),
				'v8_loadable_module("libv8android") {\n',
				'v8_loadable_module("libv8android") {\n' +
					'  ldflags = [ "-Wl,-z,max-page-size=16384", "-Wl,-z,common-page-size=16384" ]\n',
			);
			// V8 11 relied on a transitive standard-library include removed by modern host headers.
			replaceOnce(
				join(source, "src/heap/cppgc/stats-collector.h"),
				"#include <atomic>",
				"#include <algorithm>\n#include <atomic>",
			);
			writeFileSync(statePath, state);
		} else {
			console.log(`Resuming Android V8 source build in ${work}`);
		}
		const ndkLink = join(source, "android-ndk-r28c");
		try {
			if (!lstatSync(ndkLink).isSymbolicLink())
				throw new Error(`Android V8 source has a non-symlink ${ndkLink}`);
			rmSync(ndkLink);
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		symlinkSync(ndk, ndkLink, "dir");
		// Resume compiler outputs, never a partially assembled payload or its stale files.
		rmSync(stage, { recursive: true, force: true });
		for (const abi of ANDROID_16KB_ABIS) {
			const target = TARGETS[abi];
			const output = `out.v8.${target.cpu}`;
			// Use the fetched GN executable, not a depot_tools launcher with a second Python bootstrap.
			run(
				join(source, "buildtools/linux64/gn"),
				["gen", output, `--args=${androidV8GnArgs(abi)}`],
				source,
			);
			run(
				"ninja",
				[`-j${jobs}`, "-C", output, "libv8android", "run_mksnapshot_default"],
				source,
			);
			mkdirSync(join(stage, "lib", abi), { recursive: true });
			mkdirSync(join(stage, "snapshot_blob", abi), { recursive: true });
			copyFileSync(
				join(source, output, "libv8android.so"),
				join(stage, "lib", abi, "libv8android.so"),
			);
			copyFileSync(
				join(tools, "sysroot/usr/lib", target.triple, "libc++_shared.so"),
				join(stage, "lib", abi, "libc++_shared.so"),
			);
			copyFileSync(
				join(source, output, "snapshot_blob.bin"),
				join(stage, "snapshot_blob", abi, "snapshot_blob.bin"),
			);
		}
		cpSync(join(source, "include"), join(stage, "include"), {
			recursive: true,
		});
		mkdirSync(join(stage, "licenses"), { recursive: true });
		copyFileSync(join(source, "LICENSE"), join(stage, "licenses/V8-LICENSE"));
		copyFileSync(
			join(upstream, "LICENSE"),
			join(stage, "licenses/BUILD-SCRIPTS-LICENSE"),
		);
		copyFileSync(
			join(source, "third_party/icu/LICENSE"),
			join(stage, "licenses/ICU-LICENSE"),
		);
		copyFileSync(join(ndk, "NOTICE"), join(stage, "licenses/NDK-NOTICE"));
		const options = { objdump: join(tools, "bin/llvm-objdump") };
		const receipt = createAndroidV8Receipt(stage, options);
		writeFileSync(
			join(stage, RECEIPT),
			`${JSON.stringify(receipt, null, 2)}\n`,
		);
		verifyAndroidV8Installation(stage, options);
		// Keep the prior payload intact on all download, patch, compiler and validation failures.
		rmSync(backup, { recursive: true, force: true });
		if (existsSync(destination)) renameSync(destination, backup);
		try {
			renameSync(stage, destination);
		} catch (error) {
			if (existsSync(backup)) renameSync(backup, destination);
			throw error;
		}
		// Cleanup cannot invalidate a successfully installed, verified payload.
		try {
			rmSync(work, { recursive: true, force: true });
		} catch (error) {
			console.warn(`Installed V8; could not clean ${work}: ${error.message}`);
		}
		console.log(
			`Installed Android V8 ${receipt.build.version} with verified 16 KB LOAD segments`,
		);
		return receipt;
	} catch (error) {
		throw new Error(
			`Android V8 source build failed; previous install is unchanged. Inspect ${work}. ${error.message}`,
			{ cause: error },
		);
	}
}

/** The Gradle path verifies only: it must never download, rebuild, or repair a dependency. */
export function runAndroidV8Command(args, {
  root = resolve(dirname(fileURLToPath(import.meta.url)), '../third_party/v8-android'),
  verify = verifyAndroidV8Installation,
  provision = provisionAndroidV8,
} = {}) {
  if (args.length > 1 || args.some((arg) => !['--verify', '--force'].includes(arg))) {
    throw new Error('Usage: build-android-v8.mjs [--verify | --force]');
  }
  if (args[0] === '--verify') return verify(root);
  return provision(root, { force: args[0] === '--force' });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runAndroidV8Command(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
