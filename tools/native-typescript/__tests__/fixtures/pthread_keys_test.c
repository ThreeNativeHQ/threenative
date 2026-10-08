// Host check of android/tn_pthread_keys.c, built as a shared library whose `main` the loader calls:
// the shape of a Perry Android library. The shim is linked into the library, so its key calls bind
// to the library's own definitions (-Bsymbolic), as they do over bionic's. glibc allows 1024 keys,
// bionic 128; the test asks for 2000, so it fails without the shim on either.
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>

enum { KEYS = 2000 };

static pthread_key_t keys[KEYS];
static int destroyed;

static void destroy(void* value) {
    destroyed++;
    free(value);
}

static void* worker(void* unused) {
    (void)unused;
    for (int i = 0; i < KEYS; i++) {
        int* value = malloc(sizeof *value);
        *value = i;
        if (pthread_setspecific(keys[i], value) != 0) exit(10);
    }
    for (int i = 0; i < KEYS; i++) {
        if (*(int*)pthread_getspecific(keys[i]) != i) exit(11);
    }
    return NULL;
}

// The second thread sets `old`, then parks until the main thread has deleted and recreated the key,
// and only then reads the new key: it must find nothing, though its own slot for the old one is set.
static pthread_barrier_t gate;
static pthread_key_t old, again;
static void* stale;

static void* leaver(void* unused) {
    (void)unused;
    pthread_setspecific(old, &destroyed);
    pthread_barrier_wait(&gate);  // set
    pthread_barrier_wait(&gate);  // deleted and recreated
    stale = pthread_getspecific(again);
    return NULL;
}

int main(void) {
    for (int i = 0; i < KEYS; i++) {
        if (pthread_key_create(&keys[i], destroy) != 0) return 1;
    }
    // A thread sees none of the main thread's values.
    pthread_setspecific(keys[5], &destroyed);
    pthread_t thread;
    pthread_create(&thread, NULL, worker, NULL);
    pthread_join(thread, NULL);
    if (pthread_getspecific(keys[5]) != &destroyed) return 2;
    if (destroyed != KEYS) {
        fprintf(stderr, "destructors ran %d times, expected %d\n", destroyed, KEYS);
        return 3;
    }
    // A deleted key can be handed out again, and the new one holds nothing in any thread,
    // including one that set the old key and is still alive.
    pthread_barrier_init(&gate, NULL, 2);
    pthread_key_create(&old, NULL);
    pthread_t other;
    pthread_create(&other, NULL, leaver, NULL);
    pthread_barrier_wait(&gate);
    pthread_key_delete(old);
    if (pthread_key_create(&again, NULL) != 0 || again != old) return 4;
    pthread_barrier_wait(&gate);
    pthread_join(other, NULL);
    if (stale != NULL) return 5;
    puts("keys ok");
    return 0;
}
