// Runs one Perry Android library as a program (PRD-507). Perry's Android target links a shared
// library whose `main` is the compiled TypeScript entry, so a pushed library has nothing to execute
// it. This loader opens the library, calls that `main`, and returns its exit code unchanged. It also
// prints the process's peak resident set to stderr, because the library runs inside this process and
// the corpus holds alloc-loop to a resident-set ceiling.
#include <dlfcn.h>
#include <stdio.h>
#include <sys/resource.h>

// Exit codes a corpus case never returns (every case exits 0 or a small code of its own).
enum { TN_USAGE = 120, TN_DLOPEN = 121, TN_NO_MAIN = 122 };

int main(int argc, char** argv) {
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
