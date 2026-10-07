// Numeric array storage and math for Perry's i64 Wasm ABI. No gameplay lives
// here.
#include <math.h>
#include <stdint.h>
#include <stdlib.h>

typedef union {
  uint64_t bits;
  double number;
} Value;
typedef struct {
  uint32_t length, capacity;
  uint64_t *data;
  uint32_t external;
} Array;
static uint32_t allocations;
#ifdef TN_PERRY_EXTERNAL_MEMORY
__attribute__((import_module("packed"), import_name("load"))) extern uint64_t
packed_load(uint32_t address);
__attribute__((import_module("packed"), import_name("store"))) extern void
packed_store(uint32_t address, uint64_t value);
#endif
static const uint64_t undefined = UINT64_C(0x7ffc000000000001);
static const uint64_t pointer = UINT64_C(0x7ffd000000000000);
static uint8_t runtime_names[512];
static uint32_t length_name;
static int numeric_arrays;
#ifndef TN_PERRY_OPERATIONS
#define TN_PERRY_OPERATIONS(name) runtime_names[name]
#else
#define TN_PERRY_CONSTANT_NAMES 1
#endif

__attribute__((import_module("host"), import_name("mem_call"))) extern double
host_mem_call(double name, double count, int base);
__attribute__((import_module("host"), import_name("mem_call_i32"))) extern int
host_mem_call_i32(double name, double count, int base);

