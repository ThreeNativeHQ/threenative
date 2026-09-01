#!/usr/bin/env python3
"""Capture deterministic runtime proof through Chromium + SwiftShader."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import signal
import socket
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]


def free_port() -> int:
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = int(sock.getsockname()[1])
    sock.close()
    return port


async def capture() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("comparison", "debug", "invalidation"), default="comparison")
    parser.add_argument("--output", default="report/comparison.png")
    parser.add_argument("--width", type=int, default=1600)
    parser.add_argument("--height", type=int, default=900)
    parser.add_argument("--warmup-frames", type=int, default=24)
    parser.add_argument("--invalidation-frame", type=int, default=34)
    parser.add_argument("--timeout", type=int, default=180)
    args = parser.parse_args()

    standalone = ROOT / "standalone.html"
    if not standalone.exists():
        subprocess.run(["python3", str(ROOT / "scripts/build_standalone.py")], check=True)

    config = {
        "mode": args.mode,
        "width": args.width,
        "height": args.height,
        "warmupFrames": args.warmup_frames,
        "invalidationFrame": args.invalidation_frame,
        "captureMode": True,
    }
    html = standalone.read_text(encoding="utf-8")
    marker = "window.__TN_VSM_CONFIG__ = {};"
    if marker not in html:
        raise RuntimeError("standalone config marker is missing")
    html = html.replace(
        marker,
        f"window.__TN_VSM_CONFIG__ = {json.dumps(config)};",
        1,
    )

    output = ROOT / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    diagnostics_path = output.with_suffix(".json")
    chromium_log_path = output.with_suffix(".chromium.log")
    port = free_port()
    profile = tempfile.mkdtemp(prefix="tn-vshadow-proof-")
    command = [
        "xvfb-run", "-a", "/usr/bin/chromium",
        f"--remote-debugging-port={port}",
        f"--user-data-dir={profile}",
        "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu-sandbox",
        "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader",
        "--ignore-gpu-blocklist", "--enable-webgl",
        "--disable-features=Translate,MediaRouter", "--hide-scrollbars",
        f"--window-size={args.width},{args.height}",
        "about:blank",
    ]
    chromium_log = chromium_log_path.open("w", encoding="utf-8")
    process = subprocess.Popen(
        command,
        stdout=chromium_log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
        text=True,
    )

    console_errors: list[str] = []
    console_warnings: list[str] = []
    try:
        endpoint = f"http://127.0.0.1:{port}"
        deadline = time.time() + 30
        while True:
            try:
                with urllib.request.urlopen(endpoint + "/json/version", timeout=1) as response:
                    if response.status == 200:
                        break
            except Exception:
                if process.poll() is not None:
                    raise RuntimeError(f"Chromium exited before CDP was ready: {process.returncode}")
                if time.time() > deadline:
                    raise RuntimeError("Timed out waiting for Chromium CDP endpoint")
                time.sleep(0.15)

        async with async_playwright() as playwright:
            browser = await playwright.chromium.connect_over_cdp(endpoint)
            context = browser.contexts[0] if browser.contexts else await browser.new_context()
            page = context.pages[0] if context.pages else await context.new_page()
            await page.set_viewport_size({"width": args.width, "height": args.height})

            def on_console(message) -> None:
                line = f"{message.type}: {message.text}"
                if message.type == "error":
                    console_errors.append(line)
                elif message.type == "warning":
                    console_warnings.append(line)

            page.on("console", on_console)
            page.on("pageerror", lambda error: console_errors.append(f"pageerror: {error}"))
            await page.set_content(html, wait_until="load", timeout=args.timeout * 1000)
            await page.wait_for_function(
                "window.__TN_VSM_READY__ === true || Boolean(window.__TN_VSM_ERROR__)",
                timeout=args.timeout * 1000,
                polling=100,
            )
            runtime_error = await page.evaluate("window.__TN_VSM_ERROR__ || null")
            debug = await page.evaluate("window.__TN_VSM_DEBUG__ || null")
            if runtime_error:
                raise RuntimeError(runtime_error + "\n" + "\n".join(console_errors))
            if not debug:
                raise RuntimeError("runtime reached ready state without a proof object")

            await page.wait_for_timeout(100)
            await page.screenshot(path=str(output), full_page=False)
            payload = {
                "mode": args.mode,
                "config": config,
                "debug": debug,
                "console_errors": console_errors,
                "console_warnings": console_warnings,
            }
            diagnostics_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            print(json.dumps({
                "output": str(output),
                "mode": args.mode,
                "frame": debug.get("frame"),
                "stats": debug.get("stats"),
                "assertions": debug.get("assertions"),
                "console_errors": console_errors,
            }, indent=2))
            await browser.close()
    except Exception as error:
        diagnostics_path.write_text(json.dumps({
            "mode": args.mode,
            "config": config,
            "error": str(error),
            "console_errors": console_errors,
            "console_warnings": console_warnings,
            "chromium_log": str(chromium_log_path.relative_to(ROOT)),
            "chromium_returncode": process.returncode,
        }, indent=2), encoding="utf-8")
        raise
    finally:
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=5)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        chromium_log.flush()
        chromium_log.close()
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(capture())
