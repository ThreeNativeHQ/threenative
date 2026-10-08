// Runs one Perry Android library as a program (PRD-507). Perry's Android target links a shared
// library whose `main` is the compiled TypeScript entry, so a pushed library has nothing to execute
// it. This loader opens the library, calls that `main`, and returns its exit code unchanged. It also
// prints the process's peak resident set to stderr, because the library runs inside this process and
// the corpus holds alloc-loop to a resident-set ceiling.
//
// It also turns native heap pointer tagging off before anything is loaded. From Android 11 bionic
// returns malloc pointers with a tag in the top byte (0xb4...), and Perry v0.5.1520 compares and
// range-checks addresses as plain 48-bit values, so a tagged arena misclassifies every object it
// owns: object shapes read as unknown, stores past the second slot are dropped, and console.log
// prints empty strings. An app opts out with android:allowNativeHeapPointerTagging="false".
#include <dlfcn.h>
#include <stdio.h>
#include <sys/resource.h>

// Exit codes a corpus case never returns (every case exits 0 or a small code of its own).
enum { TN_USAGE = 120, TN_DLOPEN = 121, TN_NO_MAIN = 122 };

// <malloc.h> declares these from API 26; the corpus targets API 24, so they are spelled here.
enum { TN_BIONIC_SET_HEAP_TAGGING_LEVEL = -204, TN_HEAP_TAGGING_LEVEL_NONE = 0 };

static void disable_heap_tagging(void) {
    int (*set_option)(int, int) = (int (*)(int, int))dlsym(RTLD_DEFAULT, "mallopt");
    if (set_option != NULL) set_option(TN_BIONIC_SET_HEAP_TAGGING_LEVEL, TN_HEAP_TAGGING_LEVEL_NONE);
}

int main(int argc, char** argv) {
    disable_heap_tagging();
    if (argc < 2) {
        fprintf(stderr, "usage: tn_so_runner <library.so>\n");
        return TN_USAGE;
    }
    void* library = dlopen(argv[1], RTLD_NOW | RTLD_GLOBAL);
    if (library == NULL) {
        fprintf(stderr, "TN_SO_DLOPEN %s\n", dlerror());
        return TN_DLOPEN;
    }
    int (*entry)(int, char**) = (int (*)(int, char**))dlsym(library, "main");
    if (entry == NULL) {
        fprintf(stderr, "TN_SO_NO_MAIN %s\n", dlerror());
        return TN_NO_MAIN;
    }
    const int status = entry(argc - 1, argv + 1);
    fflush(NULL);
    struct rusage usage;
    if (getrusage(RUSAGE_SELF, &usage) == 0) fprintf(stderr, "TN_PEAK_RSS_KB %ld\n", usage.ru_maxrss);
    return status;
}
