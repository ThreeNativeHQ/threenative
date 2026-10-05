// The C side of the native-TypeScript `three` module (PRD-506). tslang reaches a C symbol with
// scalar and string arguments only (tsbindgen skips structs passed by value), so this shim keeps
// engine handles in a table and hands TypeScript the slot, and call arguments are staged one at a
// time before the call that consumes them. An engine refusal prints its diagnostic and returns the
// sentinel the facade checks.
#include "threenative/abi/tn_abi.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum { TNX_MAX_OBJECTS = 1 << 16, TNX_MAX_ARGS = 16 };

static tn_context_t* context;
static tn_handle_t objects[TNX_MAX_OBJECTS];
static int objectCount = 1;  // slot 0 names no object
static tn_value_t args[TNX_MAX_ARGS];
static int argCount;
static tn_value_t result;

// Lifetime (PRD-506): each facade wrapper is tracked by a Boehm finalizer that clears its callbacks
// and releases its engine handle when TypeScript drops it. The wrapper table below is plain malloc
// memory, which the collector does not scan, so it holds wrappers weakly; `held` is a static, which
// the collector scans, so a wrapper listed there stays alive. A callback-bearing wrapper is held
// while its object is attached (the engine may call it) and let go once detached: a detached object,
// its closure and the wrapper the closure captured are then a cycle the collector reclaims. The
// finalizer is the no-order kind, since an ordered one never runs on an object that reaches itself.
typedef void (*GC_finalization_proc)(void* object, void* data);
extern void GC_register_finalizer_no_order(void* object, GC_finalization_proc fn, void* data, GC_finalization_proc* oldFn,
                                           void** oldData);
extern void GC_gcollect(void);
extern int GC_invoke_finalizers(void);

static void** wrappers;  // by slot, weak
static void* held[TNX_MAX_OBJECTS];  // by slot, strong while the engine may call back
static unsigned char hasCallback[TNX_MAX_OBJECTS];
static int live;  // engine handles this module holds

static int refused(tn_status_t status, tn_diagnostic_t* diagnostic, const char* what) {
    fprintf(stderr, "TN_AOT_ABI %u %s: %s\n", status, what, diagnostic->message ? diagnostic->message : "");
    tn_diagnostic_release(diagnostic);
    argCount = 0;
    return -1;
}

// One slot per engine object, so the facade keeps one wrapper per object. Engine handles reuse
// their index with a new generation, so the index finds the slot and the generation confirms it.
static int* slotByIndex;
static uint32_t slotByIndexSize;
static int freeSlots[TNX_MAX_OBJECTS];
static int freeCount;

static int slotOf(tn_handle_t handle) {
    if (handle.index >= slotByIndexSize) {
        uint32_t size = slotByIndexSize ? slotByIndexSize : 1024;
        while (size <= handle.index) size *= 2;
        slotByIndex = realloc(slotByIndex, size * sizeof(int));
        memset(slotByIndex + slotByIndexSize, 0, (size - slotByIndexSize) * sizeof(int));
        slotByIndexSize = size;
    }
    const int known = slotByIndex[handle.index];
    if (known > 0) {
        const tn_handle_t* h = &objects[known];
        if (h->type == handle.type && h->context == handle.context && h->index == handle.index &&
            h->generation == handle.generation)
            return known;
    }
    const int slot = freeCount > 0 ? freeSlots[--freeCount] : objectCount < TNX_MAX_OBJECTS ? objectCount++ : -1;
    if (slot < 0) return -1;
    objects[slot] = handle;
    slotByIndex[handle.index] = slot;
    ++live;
    return slot;
}

static void collected(void* wrapper, void* data) {
    (void)wrapper;
    const int slot = (int)(long)data;
    tn_diagnostic_t diagnostic = {0};
    if (hasCallback[slot]) tn_set_callback(objects[slot], "onBeforeRender", 0, 0, 0, &diagnostic);
    hasCallback[slot] = 0;
    tn_object_release(objects[slot], &diagnostic);
    tn_diagnostic_release(&diagnostic);
    if (slotByIndex[objects[slot].index] == slot) slotByIndex[objects[slot].index] = 0;
    objects[slot] = (tn_handle_t){0};
    wrappers[slot] = 0;
    held[slot] = 0;
    freeSlots[freeCount++] = slot;
    --live;
}

// The facade's wrapper for a slot from now on; collected with it.
void tnx_track(void* wrapper, int slot) {
    if (!wrappers) wrappers = calloc(TNX_MAX_OBJECTS, sizeof(void*));
    wrappers[slot] = wrapper;
    GC_register_finalizer_no_order(wrapper, collected, (void*)(long)slot, 0, 0);
}

tn_handle_t tnx_handle(int slot) { return objects[slot]; }
int tnx_has_wrapper(int slot) { return wrappers && slot > 0 && wrappers[slot] != 0; }
void* tnx_wrapper(int slot) { return wrappers[slot]; }
int tnx_live(void) { return live; }

// Resident set, from /proc/self/statm (Linux, 4 KiB pages); -1 when unreadable.
int tnx_resident_kb(void) {
    FILE* statm = fopen("/proc/self/statm", "r");
    long pages = 0, resident = -1;
    if (statm) {
        if (fscanf(statm, "%ld %ld", &pages, &resident) != 2) resident = -1;
        fclose(statm);
    }
    return resident < 0 ? -1 : (int)(resident * 4);
}

