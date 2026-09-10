import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'vitest';

import {
  ANDROID_16KB_ALIGNMENT,
  assertAndroid16KbAlignment,
  parseLoadSegmentAlignments,
  resolveObjdumpCandidates,
} from '../scripts/check-android-16kb-alignment.mjs';

const aligned = [
  '    LOAD off 0x0 vaddr 0x0 paddr 0x0 align 2**14',
  '    LOAD off 0x4000 vaddr 0x4000 paddr 0x4000 align 2**14',
].join('\n');

const fourKb = [
  '    LOAD off 0x0 vaddr 0x0 paddr 0x0 align 2**12',
  '    LOAD off 0x1000 vaddr 0x1000 paddr 0x1000 align 2**12',
].join('\n');

test('accepts 16 KB-aligned LOAD segments', () => {
  assert.deepEqual(parseLoadSegmentAlignments(aligned, 'libv8android.so'), [ANDROID_16KB_ALIGNMENT, ANDROID_16KB_ALIGNMENT]);
  assert.deepEqual(
    assertAndroid16KbAlignment(['libv8android.so'], { runObjdump: () => aligned }),
    [{ libraryPath: 'libv8android.so', alignments: [ANDROID_16KB_ALIGNMENT, ANDROID_16KB_ALIGNMENT] }],
  );
});

test('rejects a 4 KB library and names the offending file', () => {
  assert.throws(
    () => assertAndroid16KbAlignment(['lib/arm64-v8a/libv8android.so'], { runObjdump: () => fourKb }),
    /Android 16 KB alignment check failed for lib\/arm64-v8a\/libv8android\.so:.*0x1000/u,
  );
});

test('fails closed when objdump has no LOAD alignment output', () => {
  assert.throws(
    () => assertAndroid16KbAlignment(['libv8android.so'], { runObjdump: () => 'file format elf64-littleaarch64' }),
    /found no LOAD segments in libv8android\.so/u,
  );
});

// `llvm-objdump` is not on a GitHub Ubuntu runner's PATH. The check therefore never ran, and the
// Android lane reported the missing tool as `Failed to download v8-android` — a broken instrument
// read as a broken dependency.
test('an NDK toolchain is preferred over PATH, and an explicit override over both', () => {
  const withoutNdk = resolveObjdumpCandidates({});
  assert.deepEqual(withoutNdk, ['llvm-objdump', 'objdump']);

  const overridden = resolveObjdumpCandidates({ TN_LLVM_OBJDUMP: '/opt/llvm/bin/llvm-objdump' });
  assert.equal(overridden[0], '/opt/llvm/bin/llvm-objdump');
  // PATH stays in the list: an override that does not exist must not remove the fallbacks.
  assert.ok(overridden.includes('llvm-objdump'));
});

test('every candidate tried is named when none of them works', () => {
  const attempted = [];
  assert.throws(
    () =>
      assertAndroid16KbAlignment(['/tmp/libv8android.so'], {
        runObjdump: (libraryPath) => {
          attempted.push(libraryPath);
          throw new Error('spawnSync llvm-objdump ENOENT');
        },
      }),
    /could not inspect \/tmp\/libv8android\.so: spawnSync llvm-objdump ENOENT/u,
  );
  assert.deepEqual(attempted, ['/tmp/libv8android.so']);
});

