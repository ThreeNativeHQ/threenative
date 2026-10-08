// The C side of the native-TypeScript `three` module (PRD-506, decision 11): Perry reaches a C
// symbol through its native-library mechanism, so this shim keeps engine handles in a table and
// hands the facade a slot, and call arguments are staged one at a time before the call that
// consumes them. An engine refusal prints its diagnostic and returns the sentinel the facade
// checks. The engine knows nothing of Perry: every engine call here is the versioned C ABI.
//
// The lifetime and callback halves moved to the Perry adapter (three/perry-adapter): the collector
// here is Boehm's, which Perry does not use, so the wrapper table, the finalizer, the safe point and
// the collection loop live on the Perry side. What stays is the engine's own state: the handle
// table, the argument staging and the result register.
#include "threenative/abi/tn_tsl.h"

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

tn_handle_t tnx_handle(int slot) { return slot > 0 && slot < objectCount ? objects[slot] : (tn_handle_t){0}; }
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

// Defined by the Perry adapter: it runs the facade closure this slot carries and writes the
// message of a throw into `error`. 0 ran, non-zero threw.
extern int tnx_adapter_dispatch(int slot, int scene, int camera, int geometry, int material,
                                char* error, int capacity);

// Whether the engine still holds this slot's object in a parent, so the adapter knows when a
// callback-bearing wrapper may be let go. A read of engine state, so it stays here.
int tnx_attached(int slot) {
    tn_value_t parent;
    tn_diagnostic_t diagnostic = {0};
    const int attached =
        tn_get(objects[slot], "parent", &parent, &diagnostic) == TN_OK && parent.kind == TN_VALUE_HANDLE;
    tn_diagnostic_release(&diagnostic);
    return attached;
}

static int argSlot(const tn_value_t* value) { return value->kind == TN_VALUE_HANDLE ? slotOf(value->handle) : 0; }

static tn_status_t invokeCallback(void* context, const tn_value_t* args, uint32_t count, char* error, uint32_t capacity) {
    const int slot = (int)(long)context;
    if (count < 5) return TN_OK;
    return tnx_adapter_dispatch(slot, argSlot(&args[1]), argSlot(&args[2]), argSlot(&args[3]),
                                argSlot(&args[4]), error, (int)capacity) == 0
               ? TN_OK
               : TN_ERROR_INVALID_STATE;
}

int tnx_set_callback(int slot, const char* name, int on) {
    tn_diagnostic_t diagnostic = {0};
    tn_status_t status =
        on ? tn_set_callback(objects[slot], name, invokeCallback, (void*)(long)slot, 0, &diagnostic)
           : tn_set_callback(objects[slot], name, 0, 0, 0, &diagnostic);
    return status == TN_OK ? 0 : refused(status, &diagnostic, name);
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

// The handle the finalizer releases: the slot's engine object, dropped from the table.
void tnx_release_slot(int slot) {
    if (slot <= 0 || slot >= objectCount) return;
    tn_diagnostic_t diagnostic = {0};
    tn_object_release(objects[slot], &diagnostic);
    tn_diagnostic_release(&diagnostic);
    if (slotByIndex[objects[slot].index] == slot) slotByIndex[objects[slot].index] = 0;
    objects[slot] = (tn_handle_t){0};
    freeSlots[freeCount++] = slot;
    --live;
}
/* The graph builder is the same versioned C ABI as object bindings. */
static tn_diagnostic_t tslDiagnostic;
const char* tnx_tsl_error(void) { return tslDiagnostic.message ? tslDiagnostic.message : ""; }
long tnx_tsl_build(const char* op, long a, long b, long c, double value) {
    uint64_t out = 0;
    tn_tsl_build(context, op, a, b, c, value, &out, &tslDiagnostic);
    return (long)out;
}
int tnx_tsl_set(long material, long node) {
    return tn_tsl_set(context, tnx_handle((int)material), "colorNode", node, &tslDiagnostic);
}
int tnx_tsl_compile(long material) {
    return tn_tsl_compile(tnx_handle((int)material), getenv("TN_TSL_WGSL"), &tslDiagnostic);
}
void tnx_tsl_release(long node) { tn_tsl_release(context, node, &tslDiagnostic); }
