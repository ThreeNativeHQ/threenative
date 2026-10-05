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

static int refused(tn_status_t status, tn_diagnostic_t* diagnostic, const char* what) {
    fprintf(stderr, "TN_AOT_ABI %u %s: %s\n", status, what, diagnostic->message ? diagnostic->message : "");
    tn_diagnostic_release(diagnostic);
    argCount = 0;
    return -1;
}

// One slot per engine object, so the facade keeps one wrapper per object.
// ponytail: linear scan; a hash on (type, index, generation) once programs hold many objects.
static int slotOf(tn_handle_t handle) {
    for (int i = 1; i < objectCount; ++i) {
        const tn_handle_t* h = &objects[i];
        if (h->type == handle.type && h->context == handle.context && h->index == handle.index &&
            h->generation == handle.generation)
            return i;
    }
    if (objectCount == TNX_MAX_OBJECTS) return -1;
    objects[objectCount] = handle;
    return objectCount++;
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