// The two failures must stay distinguishable. A misaligned library is a fact about a dependency
// and has an owner (PRD-221); a check that cannot run is a broken instrument and has none. Reading
// them as the same event is what let `llvm-objdump` go missing while the lane blamed the download.
test('a misaligned library is coded, and an unrunnable check is not', () => {
  const misaligned = [
    '    LOAD off 0x0 vaddr 0x0 paddr 0x0 align 2**12',
    '    LOAD off 0x1000 vaddr 0x1000 paddr 0x1000 align 2**12',
  ].join('\n');
  try {
    assertAndroid16KbAlignment(['/tmp/libv8android.so'], { runObjdump: () => misaligned });
    assert.fail('a 4 KB-aligned library must not pass');
  } catch (error) {
    assert.equal(error.code, 'ANDROID_16KB_MISALIGNED');
    assert.match(error.message, /LOAD alignments 0x1000 \(2\*\*12\)/u);
  }

  try {
    assertAndroid16KbAlignment(['/tmp/libv8android.so'], {
      runObjdump: () => {
        throw new Error('spawnSync llvm-objdump ENOENT');
      },
    });
    assert.fail('an unrunnable check must not pass');
  } catch (error) {
    assert.notEqual(error.code, 'ANDROID_16KB_MISALIGNED');
    assert.match(error.message, /could not inspect/u);
  }
});

