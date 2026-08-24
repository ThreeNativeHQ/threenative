package com.threenative.runtime;

import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import org.libsdl.app.SDLActivity;

/**
 * MystralActivity - Main entry point for Mystral Native on Android.
 *
 * Extends SDLActivity which handles:
 * - Native library loading
 * - Surface creation (ANativeWindow)
 * - Input events (touch, keyboard, gamepad)
 * - Lifecycle management (pause/resume)
 *
 * The SDL3 Android backend provides the native window to wgpu-native
 * for Vulkan surface creation.
 */
public class MystralActivity extends SDLActivity {

    private Bundle applicationMetadata() {
        try {
            ApplicationInfo applicationInfo = getPackageManager().getApplicationInfo(
                getPackageName(), PackageManager.GET_META_DATA);
            return applicationInfo.metaData;
        } catch (PackageManager.NameNotFoundException exception) {
            return null;
        }
    }

    /**
     * Return top, right, bottom and left display cutout/system-bar insets in drawable pixels.
     * Native refreshes this coarse value when SDL reports a resize or system-bar change.
     */
    public int[] getSafeAreaInsets() {
        View decor = getWindow().getDecorView();
        WindowInsets windowInsets = decor.getRootWindowInsets();
        if (windowInsets == null) return new int[] {0, 0, 0, 0};
        Insets insets = windowInsets.getInsets(
            WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
        return new int[] {insets.top, insets.right, insets.bottom, insets.left};
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Bundle metadata = applicationMetadata();
        applyOrientation(metadata);
        if (metadata != null && metadata.getBoolean("TN_KEEP_SCREEN_ON", false)) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
    }

    /**
     * Re-assert the declared orientation from the activity itself.
     *
     * `android:screenOrientation` is already written into the manifest by the packager, and on
     * this device it was not enough: a landscape-declared build still came up in portrait, because
     * the activity declares `configChanges=...|orientation|screenSize`, so the system hands
     * rotation to the app instead of recreating it, and recent Android releases increasingly treat
     * the manifest value as advisory. Calling `setRequestedOrientation` in `onCreate` is the
     * request the window manager honours, and it costs nothing when the manifest already agreed.
     *
     * `sensor` is deliberately the only value that leaves rotation to the user; `landscape` and
     * `portrait` lock, and landscape allows both ways up so the phone can be held either way.
     */
    private void applyOrientation(Bundle metadata) {
        String orientation = metadata == null ? null : metadata.getString("TN_ORIENTATION");
        if (orientation == null) return;
        switch (orientation) {
            case "landscape":
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                break;
            case "portrait":
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT);
                break;
            default:
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                break;
        }
    }

    /**
     * Override to specify which native libraries to load.
     * SDL handles loading SDL3, then we load mystral-runtime.
     */
    @Override
    protected String[] getLibraries() {
        return new String[] {
            "SDL3",
            "mystral-runtime"
        };
    }

    /**
     * Override to specify the main function.
     * This is called by SDL after the libraries are loaded.
     */
    @Override
    protected String getMainFunction() {
        return "SDL_main";
    }

    /**
     * Get command line arguments for the main function.
     * Can be used to specify the script path.
     */
    @Override
    protected String[] getArguments() {
        String endpoint = getIntent().getStringExtra("TN_PLAYTEST_ENDPOINT");
        String mailboxRoot = getIntent().getStringExtra("TN_PLAYTEST_MAILBOX_ROOT");
        Bundle metadata = applicationMetadata();
        String title = metadata == null ? "ThreeNative" : metadata.getString("TN_WINDOW_TITLE", "ThreeNative");
        boolean fullscreen = metadata == null || metadata.getBoolean("TN_FULLSCREEN", true);
        // `display.backgroundMode`. The native side parses it and keeps "pause" for anything it
        // does not recognize, so an unset value and a typo behave the same and both get logged.
        String backgroundMode = metadata == null ? "pause" : metadata.getString("TN_BACKGROUND_MODE", "pause");
        if (mailboxRoot == null) {
            java.io.File externalFiles = getExternalFilesDir(null);
            mailboxRoot = externalFiles == null ? getFilesDir().getAbsolutePath() : externalFiles.getAbsolutePath();
        }
        return new String[] {
            "asset://scripts/main.js",
            endpoint == null ? "" : endpoint,
            mailboxRoot,
            title,
            Boolean.toString(fullscreen),
            backgroundMode == null ? "pause" : backgroundMode
        };
    }
}
