<!-- schemaVersion: 1 -->

# Desktop multitouch — PRD-077 Phase 0 question 3, and a Phase 1 injector — 2026-08-15

Continues [`desktop-multitouch-2026-08-15.md`](desktop-multitouch-2026-08-15.md), which answered
two of Phase 0's three questions and left the third unexecuted. **The third is answered here, and
the answer is no on this host.** PRD-077's permitted-failure clause fires: the PRD stops at
`BLOCKED`, the registry exclusion stays, and its reason is rewritten to name the real blocker.

No mobile-readiness, physical-device, iOS or macOS/Windows claim is made anywhere in this file.
`uinput` is a Linux kernel interface and every result below is Linux-only.

## What was built, and what it is proved to do

The owner's decision on 2026-08-15 was **option A**: a small C helper compiled by the toolchain the
desktop lane already requires. `packages/runtime-native/tools/uinput_touch_device.c` owns only the
ioctl sequence and the device's lifetime; every event is encoded in
`packages/runtime-native/conformance/desktop-touch.mjs`, so the property that matters is a unit
test rather than a comment.

```console
$ cc -Wall -Wextra -o threenative-uinput-touch packages/runtime-native/tools/uinput_touch_device.c
(no output)

$ pnpm --filter @threenative/runtime-native exec vitest run tests/desktop-touch.test.mjs
 ✓ packages/runtime-native/tests/desktop-touch.test.mjs (12 tests) 305ms
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

### The device is created, enumerated, and correct

```console
$ node -e '<open the device, read /proc/bus/input/devices>'
settle ms: 6
I: Bus=0006 Vendor=3117 Product=0001 Version=0000
N: Name="ThreeNative Virtual Touchscreen"
S: Sysfs=/devices/virtual/input/input911
H: Handlers=event23
B: PROP=2
B: EV=b
B: KEY=400 0 0 0 0 0
B: ABS=260800000000000
wrote both frames, stderr: ""
closed
```

- `PROP=2` is `INPUT_PROP_DIRECT` — a touchscreen, not a touchpad.
- `EV=b` is `EV_SYN | EV_KEY | EV_ABS`; `KEY=400 …` is `BTN_TOUCH` and nothing else.
- `ABS=260800000000000` sets exactly bits 47, 53, 54 and 57 — `ABS_MT_SLOT`,
  `ABS_MT_POSITION_X`, `ABS_MT_POSITION_Y`, `ABS_MT_TRACKING_ID`.
- **Settle is 6ms and is waited for, not slept through.** The helper prints `ready` after
  `UI_DEV_CREATE` returns and the harness blocks on that line, so the kernel's settle delay cannot
  become a flake later.
- No device survived teardown: `grep -c 'ThreeNative Virtual Touchscreen' /proc/bus/input/devices`
  → `0`.

### Phase 0 finding 3b is closed, by measurement

The earlier spike declared `ABS_X`/`ABS_Y` alongside the MT axes and the kernel attached a mouse
interface to the same device. This helper declares the MT axes only:

```
H: Handlers=event23 mouse3      <- the Phase 0 spike
H: Handlers=event23             <- this helper
```

A virtual device emitting both touch and mouse events is the shape that produces a passing row for
the wrong reason. It is gone, and the reason it is gone is a `/proc` line rather than an argument.

### The viewport hazard was real, and reading geometry was not optional

The window under test does not fill the screen, so the full-screen assumption the PRD warned about
would have aimed both contacts at the wrong place:

```console
$ <run the 90-multitouch-input native bundle under scripts/xvfb.sh, read xdotool geometry>
[info] TN_CONFORMANCE_READY:90-multitouch-input
xdotool window ids: 2097198
geometry: {"x":160,"y":90,"width":1280,"height":720,"screenWidth":1600,"screenHeight":900}
```

A 1280×720 window inset at (160, 90) of a 1600×900 screen. `scaleToWindow` maps the shared
`MULTITOUCH_PROOF_POINTS` through that rectangle; a spec case asserts the result differs from the
full-screen mapping, so the hazard cannot silently return.

## Phase 0 question 3 — the answer is no on this host

**Does SDL3 receive the events?** Measured, with the real `90-multitouch-input` native bundle
running under the real desktop runtime:

```console
$ TN_UINPUT_TOUCH=… sh scripts/xvfb.sh node probe-sdl-touch.mjs
[info] TN_CONFORMANCE_READY:90-multitouch-input
--- scene ready, reading window geometry
geometry: {"x":160,"y":90,"width":1280,"height":720,"screenWidth":1600,"screenHeight":900}
virtual device created
contacts written; waiting for TN_MULTITOUCH_PROOF_PASS
TN_FRAME_HITCH:{"window":300,"maxMs":68.851,"maxAtFrame":179,"p99Ms":60.491,"p50Ms":43.799}