static double number(uint64_t bits) {
  if (bits >> 48 == 0x7ffe)
    return (int32_t)bits;
  return ((Value){.bits = bits}).number;
}
static uint64_t bits(double value) { return ((Value){.number = value}).bits; }
static Array *array(uint64_t handle) {
  if (handle >> 48 != 0x7ffd)
    __builtin_trap();
  return (Array *)(uintptr_t)(uint32_t)handle;
}
__attribute__((noinline)) static void reserve(Array *a, uint32_t capacity) {
  if (capacity > 327686)
    __builtin_trap();
  if (capacity <= a->capacity)
    return;
  uint32_t next = a->capacity + a->capacity / 2;
  if (next < capacity) next = capacity;
  if (next < 16) next = 16;
  if (next > 327686) next = 327686;
  uint64_t *data = realloc(a->data, next * sizeof(uint64_t));
  if (!data)
    __builtin_trap();
  a->data = data;
  a->capacity = next;
  allocations++;
}
uint64_t tn_array_create(uint32_t length) {
  Array *a = calloc(1, sizeof(Array));
  if (!a)
    __builtin_trap();
  allocations++;
  reserve(a, length);
  a->length = length;
  for (uint32_t i = 0; i < length; ++i)
    a->data[i] = undefined;
  return pointer | (uintptr_t)a;
}
uint32_t tn_array_data(uint64_t handle) {
  return (uintptr_t)array(handle)->data;
}
uint32_t tn_array_size(uint64_t handle) { return array(handle)->length; }
uint32_t tn_array_allocations(void) { return allocations; }
#ifdef TN_PERRY_EXTERNAL_MEMORY
uint64_t tn_array_external(uint32_t length, uint32_t address) {
  if (!length || length > 327686 || (address & 7)) __builtin_trap();
  Array *a = calloc(1, sizeof(Array));
  if (!a) __builtin_trap();
  allocations++;
  a->length = a->capacity = length;
  a->data = (uint64_t *)(uintptr_t)address;
  a->external = 1;
  return pointer | (uintptr_t)a;
}
#endif
uint64_t array_new(void) { return tn_array_create(0); }
uint64_t array_length(uint64_t handle) { return bits(array(handle)->length); }
uint64_t array_get(uint64_t handle, uint64_t index) {
  Array *a = array(handle);
  double i = number(index);
  if (!(i >= 0 && i < a->length))
    return undefined;
  uint32_t index32 = (uint32_t)i;
  if (i != index32) return undefined;
#ifdef TN_PERRY_EXTERNAL_MEMORY
  if (a->external) return packed_load((uintptr_t)a->data + index32 * 8);
#endif
  return a->data[index32];
}
__attribute__((noinline)) static void grow_set(Array *a, double i, uint64_t value) {
  if (!isfinite(i) || i < 0 || i >= 327686 || i != floor(i) || a->external)
    __builtin_trap();
  reserve(a, (uint32_t)i + 1);
  while (a->length <= i)
    a->data[a->length++] = undefined;
  a->data[(uint32_t)i] = value;
}
void array_set(uint64_t handle, uint64_t index, uint64_t value) {
  Array *a = array(handle);
  double i = number(index);
  if (i >= 0 && i < a->length && i == (uint32_t)i) {
#ifdef TN_PERRY_EXTERNAL_MEMORY
    if (a->external) {
      packed_store((uintptr_t)a->data + (uint32_t)i * 8, value);
      return;
    }
#endif
    a->data[(uint32_t)i] = value;
    return;
  }
  grow_set(a, i, value);
}
uint64_t array_push(uint64_t handle, uint64_t value) {
  array_set(handle, bits(array(handle)->length), value);
  return handle;
}
void tn_runtime_name(uint32_t id, uint32_t operation) {
  if (id >= sizeof(runtime_names) || operation > 12)
    __builtin_trap();
#ifdef TN_PERRY_CONSTANT_NAMES
  if (TN_PERRY_OPERATIONS(id) != operation) __builtin_trap();
#endif
  if (operation == 10)
    length_name = id;
  else
    runtime_names[id] = operation;
}
void tn_numeric_arrays(void) { numeric_arrays = 1; }
static int is_number(uint64_t value) {
  return value >> 48 < 0x7ffc || value >> 48 == 0x7ffe || value >> 48 >= 0x8000;
}
__attribute__((always_inline)) static inline int
numeric_i32(uint32_t op, double name, double count, int base) {
  if (base & 7) __builtin_trap();
  const uint64_t *args = (const uint64_t *)(uintptr_t)base;
  if (op == 11 && count == 1) {
    const uint64_t value = args[0];
    if (value >> 48 == 0x7ffc) return value == UINT64_C(0x7ffc000000000004);
    if (value >> 48 == 0x7ffd) return 1;
    if (is_number(value)) return number(value) != 0 && !isnan(number(value));
  }
  if (op == 12 && count == 2) {
    if (is_number(args[0]) && is_number(args[1])) return number(args[0]) == number(args[1]);
    if (args[0] >> 48 != 0x7fff && args[1] >> 48 != 0x7fff) return args[0] == args[1];
  }
  return host_mem_call_i32(name, count, base);
}
__attribute__((always_inline)) static inline double
numeric_call(uint32_t op, double name, double count, int base) {
  if (base & 7)
    __builtin_trap();
  uint64_t *args = (uint64_t *)(uintptr_t)base;
  uint64_t result;
  int own_array =
      count > 0 && args[0] >> 48 == 0x7ffd && (uint32_t)args[0] >= 131072;
  if ((op == 1 || op == 2) && count == 1)
    result = bits(op == 1 ? sin(number(args[0])) : cos(number(args[0])));
  else if (op == 3 && numeric_arrays && count == 0)
    result = array_new();
  else if (op == 4 && own_array && count == 2)
    result = array_push(args[0], args[1]);
  else if (op == 5 && own_array && count == 1)
    result = array_length(args[0]);
  else if (op == 6 && own_array && count == 2)
    result = array_get(args[0], args[1]);
  else if (op == 7 && own_array && count == 3) {
    array_set(args[0], args[1], args[2]);
    result = undefined;
  } else if (op == 8 && own_array && count == 2 && args[1] >> 48 == 0x7fff &&
             (uint32_t)args[1] == length_name)
    result = array_length(args[0]);
  else if (op == 9 && count == 2 &&
           is_number(args[0]) && is_number(args[1]))
    result = bits(number(args[0]) + number(args[1]));
  else
    return host_mem_call(name, count, base);
  args[0] = result;
  return 0;
}
int mem_call_i32(double name, double count, int base) {
  uint32_t op = name >= 0 && name < sizeof(runtime_names)
    ? TN_PERRY_OPERATIONS((uint32_t)name) : 0;
  return numeric_i32(op, name, count, base);
}
double mem_call(double name, double count, int base) {
  uint32_t op = name >= 0 && name < sizeof(runtime_names)
    ? TN_PERRY_OPERATIONS((uint32_t)name) : 0;
  return numeric_call(op, name, count, base);
}
// The compiler's literal operation names are resolved at link time. Small entry
// points inline without pulling the generic dispatch or allocator into every access.
#define NUMBER_OP(op) double tn_op_##op(double name, double count, int base) { \
  return numeric_call(op, name, count, base); }
NUMBER_OP(1)
NUMBER_OP(2)
NUMBER_OP(3)
NUMBER_OP(4)
NUMBER_OP(5)
NUMBER_OP(6)
NUMBER_OP(7)
NUMBER_OP(8)
NUMBER_OP(9)
#define BOOL_OP(op) int tn_op_##op(double name, double count, int base) { \
  return numeric_i32(op, name, count, base); }
BOOL_OP(11)
BOOL_OP(12)
