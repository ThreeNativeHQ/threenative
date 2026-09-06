#!/usr/bin/env python3
"""Workflow shape tests: parse the candidate YAML (not substring checks).

Asserts the exact tag trigger, required engine checkout ordering, pinned
upstream/toolchain, ZIP+manifest-only upload, and the fail-closed publish
gate. Negative controls mutate the parsed doc and prove the checker fires.
Needs PyYAML locally (6.0.3); CI provisions pinned PyYAML==6.0.3.

Run: python3 test-quiche-workflow.py
"""
import importlib.util
import os
import subprocess
import unittest

import yaml

_HERE = os.path.dirname(os.path.abspath(__file__))


def _repo_root():
    d = _HERE
    while True:
        cand = os.path.join(d, "packages", "runtime-native",
                            "scripts", "build-quiche-owned.py")
        if os.path.isfile(cand):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            raise RuntimeError("repo root not found above " + _HERE)
        d = parent


REPO = _repo_root()


def _workflow_path():
    for cand in (os.path.join(_HERE, "build-quiche-owned.yml"),
                 os.path.join(REPO, ".github", "workflows",
                              "build-quiche-owned.yml")):
        if os.path.isfile(cand):
            return cand
    raise RuntimeError("build-quiche-owned.yml not found")


WORKFLOW = _workflow_path()
with open(WORKFLOW) as _f:
    WORKFLOW_TEXT = _f.read()


def _load_builder():
    spec = importlib.util.spec_from_file_location(
        "build_quiche_owned",
        os.path.join(REPO, "packages", "runtime-native",
                     "scripts", "build-quiche-owned.py"))
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


BUILDER = _load_builder()
TAG = "quiche-owned-v1"


class WorkflowCheckError(Exception):
    pass


def load_workflow(path=WORKFLOW):
    with open(path) as f:
        return yaml.safe_load(f)


