# Desktop multitouch — PRD-077 Phase 0, partial — 2026-08-15

Phase 0 of [PRD-077](../PRDs/alpha-readiness/PRD-077-desktop-multitouch-injector.md) asks three
questions about this host. **Two are answered here, with commands and output pasted. The third
was not attempted and is recorded as unexecuted.** No Phase 1 work is authorised by this
document; no row was run, no registry exclusion was touched, and no beta-bar claim is made.

## The three questions, and their state

| # | Phase 0 question | Answer |
|---|---|---|
| 1 | Can the process open `/dev/uinput` unprivileged, and if not, what udev rule would grant it? | **Yes, unprivileged. No udev rule is needed on this host.** |
| 2 | Does the kernel enumerate a virtual multitouch device with the `ABS_MT_*` bits set? | **Yes**, at `/devices/virtual/input/input910`, handler `event23` |
| 3 | Does SDL3 see it, how long does it take to settle, and what window geometry must contacts be aimed at? | **Unexecuted** — needs the opt-in native build and a GPU-backed X11 run, both held this window |

## 1. `/dev/uinput` is openable by this user, through an ACL

```console
$ ls -l /dev/uinput
crw-rw----+ 1 root root 10, 223 Aug  7 19:18 /dev/uinput
```

The trailing `+` is the finding. The mode bits alone say `root:root rw-rw----` and this user is
in neither, so a mode-only read of that line concludes "permission denied" — which is what the
PRD anticipated and what would have ended it `BLOCKED`. The ACL says otherwise:

```console
$ getfacl -p /dev/uinput
# file: /dev/uinput
# owner: root
# group: root
user::rw-
user:joao:rw-
group::---
mask::rw-
other::---
```

`user:joao:rw-` is an explicit ACL entry. Confirmed by opening it rather than by reading the
permissions, because a permission bit is an argument and an open is a measurement:

```console
$ node -e 'const fs=require("fs");const fd=fs.openSync("/dev/uinput","w");console.log("OPEN_OK fd="+fd);fs.closeSync(fd);'
OPEN_OK fd=17
```

The `uinput` module is loaded (`lsmod | grep uinput` → `uinput 28672 0`).

**Consequence for PRD-077:** its permitted-failure branch — *Phase 0 ends BLOCKED on host
permissions, the exclusion stays and its reason is corrected to name the permission* — **does
not fire on this host.** The `desktop-multitouch-input` exclusion cannot be re-justified as a
permission problem here. It remains what it says it is: a missing injector.

## 2. The kernel enumerates the virtual device with the right bits

A C spike created a virtual touchscreen, held it for 600ms, and destroyed it. Output, with the
kernel's own device stanza read from `/proc/bus/input/devices` while it was alive:

```console
$ sh run-uinput-spike.sh
=== before ===
0
=== while alive ===
N: Name="threenative-prd077-spike"
P: Phys=
S: Sysfs=/devices/virtual/input/input910
U: Uniq=
H: Handlers=event23 mouse3
B: PROP=2
B: EV=b
B: KEY=400 0 0 0 0 0
B: ABS=260800000000003

=== event node ===
event23
OPEN_OK
BITS_SET
DEV_CREATED
SETTLED
DEV_DESTROYED
=== after ===
0
```

Decoding the bitmasks, because "it appeared" is not the same as "it appeared correctly":

| Field | Value | Means |
|---|---|---|
| `PROP=2` | bit 1 | `INPUT_PROP_DIRECT` — a touchscreen, not a touchpad. This is the bit that decides which of the two the kernel thinks it is |
| `EV=b` | bits 0, 1, 3 | `EV_SYN`, `EV_KEY`, `EV_ABS` |
| `KEY=400 0 0 0 0 0` | bit 0x14a | `BTN_TOUCH` (330) |
| `ABS=260800000000003` | bits 0, 1, 47, 53, 54, 57 | `ABS_X`, `ABS_Y`, `ABS_MT_SLOT` (47), `ABS_MT_POSITION_X` (53), `ABS_MT_POSITION_Y` (54), `ABS_MT_TRACKING_ID` (57) |

