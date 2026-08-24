/*
 * xcompmin — the smallest thing that counts as a compositing manager.
 *
 * The desktop UI overlay refuses to attach unless one is running, because nothing would blend
 * its ARGB window over the game (`ui_overlay.cpp`). That guard is right on a user's machine and
 * fatal in a test lane: `Xvfb` ships no compositor, and the only one installed on a typical
 * Linux desktop is the session's own, which cannot be pointed at a headless display.
 *
 * So this owns `_NET_WM_CM_S<screen>` — the selection every toolkit reads to answer "is anything
 * compositing?" — and turns on automatic sub-window redirection, which makes the X server itself
 * blend redirected windows into the root. That is real compositing, not a stub that lies to the
 * guard: a screenshot of the root shows the overlay blended over the game.
 *
 * Test fixture only. It is not built by `pnpm native:build` and ships in no package.
 *
 *   cc tools/xcompmin.c -o xcompmin -lX11 -lXcomposite && DISPLAY=:3 ./xcompmin
 */
#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <X11/extensions/Xcomposite.h>
#include <stdio.h>
#include <unistd.h>

int main(void) {
    Display *display = XOpenDisplay(NULL);
    if (!display) {
        fprintf(stderr, "xcompmin: no display\n");
        return 2;
    }
    int screen = DefaultScreen(display);
    int event_base = 0, error_base = 0;
    if (!XCompositeQueryExtension(display, &event_base, &error_base)) {
        fprintf(stderr, "xcompmin: this server has no Composite extension\n");
        return 2;
    }

    char selection_name[32];
    snprintf(selection_name, sizeof selection_name, "_NET_WM_CM_S%d", screen);
    Atom selection = XInternAtom(display, selection_name, False);
    Window owner = XCreateSimpleWindow(display, RootWindow(display, screen), -1, -1, 1, 1, 0, 0, 0);
    XSetSelectionOwner(display, selection, owner, CurrentTime);
    if (XGetSelectionOwner(display, selection) != owner) {
        fprintf(stderr, "xcompmin: %s is already owned\n", selection_name);
        return 1;
    }

    XCompositeRedirectSubwindows(display, RootWindow(display, screen), CompositeRedirectAutomatic);
    XSync(display, False);
    printf("xcompmin: compositing %s\n", selection_name);
    fflush(stdout);

    /* Nothing else to do: automatic redirection means the server does the blending. Stay alive,
     * because dropping the connection drops the selection and un-redirects every window. */
    for (;;) {
        XEvent event;
        XNextEvent(display, &event);
    }
}