def check_workflow(doc):
    """Fail closed on any publishable-shape regression. Raises on defect."""
    if not isinstance(doc, dict):
        raise WorkflowCheckError("workflow doc is not a mapping")
    # NOTE: YAML 1.1 parses the `on:` key as boolean True.
    on = doc.get("on", doc.get(True))
    if not isinstance(on, dict):
        raise WorkflowCheckError("missing `on:` trigger mapping")
    if "workflow_dispatch" not in on:
        raise WorkflowCheckError("missing workflow_dispatch trigger")
    push = on.get("push", {})
    if TAG not in (push.get("tags") or []):
        raise WorkflowCheckError(
            f"push.tags must contain exactly {TAG}")
    for trigger in ("pull_request", "push"):
        paths = ((on.get(trigger) or {}).get("paths") or [])
        for required in (
                "packages/runtime-native/scripts/build-quiche-owned.py",
                "packages/runtime-native/scripts/test-build-quiche-owned.py",
                "packages/runtime-native/scripts/validate-quiche-release.py",
                "packages/runtime-native/scripts/test-validate-quiche-release.py",  # noqa: E501
                "packages/runtime-native/scripts/test-quiche-workflow.py",
                "packages/runtime-native/patches/quiche-*.patch",
                ".gitattributes",
                ".github/workflows/build-quiche-owned.yml"):
            if required not in paths:
                raise WorkflowCheckError(
                    f"{trigger}.paths misses {required}")
    jobs = doc.get("jobs", {})
    build = jobs.get("build", {})
    steps = build.get("steps", [])
    if not steps:
        raise WorkflowCheckError("build job has no steps")
    matrix = (((build.get("strategy") or {}).get("matrix") or {}).get("include")
              or [])
    expected_targets = {"linux-x64": ("ubuntu", None),
                        "win-x64": ("windows", None),
                        "mac-arm64": ("macos", "macosx"),
                        "mac-x86_64": ("macos", "macosx"),
                        "android-arm64": ("ubuntu", None),
                        "android-armv7": ("ubuntu", None),
                        "android-x64": ("ubuntu", None),
                        "ios-arm64": ("macos", "iphoneos"),
                        "ios-sim-x64": ("macos", "iphonesimulator")}
    found = {row.get("target"): (str(row.get("os", "")), row.get("sdk")) for row in matrix
             if isinstance(row, dict)}
    for target, (os_prefix, sdk) in expected_targets.items():
        if target not in found:
            raise WorkflowCheckError(f"matrix misses target {target}")
        actual_os, actual_sdk = found[target]
        if not actual_os.startswith(os_prefix):
            raise WorkflowCheckError(
                f"matrix target {target} runs on unsuitable os {actual_os!r}")
        if actual_sdk != sdk:
            raise WorkflowCheckError(
                f"matrix target {target} selects sdk {actual_sdk!r}, expected {sdk!r}")
    if "runs-on" not in str(build.get("runs-on", "")) \
            and "matrix.os" not in str(build.get("runs-on", "")):
        raise WorkflowCheckError("build must run on matrix.os")

    def text(step):
        with_s = step.get("with", "")
        if isinstance(with_s, dict):
            with_s = " ".join(f"{k}: {v}" for k, v in with_s.items())
        return " ".join([str(step.get(k, "")) for k in
                         ("name", "run", "uses", "env")] + [str(with_s)])

    blobs = [text(s) for s in steps]
    full = "\n".join(blobs)
    engine_ck = next(
        (i for i, s in enumerate(steps)
         if "actions/checkout" in str(s.get("uses", ""))
         and "path: engine" in text(s)),
        None)
    if engine_ck is None:
        raise WorkflowCheckError("missing engine checkout before build")
    quiche_ck = next(
        (i for i, s in enumerate(steps)
         if "cloudflare/quiche" in str(s.get("with", ""))), None)
    if quiche_ck is None:
        raise WorkflowCheckError("missing pinned quiche checkout")
    qs = steps[quiche_ck]
    qw = qs.get("with", {})
    if qw.get("ref") != BUILDER.UPSTREAM_COMMIT:
        raise WorkflowCheckError("quiche checkout ref is not the pinned "
                                 "upstream commit")
    if qw.get("submodules") not in (True, "recursive"):
        raise WorkflowCheckError("quiche checkout must be recursive")
    first_use = next(
        (i for i, b in enumerate(blobs)
         if "build-quiche-owned.py" in b), None)
    if first_use is None:
        raise WorkflowCheckError("no step invokes the actual producer")
    if not (engine_ck < quiche_ck < first_use):
        raise WorkflowCheckError("engine checkout must precede validators")
    for pin in ("1.96.0", "1.26.3", "3.12", "PyYAML==6.0.3", "cmake==4.4.2"):
        if pin not in full:
            raise WorkflowCheckError(f"missing pinned provision: {pin}")
    for provision in ("msvc-dev-cmd", "arch: x64", "matrix.sdk",
                      "xcrun --sdk", "setup-xcode",
                      "27.1.12297006", "r27b", "setup-ndk",
                      "armv7a-linux-androideabi21-clang",
                      "IPHONEOS_DEPLOYMENT_TARGET"):
        if provision not in full:
            raise WorkflowCheckError(
                f"missing explicit platform provision: {provision}")
    ndk = next((s for s in steps
                if "nttld/setup-ndk" in str(s.get("uses", ""))), None)
    if ndk is None or ndk.get("id") != "setup-ndk" \
            or ndk.get("with", {}).get("ndk-version") != "r27b" \
            or ndk.get("with", {}).get("add-to-path") not in (False, "false"):
        raise WorkflowCheckError(
            "setup-ndk must use r27b without PATH-only discovery")
    if "steps.setup-ndk.outputs.ndk-path" not in full:
        raise WorkflowCheckError(
            "Android probe/build must consume the pinned setup-ndk output")
    if "skipped, never passed" not in WORKFLOW_TEXT:
        raise WorkflowCheckError(
            "workflow must not claim local cross-target runtime qualification")
    if "CARGO_TARGET_DIR" not in full:
        raise WorkflowCheckError("external CARGO_TARGET_DIR not set")
    build_run = "\n".join(
        text(s) for s in steps if "run:" in text(s) or "run " in text(s))
    _ = build_run
    run_texts = [str(s.get("run", "")) for s in steps]
    build_idx = next((i for i, r in enumerate(run_texts)
                      if "build-quiche-owned.py" in r and "--source-dir" in r),
                     None)
    build_run_text = run_texts[build_idx] if build_idx is not None else ""
    if "matrix.target" not in build_run_text:
        raise WorkflowCheckError("build step must consume matrix.target")
    if any(hard in build_run_text for hard in
           ("linux-x64\n", " linux-x64 ", "linux-x64\n ")):
        raise WorkflowCheckError("build step must not hardcode linux-x64")
    for required, label in (
            ("test-build-quiche-owned.py", "builder self-tests"),
            ("test-validate-quiche-release.py", "release-gate tests"),
            ("test-quiche-workflow.py", "workflow-shape tests")):
        idx = next((i for i, r in enumerate(run_texts) if required in r),
                   None)
        if idx is None:
            raise WorkflowCheckError(f"{label} not run before build")
        if build_idx is not None and not idx < build_idx:
            raise WorkflowCheckError(f"{label} must run before the build")
    up = next((s for s in steps
               if "upload-artifact" in str(s.get("uses", ""))), None)
    if up is None:
        raise WorkflowCheckError("missing artifact upload")
    up_name = str(up.get("with", {}).get("name", ""))
    up_path = str(up.get("with", {}).get("path", ""))
    if ".zip" not in up_path or "manifest-" not in up_path:
        raise WorkflowCheckError("upload must name ZIP + manifest")
    if "matrix.target" not in up_name or "matrix.target" not in up_path:
        raise WorkflowCheckError("upload must be one ZIP+manifest per matrix target")
    for banned in ("libquiche.a", "quiche-target", "cargo-target"):
        if banned in up_path:
            raise WorkflowCheckError(
                f"upload must not include expanded {banned}")
    publish = jobs.get("publish", {})
    if publish.get("if") != "github.ref == 'refs/tags/%s'" % TAG:
        raise WorkflowCheckError("publish gate must be the exact tag ref")
    psteps = publish.get("steps", [])
    pruns = [str(s.get("run", "")) for s in psteps]
    val_idx = next((i for i, r in enumerate(pruns)
                    if "validate-quiche-release.py" in r), None)
    if val_idx is None:
        raise WorkflowCheckError(
            "publish must run the release validator first")
    if "--emit" not in pruns[val_idx]:
        raise WorkflowCheckError(
            "publish validator must --emit the validated asset list")
    rel_idx = next((i for i, r in enumerate(pruns)
                    if "gh release create" in r), None)
    if rel_idx is None:
        raise WorkflowCheckError("publish must create the release")
    if not val_idx < rel_idx:
        raise WorkflowCheckError("validator must run before gh release")
    rel = pruns[rel_idx]
    if "--verify-tag" not in rel:
        raise WorkflowCheckError("publish must never overwrite assets")
    if '"${ASSETS[@]}"' not in rel and "${ASSETS[@]}" not in rel:
        raise WorkflowCheckError(
            "publish must pass the validated asset array, not globs")
    for banned in ("quiche-owned-linux-x64/quiche-", "*.zip",
                   "dist-quiche/*", "dist-quiche/"):
        if banned in rel:
            raise WorkflowCheckError(
                f"publish must not hardcode or glob assets: {banned}")
    if 'test "${#ASSETS[@]}" -eq 18' not in rel:
        raise WorkflowCheckError("publish must assert all 18 asset files")
    return True