// PRD-221: these are payload-integrity mechanics, not Android startup qualification.
import {
	mkdirSync,
	writeFileSync,
	readFileSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { join } from "node:path";
import {
	ANDROID_V8_BUILD,
	adaptAndroidV8InspectorPatch,
	androidV8GnArgs,
	createAndroidV8Receipt,
	verifyAndroidV8Installation,
	resolveAndroidV8Ndk,
} from "../scripts/build-android-v8.mjs";

function withV8Payload(run) {
	const root = makeTempDirSync("tn-v8-16kb-");
	const write = (path, value) => {
		mkdirSync(join(root, path, ".."), { recursive: true });
		writeFileSync(join(root, path), value);
	};
	// Minimal ELF headers exercise ABI validation; injected objdump output deliberately does
	// not pretend these buffers are a compiled V8 distribution or an observed device launch.
	for (const [abi, machine] of [
		["arm64-v8a", 183],
		["x86_64", 62],
	]) {
		const elf = Buffer.alloc(64);
		Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]).copy(elf);
		elf.writeUInt16LE(3, 16);
		elf.writeUInt16LE(machine, 18);
		write(`lib/${abi}/libv8android.so`, elf);
		write(`lib/${abi}/libc++_shared.so`, elf);
		write(`snapshot_blob/${abi}/snapshot_blob.bin`, `snapshot:${abi}`);
	}
	write("include/v8.h", "// fixture header");
	const names = [
		"MAJOR_VERSION",
		"MINOR_VERSION",
		"BUILD_NUMBER",
		"PATCH_LEVEL",
	];
	write(
		"include/v8-version.h",
		ANDROID_V8_BUILD.version
			.split(".")
			.map((part, index) => `#define V8_${names[index]} ${part}`)
			.join("\n"),
	);
	for (const name of [
		"V8-LICENSE",
		"BUILD-SCRIPTS-LICENSE",
		"ICU-LICENSE",
		"NDK-NOTICE",
	]) {
		write(`licenses/${name}`, "fixture license");
	}
	const options = { runObjdump: () => aligned };
	try {
		return run({ root, write, options });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function sealV8Payload(root, options) {
	const receipt = createAndroidV8Receipt(root, options);
	writeFileSync(join(root, "build-receipt.json"), JSON.stringify(receipt));
	return receipt;
}

test("V8 receipt inspects both ABI libraries and shared STLs and binds separate snapshots", () => {
	withV8Payload(({ root, options }) => {
		const seen = [];
		const receipt = sealV8Payload(root, {
			runObjdump: (path) => {
				seen.push(path);
				return aligned;
			},
		});
		assert.equal(seen.length, 4);
		assert.equal(receipt.libraries.length, 4);
		assert.notEqual(
			receipt.files["snapshot_blob/arm64-v8a/snapshot_blob.bin"],
			receipt.files["snapshot_blob/x86_64/snapshot_blob.bin"],
		);
		assert.deepEqual(verifyAndroidV8Installation(root, options), receipt);
	});
});

for (const abi of ["arm64-v8a", "x86_64"]) {
	for (const name of ["libv8android.so", "libc++_shared.so"]) {
		test(`V8 receipt rejects historical 4 KB alignment in ${abi}/${name}`, () => {
			withV8Payload(({ root }) =>
				assert.throws(
					() =>
						createAndroidV8Receipt(root, {
							runObjdump: (path) =>
								path.endsWith(`${abi}/${name}`) ? fourKb : aligned,
						}),
					(error) =>
						error.code === "ANDROID_16KB_MISALIGNED" &&
						error.message.includes(`${abi}/${name}`) &&
						error.message.includes("0x1000"),
				),
			);
		});
	}
	test(`V8 receipt rejects a missing ${abi} snapshot`, () => {
		withV8Payload(({ root, options }) => {
			rmSync(join(root, `snapshot_blob/${abi}/snapshot_blob.bin`));
			assert.throws(
				() => createAndroidV8Receipt(root, options),
				/missing .*snapshot_blob/u,
			);
		});
	});
	test(`V8 receipt rejects a library labeled with the wrong ${abi} machine`, () => {
		withV8Payload(({ root, write, options }) => {
			const path = `lib/${abi}/libv8android.so`;
			const bytes = readFileSync(join(root, path));
			bytes.writeUInt16LE(abi === "arm64-v8a" ? 62 : 183, 18);
			write(path, bytes);
			assert.throws(
				() => createAndroidV8Receipt(root, options),
				/invalid ELF class\/type\/machine/u,
			);
		});
	});
}

test("V8 cache rejects a swapped snapshot even when both files exist", () => {
	withV8Payload(({ root, write, options }) => {
		sealV8Payload(root, options);
		write(
			"snapshot_blob/x86_64/snapshot_blob.bin",
			readFileSync(join(root, "snapshot_blob/arm64-v8a/snapshot_blob.bin")),
		);
		assert.throws(
			() => verifyAndroidV8Installation(root, options),
			/snapshot_blob\/x86_64.*checksum mismatch/u,
		);
	});
});

test("V8 cache rejects a changed header and an unrecorded payload file", () => {
	withV8Payload(({ root, write, options }) => {
		sealV8Payload(root, options);
		write("include/v8.h", "// altered fixture header");
		assert.throws(
			() => verifyAndroidV8Installation(root, options),
			/v8.h checksum mismatch/u,
		);
		write("extra.txt", "unrecorded");
		assert.throws(
			() => verifyAndroidV8Installation(root, options),
			/complete payload/u,
		);
	});
});

test("V8 cache rejects stale recipe and pointer-compression configuration", () => {
	withV8Payload(({ root, write, options }) => {
		const receipt = sealV8Payload(root, options);
		receipt.args.x86_64 = receipt.args.x86_64.replace(
			"v8_enable_pointer_compression=true",
			"v8_enable_pointer_compression=false",
		);
		write("build-receipt.json", JSON.stringify(receipt));
		assert.throws(
			() => verifyAndroidV8Installation(root, options),
			/different build recipe/u,
		);
		receipt.args.x86_64 = androidV8GnArgs("x86_64");
		receipt.build.recipe -= 1;
		write("build-receipt.json", JSON.stringify(receipt));
		assert.throws(
			() => verifyAndroidV8Installation(root, options),
			/different build recipe/u,
		);
	});
});

test("V8 source GN configuration retains JIT, compressed pointers and per-ABI snapshots", () => {
	for (const abi of ["arm64-v8a", "x86_64"]) {
		const args = androidV8GnArgs(abi);
		assert.match(args, /v8_enable_lite_mode=false/u);
		assert.match(args, /v8_enable_pointer_compression=true/u);
		assert.match(args, /v8_use_external_startup_data=true/u);
		assert.match(args, /use_custom_libcxx=false/u);
	}
	assert.throws(
		() => androidV8GnArgs("armeabi-v7a"),
		/Unsupported Android V8 ABI/u,
	);
});

test('the adapted inspector backport applies to the pinned String16 source shape', () => {
  const root = makeTempDirSync('tn-v8-inspector-patch-');
  const header = join(root, 'src/inspector/string-16.h');
  const parent = [
    '#include <stdint.h>',
    '',
    'using UChar = uint16_t;',
    '',
    'class String16 {',
    ' public:',
    '  int toInteger(bool* ok = nullptr) const;',
    '  std::pair<size_t, size_t> getTrimmedOffsetAndLength() const;',
    '  String16 stripWhiteSpace() const;',
    '  const UChar* characters16() const { return m_impl.c_str(); }',
    '  size_t length() const { return m_impl.length(); }',
    '  bool isEmpty() const { return !m_impl.length(); }',
    '  UChar operator[](size_t index) const { return m_impl[index]; }',
    '};',
    '',
  ].join('\n');
  const target = parent
    .replace('using UChar = uint16_t;', 'using UChar = char16_t;')
    .replace(
      '  const UChar* characters16() const { return m_impl.c_str(); }',
      '  const uint16_t* characters16() const {\n' +
        '    return reinterpret_cast<const uint16_t*>(m_impl.c_str());\n' +
        '  }',
    );
  const pinned = parent.replace(
    '  std::pair<size_t, size_t> getTrimmedOffsetAndLength() const;\n',
    '',
  );
  try {
    mkdirSync(join(root, 'src/inspector'), { recursive: true });
    writeFileSync(header, parent);
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'ThreeNative test'], { cwd: root });
    execFileSync('git', ['add', 'src/inspector/string-16.h'], { cwd: root });
    execFileSync('git', ['commit', '-qm', 'parent'], { cwd: root });
    writeFileSync(header, target);
    const upstreamPatch = execFileSync(
      'git',
      ['diff', '--', 'src/inspector/string-16.h'],
      { cwd: root, encoding: 'utf8' },
    );
    writeFileSync(header, pinned);
    const adapted = adaptAndroidV8InspectorPatch(upstreamPatch);
    assert.doesNotMatch(adapted, /getTrimmedOffsetAndLength/u);
    assert.doesNotThrow(() =>
      execFileSync('git', ['apply', '--check', '--recount', '-'], {
        cwd: root,
        input: adapted,
      }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("V8 payload rejects symlinks, empty files and missing license notices", () => {
	withV8Payload(({ root, write, options }) => {
		write("empty.txt", "");
		assert.throws(
			() => createAndroidV8Receipt(root, options),
			/empty or non-regular/u,
		);
		rmSync(join(root, "empty.txt"));
		symlinkSync("v8.h", join(root, "include/link.h"));
		assert.throws(
			() => createAndroidV8Receipt(root, options),
			/must not contain symlinks/u,
		);
		rmSync(join(root, "include/link.h"));
		rmSync(join(root, "licenses/NDK-NOTICE"));
		assert.throws(
			() => createAndroidV8Receipt(root, options),
			/missing licenses\/NDK-NOTICE/u,
		);
	});
});

test("V8 source toolchain requires the exact NDK revision, not a matching prefix", () => {
	withV8Payload(({ root, write }) => {
		write("source.properties", `Pkg.Revision = ${ANDROID_V8_BUILD.ndk}0\n`);
		assert.throws(
			() => resolveAndroidV8Ndk({ ANDROID_NDK_HOME: root }),
			/requires NDK/u,
		);
		write("source.properties", `Pkg.Revision = ${ANDROID_V8_BUILD.ndk}\n`);
		assert.equal(resolveAndroidV8Ndk({ ANDROID_NDK_HOME: root }), root);
	});
});

// The source builder is reached through the incumbent dependency provisioner, not a second
// user-facing install route. Inject only that expensive boundary in these no-toolchain tests.
import * as dependencyInstaller from '../scripts/download-deps.mjs';
import * as sourceBuilder from '../scripts/build-android-v8.mjs';

test('Android provisioner delegates even an existing legacy cache to the verified V8 builder', async () => {
  const root = makeTempDirSync('tn-v8-provision-');
  const destination = join(root, 'v8-android');
  mkdirSync(destination);
  let observed;
  try {
    const result = await dependencyInstaller.downloadDep('v8-android', {
      thirdPartyRoot: root,
      force: false,
      provisionV8: (path, options) => { observed = { path, options }; },
    });
    assert.equal(result, true);
    assert.deepEqual(observed, { path: destination, options: { force: false } });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Android provisioner reports a V8 source failure instead of falling back to the historical archive', async () => {
  let called = 0;
  const result = await dependencyInstaller.downloadDep('v8-android', {
    force: true,
    provisionV8: (_path, options) => {
      called += 1;
      assert.equal(options.force, true);
      throw new Error('fixture: source dependency unavailable');
    },
  });
  assert.equal(called, 1);
  assert.equal(result, false);
});

test('Gradle V8 verification is read-only and refuses misspelled or conflicting flags', () => {
  const root = '/fixture/v8';
  let verified = 0;
  const options = {
    root,
    verify: (path) => { assert.equal(path, root); verified += 1; return 'checked'; },
    provision: () => { throw new Error('verification must not fetch or rebuild'); },
  };
  assert.equal(sourceBuilder.runAndroidV8Command(['--verify'], options), 'checked');
  assert.equal(verified, 1);
  for (const args of [['--verify', '--force'], ['--verfy'], ['--verify', '--verify']]) {
    assert.throws(() => sourceBuilder.runAndroidV8Command(args, options), /Usage:/u);
  }
});

test('source Gradle builds verify the dependency before snapshots while no-NDK prebuilts bypass the source helper', () => {
  const gradle = readFileSync(new URL('../android/app/build.gradle.kts', import.meta.url), 'utf8');
  assert.match(gradle, /if \(!usePrebuiltRuntime && nativeJsEngineName == "v8"\) \{[\s\S]*?tasks\.register<Exec>\("verifyV8Dependency"\)/u);
  assert.match(gradle, /build-android-v8\.mjs[\s\S]*?"--verify"/u);
  assert.match(gradle, /tasks\.named\("copyV8Snapshot"\)\s*\{\s*dependsOn\(verifyV8Dependency\)/u);
  assert.ok(gradle.includes(`ndkVersion = "${ANDROID_V8_BUILD.ndk}"`));
});

test('Android workflows install and select the pinned V8 NDK', () => {
  const ndk = ANDROID_V8_BUILD.ndk;
  const gradleProperties = readFileSync(new URL('../android/gradle.properties', import.meta.url), 'utf8');
  assert.match(gradleProperties, new RegExp(`^android\\.ndkVersion=${ndk}$`, 'mu'));

  for (const path of [
    '../../../.github/workflows/native-platforms.yml',
    '../../../.github/workflows/native-release.yml',
  ]) {
    const workflow = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.ok(workflow.includes(`ndk;${ndk}`), `${path} must install the pinned NDK`);
    assert.match(
      workflow,
      new RegExp(`ANDROID_NDK_HOME=.*ndk/${ndk}`, 'u'),
      `${path} must explicitly select the pinned NDK`,
    );
    assert.doesNotMatch(workflow, /ndk;27\.1\.12297006/u);
  }
});

test('the NDK 28 recipe pins and adapts the upstream inspector libc++ compatibility backport', () => {
  assert.equal(ANDROID_V8_BUILD.inspectorFix, '182d9c05e78b1ddb1cb8242cd3628a7855a0336f');
  assert.equal(ANDROID_V8_BUILD.recipe, 4);
  const script = readFileSync(new URL('../scripts/build-android-v8.mjs', import.meta.url), 'utf8');
  assert.match(script, /ANDROID_V8_BUILD\.inspectorFix/u);
  assert.match(script, /adaptAndroidV8InspectorPatch/u);
  assert.match(script, /\["apply", "--check", "--recount", "-"\]/u);
  assert.match(script, /\["apply", "--recount", "-"\]/u);
});
