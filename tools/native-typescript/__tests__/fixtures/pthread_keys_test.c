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

static void* leaver(void* slot) {
    pthread_setspecific(*(pthread_key_t*)slot, &destroyed);
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
    // including a thread that set the old one and is still alive.
    pthread_key_t old;
    pthread_key_create(&old, NULL);
    pthread_setspecific(old, &destroyed);
    pthread_t other;
    pthread_create(&other, NULL, leaver, &old);
    pthread_join(other, NULL);
    pthread_key_delete(old);
    pthread_key_t again;
    if (pthread_key_create(&again, NULL) != 0 || again != old) return 4;
    if (pthread_getspecific(again) != NULL) return 5;
    puts("keys ok");
    return 0;
}