def check_patch_line_endings():
    """Patch hashes must see identical bytes on every checkout platform."""
    attributes = os.path.join(REPO, ".gitattributes")
    if not os.path.isfile(attributes):
        raise WorkflowCheckError("missing .gitattributes patch byte rule")
    with open(attributes, newline="") as f:
        lines = {line.strip() for line in f if line.strip() and
                 not line.lstrip().startswith("#")}
    rule = "packages/runtime-native/patches/*.patch -text"
    if rule not in lines:
        raise WorkflowCheckError(".gitattributes must mark hashed patches -text")
    for name in ("quiche-webtransport-ffi.patch", "quiche-ip-san.patch"):
        rel = f"packages/runtime-native/patches/{name}"
        result = subprocess.run(["git", "check-attr", "text", "--", rel],
                                cwd=REPO, capture_output=True, text=True,
                                check=False)
        if result.returncode != 0 or not result.stdout.rstrip().endswith(
                f"{rel}: text: unset"):
            raise WorkflowCheckError(
                f"git attributes do not keep {rel} byte-stable")


class WorkflowTests(unittest.TestCase):
    def test_candidate_parses_and_checks_green(self):
        self.assertTrue(check_workflow(load_workflow()))

    def test_hashed_patches_are_byte_stable(self):
        check_patch_line_endings()

    def test_missing_tag_trigger_rejected(self):
        import copy
        doc = copy.deepcopy(load_workflow())
        on = doc.get("on", doc.get(True))
        on["push"]["tags"] = ["quiche-owned-v2"]
        with self.assertRaises(WorkflowCheckError):
            check_workflow(doc)

    def test_path_filters_cover_validator_and_tests(self):
        import copy
        doc = copy.deepcopy(load_workflow())
        on = doc.get("on", doc.get(True))
        on["pull_request"]["paths"] = [
            p for p in on["pull_request"]["paths"]
            if "validate-quiche-release" not in p]
        with self.assertRaises(WorkflowCheckError):
            check_workflow(doc)

    def test_new_tests_run_before_build(self):
        import copy
        doc = copy.deepcopy(load_workflow())
        steps = doc["jobs"]["build"]["steps"]
        doc["jobs"]["build"]["steps"] = [
            s for s in steps
            if "test-validate-quiche-release" not in str(s.get("run", ""))]
        with self.assertRaises(WorkflowCheckError):
            check_workflow(doc)

    def test_publish_consumes_validated_list(self):
        import copy
        doc = copy.deepcopy(load_workflow())
        for s in doc["jobs"]["publish"]["steps"]:
            r = str(s.get("run", ""))
            if "gh release create" in r:
                s["run"] = r.replace('"${ASSETS[@]}"',
                                     "dist-quiche/*/*.zip")
        with self.assertRaises(WorkflowCheckError):
            check_workflow(doc)

    def test_missing_quiche_checkout_rejected(self):
        import copy
        doc = copy.deepcopy(load_workflow())
        steps = doc["jobs"]["build"]["steps"]
        doc["jobs"]["build"]["steps"] = [
            s for s in steps if "cloudflare/quiche" not in str(s)]
        with self.assertRaises(WorkflowCheckError):
            check_workflow(doc)

    def test_missing_engine_checkout_rejected(self):
        import copy
        doc = copy.deepcopy(load_workflow())
        steps = doc["jobs"]["build"]["steps"]
        def flat(s):
            w = s.get("with", "")
            if isinstance(w, dict):
                w = " ".join(f"{k}: {v}" for k, v in w.items())
            return str(w)
        doc["jobs"]["build"]["steps"] = [
            s for s in steps
            if not ("actions/checkout" in str(s.get("uses", ""))
                    and "path: engine" in flat(s))]
        with self.assertRaises(WorkflowCheckError):
            check_workflow(doc)

    def test_runs_from_repo_root_and_scripts_dir(self):
        if os.environ.get("TN_QW_NORECURSE") == "1":
            self.skipTest("subprocess probe; no recursion")
        import subprocess
        import sys
        env = dict(os.environ, TN_QW_NORECURSE="1")
        scripts = os.path.join(REPO, "packages", "runtime-native",
                               "scripts")
        lanes = {"candidate": _HERE, "integrated": scripts}
        for label, cwd in lanes.items():
            names = [f for f in os.listdir(cwd)
                     if f in ("test-validate-quiche-release.py",
                              "test-quiche-workflow.py")]
            if label == "integrated" and not names:
                continue  # tracked row not landed yet; candidate lane owns it
            for name in names:
                if name == os.path.basename(__file__):
                    continue  # this suite already proves itself; no self-spawn
                proc = subprocess.run(
                    [sys.executable, os.path.join(cwd, name)],
                    cwd=cwd if "scripts" in cwd else REPO,
                    capture_output=True, text=True, env=env, timeout=120)
                self.assertEqual(
                    proc.returncode, 0,
                    f"{label}/{name} from {cwd}:\n{proc.stderr[-2000:]}")

    def test_nine_target_matrix_entries(self):
        import copy
        doc = copy.deepcopy(load_workflow())
        rows = doc["jobs"]["build"]["strategy"]["matrix"]["include"]
        self.assertEqual(len(rows), 9)
        doc["jobs"]["build"]["strategy"]["matrix"]["include"] = [
            r for r in rows if r.get("target") != "android-armv7"]
        with self.assertRaises(WorkflowCheckError):
            check_workflow(doc)

    def test_missing_platform_provisioning_rejected(self):
        import copy
        doc = copy.deepcopy(load_workflow())
        for step in doc["jobs"]["build"]["steps"]:
            if "run" in step:
                step["run"] = step["run"].replace(
                    "armv7a-linux-androideabi21-clang", "")
        with self.assertRaises(WorkflowCheckError):
            check_workflow(doc)

    def test_missing_cmake_install_rejected(self):
        import copy
        doc = copy.deepcopy(load_workflow())
        for step in doc["jobs"]["build"]["steps"]:
            if "run" in step:
                step["run"] = step["run"].replace("cmake==4.4.2", "")
        with self.assertRaises(WorkflowCheckError):
            check_workflow(doc)


if __name__ == "__main__":
    unittest.main()