Every `ABS_MT_*` code the Android lane already writes (`conformance/android-touch.mjs:1-15`) is
present on the virtual device. `=== before ===` and `=== after ===` both report `0` matching
lines, so the device did not exist before the spike and did not survive it — the cleanup path
works, which is the third of PRD-077's Phase 1 tests answered early.

**Script exit code note:** the wrapper exits `1` because its last command is
`grep -c ... /proc/bus/input/devices`, and `grep -c` exits `1` when the count is `0`. The `0`
is the desired result. Recorded so nobody reads that exit code as a failed spike.

## 3. Two findings that change PRD-077's plan

### 3a. The injector cannot be pure Node, and the PRD assumes it can

PRD-077's key decisions say: *"Node writes the `input_event` structs directly with a `Buffer`.
No new dependency — the Android lane already hand-assembles the same events."*

That is true of **writing events** and false of **creating the device**. Device creation is a
sequence of ioctls — `UI_SET_EVBIT`, `UI_SET_KEYBIT`, `UI_SET_ABSBIT`, `UI_SET_PROPBIT`,
`UI_ABS_SETUP`, `UI_DEV_SETUP`, `UI_DEV_CREATE` — and Node exposes no ioctl:

```console
$ node -e 'console.log("ioctl in fs:", typeof require("fs").ioctl)'
ioctl in fs: undefined
```

The Android lane avoids this because `sendevent` writes to a device node Android's hardware
already provides; nothing in that lane ever *creates* a device. The desktop lane has to.

Three options, none free, and this is an owner decision rather than an implementation detail:

| Option | Cost |
|---|---|
| A small C helper compiled by the existing opt-in native toolchain | Consistent — the desktop parity lane already requires `TN_RUNTIME`, which already requires `pnpm native:build`. Adds no dependency the lane did not already have |
| An npm addon (`ioctl`, `node-uinput`) | A new native dependency in the harness, rebuilt per Node version. Contradicts the PRD's stated "no new dependency" |
| `python3` with `fcntl.ioctl` | Present on this host, but introduces a Python toolchain dependency the repository does not otherwise have |

Option A is the one that fits the repository's existing shape, and the spike above is already
that helper in miniature. Recorded here rather than chosen, because the PRD's decision list says
otherwise and a decision list is edited by its owner.

### 3b. The kernel also attached a `mouse3` handler

`H: Handlers=event23 mouse3`. Declaring `ABS_X`/`ABS_Y` alongside the `ABS_MT_*` codes made the
kernel expose a mouse interface for the same device. `platform/input.cpp:380,451` already guards
the mouse path with `event.which != SDL_TOUCH_MOUSEID`, so this is probably harmless — but
"probably" is not a measurement, and a virtual device that emits both touch and mouse events is
exactly the sort of thing that produces a passing row for the wrong reason. Phase 1 should
either drop `ABS_X`/`ABS_Y` or prove the mouse handler contributes nothing, with the drop
observed as a control.

## 4. What was not done

- **SDL3 was not asked whether it sees the device.** That is question 3 and it needs
  `pnpm native:build` plus a GPU-backed X11 run of the `multitouch-input` scene. Both were held:
  another session was running a headed Chromium gate on the shared GPU in this window.
- **No contact was delivered to a running game.** Bytes were written to no device beyond
  creation; the injection path is Phase 1.
- **`registry.json` is untouched.** The `desktop-multitouch-input` exclusion still stands, still
  owned by PRD-064, and the desktop lane still exits `2` by construction.
- **No claim is made for macOS or Windows.** `uinput` is a Linux kernel interface and this
  result covers Linux only.

## 5. What this licenses

One sentence: *on this Linux host, a virtual multitouch device can be created unprivileged and
the kernel enumerates it as a direct touchscreen carrying every `ABS_MT_*` code the existing
Android injector writes.*

It does not license: that SDL3 receives those events, that the scene observes them, that the
proof contract passes, that the exclusion can be deleted, or any statement about beta bar row 4.