=== NO PROOF MARKER: SDL3 did not deliver the contacts to the scene
```

**The scene booted, the window was found, the device was created, the bytes were written without
error, and the scene observed nothing.** That is a complete negative result, not a run that failed
to reach its assertion.

### Why, and it is not the injector

Two independent host facts, either of which is sufficient:

**1. This user cannot read any input event node**, so SDL's direct evdev path is closed to the
process:

```console
$ ls -l /dev/input/event0
crw-rw---- 1 root input 13, 64 Aug  6 19:42 /dev/input/event0

$ id -nG
joao sys network docker nopasswdlogin rfkill users video storage lp audio wheel

$ getent group input
input:x:992:
```

The `input` group exists, is empty, and this user is not in it. Writing to `/dev/uinput` is granted
by an ACL — that is the earlier finding and it still holds — but **reading `/dev/input/event*` is
not**, and delivery is a read.

**2. Xvfb has no evdev input backend at all.** The lane runs headless through
`scripts/xvfb.sh` because that is how WebGPU works on this host. An Xvfb server supplies its own
dummy keyboard and pointer and never opens `/dev/input`, so an X11-driver SDL window under it
cannot receive a kernel input device's events however well-formed they are.

The bytes were written to a device that nothing downstream was reading. That is a host and
display-server fact; the injector did its job up to the kernel boundary and stopped there because
the boundary is where this host stops.

### What would unblock it, for the operator to decide — never applied by a script

Either, and both are host changes a conformance run must not make for itself:

| Path | Change | Cost |
|---|---|---|
| Grant evdev reads | `sudo usermod -aG input $USER`, or a udev rule granting this user `/dev/input/event*` | Widens what every process this user runs can read from every input device on the machine, including keystrokes. That is a real privacy decision and it is the operator's |
| Run the lane on a seated X server | Execute the desktop lane on a real X session with evdev configured, instead of under Xvfb | The lane would place contacts on the operator's live desktop. Aimed correctly it lands on the game window; aimed wrongly it clicks whatever is underneath |

## What was not done, and is not claimed

- **The seated-X-server path was not attempted.** It would place synthetic touch contacts on the
  operator's live desktop while they were away from the machine. Untried is the honest state; it is
  not recorded as a failure.
- **`registry.json` is unchanged.** The `desktop-multitouch-input` exclusion stands. Deleting it
  needs the scene to observe a contact, and it did not.
- **No claim that the runtime cannot do this.** `processTouchEvent` handles multi-contact, and
  nothing here tested it, because nothing reached it.
- **The runner is unmodified.** `runDesktop` is `spawnSync` and cannot inject mid-run; making it
  async is Phase 1's remaining half and is not worth landing before a host can deliver a contact.
- **No macOS or Windows claim.** `uinput` is Linux-only.
- The probe ran under Xvfb, so its renderer was software. That is irrelevant to this result — the
  assertion is about input reaching a scene, not about pixels — and no rendering claim is made
  from it.

## What this licenses

One sentence: *on this Linux host a virtual multitouch device can be created unprivileged, the
kernel enumerates it correctly as a direct touchscreen with no mouse interface attached, and the
harness can aim contacts at the real window rectangle — and no contact reaches an SDL3 window,
because this user cannot read `/dev/input/event*` and the headless server the lane runs on has no
evdev backend.*

It does not license deleting the exclusion, any statement about beta bar row 4, or any claim that
desktop multitouch works.
