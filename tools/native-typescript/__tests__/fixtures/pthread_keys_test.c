// Host check of android/tn_pthread_keys.c: linked into an executable, its definitions take
// precedence over libc's, as they do over bionic's inside a Perry library.
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>

enum { KEYS = 1000 };

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
    // A deleted key can be handed out again, and a new one holds nothing.
    pthread_key_delete(keys[7]);
    pthread_key_t again;
    if (pthread_key_create(&again, NULL) != 0 || pthread_getspecific(again) != NULL) return 4;
    puts("keys ok");
    return 0;
}
