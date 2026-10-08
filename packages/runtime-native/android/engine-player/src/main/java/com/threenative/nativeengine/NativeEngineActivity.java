package com.threenative.nativeengine;

import java.io.File;
import org.libsdl.app.SDLActivity;

/** JS-free SDL entry; the runner supplies the existing Android file mailbox. */
public final class NativeEngineActivity extends SDLActivity {
    @Override protected String[] getLibraries() {
        return new String[] { "SDL3", "tn-native-engine-player" };
    }
    @Override protected String getMainFunction() { return "SDL_main"; }
    @Override protected String[] getArguments() {
        String game = getIntent().getStringExtra("TN_NATIVE_GAME");
        String root = getIntent().getStringExtra("TN_PLAYTEST_MAILBOX_ROOT");
        if (root == null) {
            File external = getExternalFilesDir(null);
            if (external == null) throw new IllegalStateException("TN_PLAYER_MAILBOX_UNAVAILABLE");
            root = external.getAbsolutePath();
        }
        File directory = new File(root);
        if (!directory.isDirectory() && !directory.mkdirs()) {
            throw new IllegalStateException("TN_PLAYER_MAILBOX_UNAVAILABLE: " + root);
        }
        return new String[] { game == null ? "inspect-demo" : game, root };
    }
}
