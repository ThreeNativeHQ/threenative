/*
 * threenative-uinput-touch — create a virtual multitouch device, relay raw input_event bytes.
 *
 * The desktop conformance lane needs to place two simultaneous contacts on a ThreeNative window.
 * The runtime has handled multi-contact since `processTouchEvent` landed; nothing in this
 * repository has ever delivered one, so the desktop lane carries a registry exclusion and can
 * never exit 0.
 *
 * Why this exists in C rather than in the harness: writing `input_event` structs is plain bytes
 * and Node does that fine, but *creating* the device is a sequence of ioctls — UI_SET_EVBIT,
 * UI_SET_KEYBIT, UI_SET_ABSBIT, UI_SET_PROPBIT, UI_ABS_SETUP, UI_DEV_SETUP, UI_DEV_CREATE — and
 * Node exposes no ioctl. The Android lane never hits this because `sendevent` writes to a device
 * node the hardware already provides; the desktop lane has to make one.
 *
 * The split is deliberate: this program owns only the ioctls and the device's lifetime. Every
 * event is encoded in `conformance/desktop-touch.mjs`, where a unit test can assert that two
 * ABS_MT_SLOT groups precede one SYN_REPORT — the property that makes the contacts simultaneous
 * rather than sequential, and the one the shared proof contract checks.
 *
 * Protocol: writes "ready\n" to stdout once the kernel has created the device, then copies stdin
 * to the uinput fd verbatim until EOF, then destroys the device. A caller that dies takes the
 * device with it, because the fd closes and the kernel tears it down.
 *
 * Linux only. `uinput` is a Linux kernel interface and this program makes no claim about macOS
 * or Windows.
 */

#include <errno.h>
#include <fcntl.h>
#include <linux/uinput.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

/* Matches MULTITOUCH_PROOF_POINTS' coordinate space in conformance/android-touch.mjs: the
 * harness sends absolute device units and scales window geometry into them, so the range is a
 * fixed contract rather than a screen size. */
#define TN_ABS_MAX 65535
#define TN_MAX_SLOTS 9

static int set_bit(int fd, unsigned long request, int value, const char *what) {
    if (ioctl(fd, request, value) == 0) return 0;
    fprintf(stderr, "TN_DESKTOP_TOUCH_IOCTL_FAILED: %s: %s\n", what, strerror(errno));
    return -1;
}

static int setup_abs(int fd, unsigned short code, int minimum, int maximum) {
    struct uinput_abs_setup setup;
    memset(&setup, 0, sizeof(setup));
    setup.code = code;
    setup.absinfo.minimum = minimum;
    setup.absinfo.maximum = maximum;
    if (ioctl(fd, UI_ABS_SETUP, &setup) == 0) return 0;
    fprintf(stderr, "TN_DESKTOP_TOUCH_IOCTL_FAILED: UI_ABS_SETUP %u: %s\n", code, strerror(errno));
    return -1;
}

int main(void) {
    int fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK);
    if (fd < 0) {
        /* A machine that cannot inject must say so and block. It must never be mistaken for a
         * machine where the proof failed, and never for one where it passed. */
        fprintf(stderr, "TN_DESKTOP_TOUCH_UINPUT_UNAVAILABLE: open /dev/uinput: %s\n",
                strerror(errno));
        return 2;
    }

    if (set_bit(fd, UI_SET_EVBIT, EV_ABS, "UI_SET_EVBIT EV_ABS") != 0 ||
        set_bit(fd, UI_SET_EVBIT, EV_KEY, "UI_SET_EVBIT EV_KEY") != 0 ||
        set_bit(fd, UI_SET_EVBIT, EV_SYN, "UI_SET_EVBIT EV_SYN") != 0 ||
        set_bit(fd, UI_SET_KEYBIT, BTN_TOUCH, "UI_SET_KEYBIT BTN_TOUCH") != 0 ||
        /* INPUT_PROP_DIRECT is what makes this a touchscreen rather than a touchpad. Without it
         * the stack treats contacts as relative pointer input and the scene sees mouse moves. */
        set_bit(fd, UI_SET_PROPBIT, INPUT_PROP_DIRECT, "UI_SET_PROPBIT INPUT_PROP_DIRECT") != 0) {
        close(fd);
        return 1;
    }

    /* ABS_X/ABS_Y are deliberately NOT declared. Phase 0 observed that declaring them made the
     * kernel attach a `mouse3` handler to the same device (`H: Handlers=event23 mouse3`), so one
     * virtual device emitted both touch and mouse events — exactly the shape that produces a
     * passing row for the wrong reason. The MT axes alone are what the proof needs. */
    const unsigned short axes[] = {ABS_MT_SLOT, ABS_MT_TRACKING_ID, ABS_MT_POSITION_X,
                                   ABS_MT_POSITION_Y};
    for (size_t index = 0; index < sizeof(axes) / sizeof(axes[0]); index += 1) {
        if (set_bit(fd, UI_SET_ABSBIT, axes[index], "UI_SET_ABSBIT") != 0) {
            close(fd);
            return 1;
        }
    }
    if (setup_abs(fd, ABS_MT_SLOT, 0, TN_MAX_SLOTS) != 0 ||
        /* -1 is the tracking id that lifts a contact, so the range must admit it. */
        setup_abs(fd, ABS_MT_TRACKING_ID, -1, TN_ABS_MAX) != 0 ||
        setup_abs(fd, ABS_MT_POSITION_X, 0, TN_ABS_MAX) != 0 ||
        setup_abs(fd, ABS_MT_POSITION_Y, 0, TN_ABS_MAX) != 0) {
        close(fd);
        return 1;
    }

    struct uinput_setup device;
    memset(&device, 0, sizeof(device));
    device.id.bustype = BUS_VIRTUAL;
    device.id.vendor = 0x3117;
    device.id.product = 0x0001;
    snprintf(device.name, sizeof(device.name), "ThreeNative Virtual Touchscreen");
    if (ioctl(fd, UI_DEV_SETUP, &device) != 0 || ioctl(fd, UI_DEV_CREATE) != 0) {
        fprintf(stderr, "TN_DESKTOP_TOUCH_CREATE_FAILED: %s\n", strerror(errno));
        close(fd);
        return 1;
    }

    /* The caller waits for this line rather than sleeping a guessed interval: the kernel's
     * device-settle delay is real, and a race here is a flake later. */
    printf("ready\n");
    fflush(stdout);

    unsigned char buffer[4096];
    ssize_t got;
    int status = 0;
    while ((got = read(STDIN_FILENO, buffer, sizeof(buffer))) > 0) {
        ssize_t written = 0;
        while (written < got) {
            ssize_t chunk = write(fd, buffer + written, (size_t)(got - written));
            if (chunk <= 0) {
                if (errno == EINTR) continue;
                fprintf(stderr, "TN_DESKTOP_TOUCH_WRITE_FAILED: %s\n", strerror(errno));
                status = 1;
                goto teardown;
            }
            written += chunk;
        }
    }
    if (got < 0) {
        fprintf(stderr, "TN_DESKTOP_TOUCH_READ_FAILED: %s\n", strerror(errno));
        status = 1;
    }

teardown:
    /* Every exit path destroys the device. A stale virtual touchscreen surviving a thrown
     * injection is a second run finding two devices and aiming at the wrong one. */
    ioctl(fd, UI_DEV_DESTROY);
    close(fd);
    return status;
}