// Defined by the facade (three.ts): runs the wrapper's callback; 0 ran, 1 threw.
extern int tn_aot_dispatch(void* wrapper, int scene, int camera, int geometry, int material);
static char thrown[512];
void tnx_callback_error(const char* message) {
    strncpy(thrown, message, sizeof thrown - 1);
    thrown[sizeof thrown - 1] = '\0';
}

static int argSlot(const tn_value_t* value) { return value->kind == TN_VALUE_HANDLE ? slotOf(value->handle) : 0; }

static tn_status_t invokeCallback(void* context, const tn_value_t* args, uint32_t count, char* error, uint32_t capacity) {
    const int slot = (int)(long)context;
    if (!wrappers || !wrappers[slot] || count < 5) return TN_OK;
    thrown[0] = '\0';
    if (tn_aot_dispatch(wrappers[slot], argSlot(&args[1]), argSlot(&args[2]), argSlot(&args[3]), argSlot(&args[4])) == 0)
        return TN_OK;
    snprintf(error, capacity, "%s", thrown[0] ? thrown : "the callback threw");
    return TN_ERROR_INVALID_STATE;
}

int tnx_set_callback(int slot, const char* name, int on) {
    tn_diagnostic_t diagnostic = {0};
    tn_status_t status = on ? tn_set_callback(objects[slot], name, invokeCallback, (void*)(long)slot, 0, &diagnostic)
                            : tn_set_callback(objects[slot], name, 0, 0, 0, &diagnostic);
    if (status != TN_OK) return refused(status, &diagnostic, name);
    hasCallback[slot] = (unsigned char)on;
    held[slot] = on ? wrappers[slot] : 0;  // until the next safe point decides
    return 0;
}

// The safe point: hold callback-bearing wrappers whose objects are attached, let the rest go.
void tnx_safe_point(void) {
    for (int slot = 1; slot < objectCount; ++slot) {
        if (!hasCallback[slot] || !wrappers || !wrappers[slot]) continue;
        tn_value_t parent;
        tn_diagnostic_t diagnostic = {0};
        const int attached = tn_get(objects[slot], "parent", &parent, &diagnostic) == TN_OK && parent.kind == TN_VALUE_HANDLE;
        tn_diagnostic_release(&diagnostic);
        held[slot] = attached ? wrappers[slot] : 0;
    }
}

// A finalizer queued by one collection runs during a later one, and a released wrapper can free
// others: collect until two rounds in a row release nothing (bounded).
// The collector scans the stack conservatively, so a pointer left in a returned call's frame (below
// this one) would keep its object alive. Zero that dead area first.
__attribute__((noinline)) static void scrubDeadStack(void) {
    volatile char area[64 * 1024];
    memset((char*)area, 0, sizeof area);
}

void tnx_collect(void) {
    scrubDeadStack();
    int quiet = 0;
    for (int round = 0; round < 32 && quiet < 2; ++round) {
        const int before = live;
        GC_gcollect();
        GC_invoke_finalizers();
        quiet = live == before ? quiet + 1 : 0;
    }
}

int tnx_init(void) {
    if (context) return 0;
    tn_version_info_t version = tn_engine_version();
    tn_diagnostic_t diagnostic = {0};
    tn_status_t status = tn_context_create(&context, &version, &diagnostic);
    return status == TN_OK ? 0 : refused(status, &diagnostic, "tn_context_create");
}

void tnx_arg_number(double number) {
    if (argCount < TNX_MAX_ARGS) args[argCount++] = (tn_value_t){.kind = TN_VALUE_NUMBER, .number = number};
}

void tnx_arg_object(int slot) {
    if (argCount < TNX_MAX_ARGS) args[argCount++] = (tn_value_t){.kind = TN_VALUE_HANDLE, .handle = objects[slot]};
}

int tnx_construct(const char* className) {
    tn_handle_t out;
    tn_diagnostic_t diagnostic = {0};
    tn_status_t status = tn_construct(context, className, args, (uint32_t)argCount, &out, &diagnostic);
    argCount = 0;
    return status == TN_OK ? slotOf(out) : refused(status, &diagnostic, className);
}

// Returns the result's kind (TN_VALUE_*), or -1 on a refusal; read it with tnx_result_*.
int tnx_invoke(int self, const char* method) {
    tn_diagnostic_t diagnostic = {0};
    tn_status_t status = tn_invoke(objects[self], method, args, (uint32_t)argCount, &result, &diagnostic);
    argCount = 0;
    return status == TN_OK ? (int)result.kind : refused(status, &diagnostic, method);
}

int tnx_get(int self, const char* path) {
    tn_diagnostic_t diagnostic = {0};
    tn_status_t status = tn_get(objects[self], path, &result, &diagnostic);
    return status == TN_OK ? (int)result.kind : refused(status, &diagnostic, path);
}

double tnx_result_number(void) { return result.kind == TN_VALUE_BOOL ? (double)result.boolean : result.number; }
int tnx_result_object(void) { return result.kind == TN_VALUE_HANDLE ? slotOf(result.handle) : 0; }

// The engine's text lives until its next call; the facade gets its own copy.
// ponytail: never freed; strings here are short and few (type names).
const char* tnx_result_string(void) {
    if (result.kind != TN_VALUE_STRING) return "";
    char* copy = malloc(result.count + 1);
    memcpy(copy, result.text, result.count);
    copy[result.count] = '\0';
    return copy;
}

int tnx_set_number(int self, const char* path, double number) {
    tn_value_t value = {.kind = TN_VALUE_NUMBER, .number = number};
    tn_diagnostic_t diagnostic = {0};
    tn_status_t status = tn_set(objects[self], path, &value, &diagnostic);
    return status == TN_OK ? 0 : refused(status, &diagnostic, path);
}
