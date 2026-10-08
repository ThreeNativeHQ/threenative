// Calls the `main` of a Perry Android library inside the app process (PRD-507). Perry's Android
// target links a shared library whose `main` is the compiled TypeScript entry. Standard output and
// error are redirected to files for the call, because the app has no terminal, and restored after.
#include <dlfcn.h>
#include <fcntl.h>
#include <jni.h>
#include <stdio.h>
#include <unistd.h>

// Codes a corpus case never returns, matching tn_so_runner.c.
enum { TN_DLOPEN = 121, TN_NO_MAIN = 122, TN_REDIRECT = 123 };

static int redirect(int target, const char* path) {
    const int saved = dup(target);
    const int file = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (saved < 0 || file < 0 || dup2(file, target) < 0) return -1;
    close(file);
    return saved;
}

JNIEXPORT jint JNICALL Java_com_threenative_corpusplayer_CorpusActivity_runMain(
        JNIEnv* env, jclass cls, jstring soname, jstring stdoutPath, jstring stderrPath) {
    (void)cls;
    const char* name = (*env)->GetStringUTFChars(env, soname, NULL);
    const char* out = (*env)->GetStringUTFChars(env, stdoutPath, NULL);
    const char* err = (*env)->GetStringUTFChars(env, stderrPath, NULL);
    int status = TN_DLOPEN;
    void* library = dlopen(name, RTLD_NOW | RTLD_GLOBAL);
    const int savedOut = redirect(1, out);
    const int savedErr = redirect(2, err);
    if (savedOut < 0 || savedErr < 0) {
        status = TN_REDIRECT;
    } else if (library == NULL) {
        fprintf(stderr, "TN_SO_DLOPEN %s\n", dlerror());
    } else {
        int (*entry)(int, char**) = (int (*)(int, char**))dlsym(library, "main");
        if (entry == NULL) {
            fprintf(stderr, "TN_SO_NO_MAIN %s\n", dlerror());
            status = TN_NO_MAIN;
        } else {
            char* argv[] = {(char*)name, NULL};
            status = entry(1, argv);
        }
    }
    fflush(NULL);
    if (savedOut >= 0) dup2(savedOut, 1);
    if (savedErr >= 0) dup2(savedErr, 2);
    (*env)->ReleaseStringUTFChars(env, soname, name);
    (*env)->ReleaseStringUTFChars(env, stdoutPath, out);
    (*env)->ReleaseStringUTFChars(env, stderrPath, err);
    return status;
}
