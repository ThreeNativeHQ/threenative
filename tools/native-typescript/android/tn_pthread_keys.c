// More pthread keys than bionic has (PRD-507). Bionic allows 128 keys per process. Rust's std keeps
// every `thread_local!` of an Android target (no native TLS there) in its own pthread key, and
// Perry's runtime declares several hundred, so a Perry library aborts with "out of TLS keys" a few
// milliseconds in. Perry fixed this after v0.5.1520 (PerryTS/perry#10244) by pooling its own
// declarations behind one key; that fix is in no release yet and would change the runtime sources
// the compiler stamps. This object is linked into the library through PERRY_EXTRA_LINK_ARGS and
// defines the four key calls itself, so every caller in the library (Rust std, mimalloc, BoringSSL)
// gets virtual keys: one real key carries a per-thread table, and its destructor runs the virtual
// destructors in POSIX order. Drop it when the pin moves to a Perry release with the fix.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdlib.h>

enum { TN_KEY_COUNT = 8192, TN_DESTRUCTOR_PASSES = 4 };

typedef void (*tn_dtor_t)(void*);

static tn_dtor_t dtors[TN_KEY_COUNT];
static unsigned char used[TN_KEY_COUNT];
static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_once_t once = PTHREAD_ONCE_INIT;
static atomic_int ready;

static int (*real_create)(pthread_key_t*, tn_dtor_t);
static void* (*real_get)(pthread_key_t);
static int (*real_set)(pthread_key_t, const void*);
static pthread_key_t carrier;

static void run_destructors(void* table_pointer) {
    void** table = table_pointer;
    // Keep the table reachable while destructors run: they may read or set virtual keys.
    real_set(carrier, table);
    for (int pass = 0; pass < TN_DESTRUCTOR_PASSES; pass++) {
        int ran = 0;
        for (int key = 1; key < TN_KEY_COUNT; key++) {
            void* value = table[key];
            if (value == NULL || dtors[key] == NULL) continue;
            table[key] = NULL;
            dtors[key](value);
            ran = 1;
        }
        if (!ran) break;
    }
    real_set(carrier, NULL);
    free(table);
}

static void initialize(void) {
    real_create = (int (*)(pthread_key_t*, tn_dtor_t))dlsym(RTLD_NEXT, "pthread_key_create");
    real_get = (void* (*)(pthread_key_t))dlsym(RTLD_NEXT, "pthread_getspecific");
    real_set = (int (*)(pthread_key_t, const void*))dlsym(RTLD_NEXT, "pthread_setspecific");
    if (real_create == NULL || real_get == NULL || real_set == NULL || real_create(&carrier, run_destructors) != 0) abort();
    atomic_store(&ready, 1);
}

static void ensure(void) {
    if (!atomic_load(&ready)) pthread_once(&once, initialize);
}

int pthread_key_create(pthread_key_t* key, tn_dtor_t destructor) {
    ensure();
    pthread_mutex_lock(&lock);
    for (int index = 1; index < TN_KEY_COUNT; index++) {
        if (used[index]) continue;
        used[index] = 1;
        dtors[index] = destructor;
        pthread_mutex_unlock(&lock);
        *key = (pthread_key_t)index;
        return 0;
    }
    pthread_mutex_unlock(&lock);
    return EAGAIN;
}

int pthread_key_delete(pthread_key_t key) {
    if (key == 0 || key >= TN_KEY_COUNT) return EINVAL;
    pthread_mutex_lock(&lock);
    used[key] = 0;
    dtors[key] = NULL;
    pthread_mutex_unlock(&lock);
    return 0;
}

void* pthread_getspecific(pthread_key_t key) {
    if (key == 0 || key >= TN_KEY_COUNT) return NULL;
    ensure();
    void** table = real_get(carrier);
    return table == NULL ? NULL : table[key];
}

int pthread_setspecific(pthread_key_t key, const void* value) {
    if (key == 0 || key >= TN_KEY_COUNT) return EINVAL;
    ensure();
    void** table = real_get(carrier);
    if (table == NULL) {
        table = calloc(TN_KEY_COUNT, sizeof(void*));
        if (table == NULL) return ENOMEM;
        if (real_set(carrier, table) != 0) {
            free(table);
            return ENOMEM;
        }
    }
    table[key] = (void*)value;
    return 0;
}
