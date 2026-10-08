package com.threenative.corpusplayer;

import android.app.Activity;
import android.os.Bundle;
import android.util.Log;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

/**
 * Runs the corpus library named by the "lib" intent extra inside this app process and leaves
 * stdout.bin, stderr.txt and exit.txt in the files directory, in that order: exit.txt appearing
 * means the other two are complete. The run goes on a thread with the stack a host `main` gets,
 * because a Java thread's default 1 MB stack is smaller than what the corpus is written against.
 */
public final class CorpusActivity extends Activity {
    private static final String TAG = "TnCorpus";
    private static final long STACK_BYTES = 8L * 1024 * 1024;

    static {
        System.loadLibrary("corpusplayer");
    }

    private static native int runMain(String soname, String stdoutPath, String stderrPath);

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        final String lib = getIntent().getStringExtra("lib");
        final File dir = getFilesDir();
        for (String name : new String[] {"stdout.bin", "stderr.txt", "exit.txt"}) new File(dir, name).delete();
        if (lib == null) {
            Log.e(TAG, "TN_CORPUS_NO_LIB: pass --es lib <name>");
            finish();
            return;
        }
        new Thread(null, () -> {
            final int code = runMain("lib" + lib + ".so", new File(dir, "stdout.bin").getPath(),
                    new File(dir, "stderr.txt").getPath());
            try (FileOutputStream out = new FileOutputStream(new File(dir, "exit.txt"))) {
                out.write(Integer.toString(code).getBytes());
            } catch (IOException e) {
                Log.e(TAG, "TN_CORPUS_EXIT_WRITE " + e);
            }
            Log.i(TAG, "TN_CORPUS_DONE " + lib + " exit=" + code);
        }, "corpus-main", STACK_BYTES).start();
    }
}
