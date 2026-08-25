/**
 * JavaScriptCore Engine Implementation
 *
 * Uses Apple's JavaScriptCore framework for JavaScript execution.
 * JSC is available for free on macOS and iOS.
 */

#include "mystral/js/engine.h"
#include <iostream>
#include <sstream>
#include <cstring>
#include <cmath>
#include <unordered_map>
#include <unordered_set>
#include <chrono>
#include <utility>

#if defined(MYSTRAL_JS_JSC) && defined(__APPLE__)

#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>

namespace mystral {
namespace js {

class JSCEngine : public Engine {
public:
    struct NativeFunctionData {
        NativeFunction callback;
        JSGlobalContextRef owner;
        JSCEngine* engine;
    };

    JSCEngine() {
        std::cout << "[JSC] Creating JavaScriptCore engine..." << std::endl;

        // Create a new JavaScript context group and context
        contextGroup_ = JSContextGroupCreate();
        context_ = JSGlobalContextCreateInGroup(contextGroup_, nullptr);

        if (!context_) {
            std::cerr << "[JSC] Failed to create context" << std::endl;
            return;
        }

        JSClassDefinition ordinaryObjectDefinition = kJSClassDefinitionEmpty;
        ordinaryObjectDefinition.className = "ThreeNativeOrdinaryObject";
        ordinaryObjectDefinition.attributes = kJSClassAttributeNoAutomaticPrototype;
        ordinaryObjectClass_ = JSClassCreate(&ordinaryObjectDefinition);

        JSClassDefinition nativeFunctionDefinition = kJSClassDefinitionEmpty;
        nativeFunctionDefinition.className = "ThreeNativeNativeFunction";
        nativeFunctionDefinition.finalize = &finalizeNativeFunction;
        nativeFunctionDefinition.callAsFunction = &nativeCallback;
        nativeFunctionClass_ = JSClassCreate(&nativeFunctionDefinition);

        cacheIntrinsics();

        // Set up standard globals
        setupGlobals();

        std::cout << "[JSC] Engine created successfully" << std::endl;
    }

    ~JSCEngine() override {
        std::cout << "[JSC] Destroying engine..." << std::endl;

        if (context_) {
            clearLastException();
            for (const auto& [value, count] : frameHandleRefs_) {
                for (size_t index = 0; index < count; ++index) {
                    JSValueUnprotect(context_, value);
                }
            }
            for (const auto& [value, count] : protectedHandleRefs_) {
                for (size_t index = 0; index < count; ++index) {
                    JSValueUnprotect(context_, value);
                }
            }
            frameHandleRefs_.clear();
            protectedHandleRefs_.clear();
            outstandingHandles_ = 0;
            if (functionPrototype_) JSValueUnprotect(context_, functionPrototype_);
            if (objectPrototype_) JSValueUnprotect(context_, objectPrototype_);
            if (getOwnPropertyDescriptor_) JSValueUnprotect(context_, getOwnPropertyDescriptor_);
            if (reflectHas_) JSValueUnprotect(context_, reflectHas_);
            if (reflectSet_) JSValueUnprotect(context_, reflectSet_);
            if (reflectGetPrototypeOf_) JSValueUnprotect(context_, reflectGetPrototypeOf_);
            JSGlobalContextRelease(context_);
        }
        if (nativeFunctionClass_) JSClassRelease(nativeFunctionClass_);
        if (ordinaryObjectClass_) JSClassRelease(ordinaryObjectClass_);
        if (contextGroup_) {
            JSContextGroupRelease(contextGroup_);
        }
    }

    EngineType getType() const override { return EngineType::JavaScriptCore; }
    const char* getName() const override { return "JavaScriptCore"; }

    // ========================================================================
    // Script Evaluation
    // ========================================================================

    bool eval(const char* code, const char* filename) override {
        JSValueHandle result = evalWithResult(code, filename);
        return !hasException();
    }

    JSValueHandle evalWithResult(const char* code, const char* filename) override {
        JSStringRef scriptStr = JSStringCreateWithUTF8CString(code);
        JSStringRef sourceURL = filename ? JSStringCreateWithUTF8CString(filename) : nullptr;

        JSValueRef exception = nullptr;
        JSValueRef result = JSEvaluateScript(context_, scriptStr, nullptr, sourceURL, 0, &exception);

        JSStringRelease(scriptStr);
        if (sourceURL) JSStringRelease(sourceURL);

        if (exception) {
            recordException(exception);
            return {nullptr, context_};
        }

        return storeHandle(result);
    }

    bool evalScript(const char* code, const char* filename) override {
        return eval(code, filename);
    }

    JSValueHandle evalScriptWithResult(const char* code, const char* filename) override {
        return evalWithResult(code, filename);
    }

    // ========================================================================
    // Global Object Access
    // ========================================================================

    JSValueHandle getGlobal() override {
        JSObjectRef global = JSContextGetGlobalObject(context_);
        return storeHandle((JSValueRef)global);
    }

    bool setGlobalProperty(const char* name, JSValueHandle value) override {
        JSObjectRef global = JSContextGetGlobalObject(context_);
        JSStringRef nameStr = JSStringCreateWithUTF8CString(name);
        JSValueRef propertyName = JSValueMakeString(context_, nameStr);
        JSStringRelease(nameStr);
        return setPropertyWithReflect(global, propertyName, (JSValueRef)value.ptr);
    }

    JSValueHandle getGlobalProperty(const char* name) override {
        JSObjectRef global = JSContextGetGlobalObject(context_);
        JSStringRef nameStr = JSStringCreateWithUTF8CString(name);

        JSValueRef exception = nullptr;
        JSValueRef result = JSObjectGetProperty(context_, global, nameStr, &exception);

        JSStringRelease(nameStr);
        if (exception != nullptr) {
            recordException(exception);
            result = JSValueMakeUndefined(context_);
        }
        return storeHandle(result);
    }

    // ========================================================================
    // Value Creation
    // ========================================================================

    JSValueHandle newUndefined() override {
        return storeHandle(JSValueMakeUndefined(context_));
    }

    JSValueHandle newNull() override {
        return storeHandle(JSValueMakeNull(context_));
    }

    JSValueHandle newBoolean(bool value) override {
        return storeHandle(JSValueMakeBoolean(context_, value));
    }

    JSValueHandle newNumber(double value) override {
        return storeHandle(JSValueMakeNumber(context_, value));
    }

    JSValueHandle newString(const char* value) override {
        JSStringRef str = JSStringCreateWithUTF8CString(value);
        JSValueRef result = JSValueMakeString(context_, str);
        JSStringRelease(str);
        return storeHandle(result);
    }

    JSValueHandle newObject() override {
        JSObjectRef object = JSObjectMake(context_, ordinaryObjectClass_, nullptr);
        if (objectPrototype_) {
            JSObjectSetPrototype(context_, object, objectPrototype_);
        }
        return storeHandle((JSValueRef)object);
    }

    JSValueHandle newArray(size_t length) override {
        JSValueRef exception = nullptr;
        JSObjectRef arr = JSObjectMakeArray(context_, 0, nullptr, &exception);
        return storeHandle((JSValueRef)arr);
    }

    JSValueHandle newArrayBuffer(const uint8_t* data, size_t length) override {
        // Allocate memory for the data copy
        void* dataCopy = nullptr;
        if (data && length > 0) {
            dataCopy = malloc(length);
            memcpy(dataCopy, data, length);
        } else {
            // Even for empty buffers, we need valid memory
            dataCopy = malloc(1);
            length = 0;
        }

        // Deallocator callback to free the memory when ArrayBuffer is GC'd
        auto deallocator = [](void* bytes, void* deallocatorContext) {
            free(bytes);
        };

        JSValueRef exception = nullptr;
        JSObjectRef arrayBuffer = JSObjectMakeArrayBufferWithBytesNoCopy(
            context_,
            dataCopy,
            length,
            deallocator,
            nullptr,  // deallocatorContext
            &exception
        );

        if (exception) {
            // Clean up if creation failed
            free(dataCopy);
            return {nullptr, context_};
        }

        return storeHandle((JSValueRef)arrayBuffer);
    }

    JSValueHandle newArrayBufferExternal(void* data, size_t length) override {
        // Create an ArrayBuffer that directly references external memory (no copy)
        // Pass nullptr for deallocator since we don't own this memory (GPU manages it)
        JSValueRef exception = nullptr;
        JSObjectRef arrayBuffer = JSObjectMakeArrayBufferWithBytesNoCopy(
            context_,
            data,
            length,
            nullptr,  // No deallocator - memory is managed by WebGPU
            nullptr,  // deallocatorContext
            &exception
        );

        if (exception) {
            return {nullptr, context_};
        }

        return storeHandle((JSValueRef)arrayBuffer);
    }

    void* getArrayBufferData(JSValueHandle value, size_t* size) override {
        JSValueRef val = (JSValueRef)value.ptr;
        if (!val) return nullptr;

        JSValueRef exception = nullptr;

        // Check if it's an ArrayBuffer
        if (JSValueIsObject(context_, val)) {
            JSObjectRef obj = (JSObjectRef)val;

            // Try to get ArrayBuffer data directly
            void* data = JSObjectGetArrayBufferBytesPtr(context_, obj, &exception);
            if (!exception && data) {
                size_t len = JSObjectGetArrayBufferByteLength(context_, obj, &exception);
                if (size) *size = len;
                return data;
            }
            exception = nullptr;

            // Try to get TypedArray data
            data = JSObjectGetTypedArrayBytesPtr(context_, obj, &exception);
            if (!exception && data) {
                size_t len = JSObjectGetTypedArrayByteLength(context_, obj, &exception);
                if (size) *size = len;
                return data;
            }
        }

        if (size) *size = 0;
        return nullptr;
    }

    JSValueHandle createFloat32Array(const float* data, size_t count) override {
        size_t byteLength = count * sizeof(float);

        // Copy data to a new buffer (JSC takes ownership or copies)
        void* dataCopy = malloc(byteLength);
        memcpy(dataCopy, data, byteLength);

        JSValueRef exception = nullptr;

        // Create ArrayBuffer
        JSObjectRef arrayBuffer = JSObjectMakeArrayBufferWithBytesNoCopy(
            context_, dataCopy, byteLength,
            [](void* bytes, void* ctx) { free(bytes); },
            nullptr, &exception
        );
        if (exception) {
            free(dataCopy);
            return {nullptr, context_};
        }

        // Create Float32Array from ArrayBuffer
        JSObjectRef typedArray = JSObjectMakeTypedArrayWithArrayBuffer(
            context_, kJSTypedArrayTypeFloat32Array, arrayBuffer, &exception
        );

        return storeHandle((JSValueRef)typedArray);
    }

    JSValueHandle createFloat32ArrayView(float* data, size_t count) override {
        size_t byteLength = count * sizeof(float);
        JSValueRef exception = nullptr;

        // Create ArrayBuffer backed by external memory (no copy, no dealloc)
        // Caller manages the memory lifetime
        JSObjectRef arrayBuffer = JSObjectMakeArrayBufferWithBytesNoCopy(
            context_, data, byteLength,
            nullptr,  // No deallocator - caller manages memory
            nullptr, &exception
        );
        if (exception) {
            return {nullptr, context_};
        }

        // Create Float32Array from ArrayBuffer
        JSObjectRef typedArray = JSObjectMakeTypedArrayWithArrayBuffer(
            context_, kJSTypedArrayTypeFloat32Array, arrayBuffer, &exception
        );

        return storeHandle((JSValueRef)typedArray);
    }

    JSValueHandle createUint32Array(const uint32_t* data, size_t count) override {
        size_t byteLength = count * sizeof(uint32_t);

        void* dataCopy = malloc(byteLength);
        memcpy(dataCopy, data, byteLength);

        JSValueRef exception = nullptr;

        JSObjectRef arrayBuffer = JSObjectMakeArrayBufferWithBytesNoCopy(
            context_, dataCopy, byteLength,
            [](void* bytes, void* ctx) { free(bytes); },
            nullptr, &exception
        );
        if (exception) {
            free(dataCopy);
            return {nullptr, context_};
        }

        JSObjectRef typedArray = JSObjectMakeTypedArrayWithArrayBuffer(
            context_, kJSTypedArrayTypeUint32Array, arrayBuffer, &exception
        );

        return storeHandle((JSValueRef)typedArray);
    }

    JSValueHandle createUint8Array(const uint8_t* data, size_t count) override {
        void* dataCopy = malloc(count);
        memcpy(dataCopy, data, count);

        JSValueRef exception = nullptr;

        JSObjectRef arrayBuffer = JSObjectMakeArrayBufferWithBytesNoCopy(
            context_, dataCopy, count,
            [](void* bytes, void* ctx) { free(bytes); },
            nullptr, &exception
        );
        if (exception) {
            free(dataCopy);
            return {nullptr, context_};
        }

        JSObjectRef typedArray = JSObjectMakeTypedArrayWithArrayBuffer(
            context_, kJSTypedArrayTypeUint8Array, arrayBuffer, &exception
        );

        return storeHandle((JSValueRef)typedArray);
    }

    JSValueHandle newFunction(const char* name, NativeFunction fn) override {
        JSObjectRef funcObj = JSObjectMake(
            context_, nativeFunctionClass_,
            new NativeFunctionData{std::move(fn), context_, this});
        if (functionPrototype_) {
            JSObjectSetPrototype(context_, funcObj, functionPrototype_);
        }
        JSStringRef propertyName = JSStringCreateWithUTF8CString("name");
        JSStringRef nameStr = JSStringCreateWithUTF8CString(name);
        JSObjectSetProperty(
            context_, funcObj, propertyName, JSValueMakeString(context_, nameStr),
            static_cast<JSPropertyAttributes>(
                kJSPropertyAttributeReadOnly | kJSPropertyAttributeDontEnum),
            nullptr);
        JSStringRelease(propertyName);
        JSStringRelease(nameStr);
        return storeHandle((JSValueRef)funcObj);
    }

    // ========================================================================
    // Value Conversion
    // ========================================================================

    bool toBoolean(JSValueHandle value) override {
        return JSValueToBoolean(context_, (JSValueRef)value.ptr);
    }

    double toNumber(JSValueHandle value) override {
        JSValueRef exception = nullptr;
        return JSValueToNumber(context_, (JSValueRef)value.ptr, &exception);
    }

    std::string toString(JSValueHandle value) override {
        JSValueRef exception = nullptr;
        JSStringRef str = JSValueToStringCopy(context_, (JSValueRef)value.ptr, &exception);
        if (!str) return "";

        size_t maxSize = JSStringGetMaximumUTF8CStringSize(str);
        std::string result(maxSize, '\0');
        size_t actualSize = JSStringGetUTF8CString(str, &result[0], maxSize);
        result.resize(actualSize > 0 ? actualSize - 1 : 0);  // Remove null terminator from count

        JSStringRelease(str);
        return result;
    }

    bool isUndefined(JSValueHandle value) override {
        return JSValueIsUndefined(context_, (JSValueRef)value.ptr);
    }

    bool isNull(JSValueHandle value) override {
        return JSValueIsNull(context_, (JSValueRef)value.ptr);
    }

    bool isBoolean(JSValueHandle value) override {
        return JSValueIsBoolean(context_, (JSValueRef)value.ptr);
    }

    bool isNumber(JSValueHandle value) override {
        return JSValueIsNumber(context_, (JSValueRef)value.ptr);
    }

    bool isString(JSValueHandle value) override {
        return JSValueIsString(context_, (JSValueRef)value.ptr);
    }

    bool isObject(JSValueHandle value) override {
        return JSValueIsObject(context_, (JSValueRef)value.ptr);
    }

    bool isArray(JSValueHandle value) override {
        return JSValueIsArray(context_, (JSValueRef)value.ptr);
    }

    bool isFunction(JSValueHandle value) override {
        return JSValueIsObject(context_, (JSValueRef)value.ptr) &&
               JSObjectIsFunction(context_, (JSObjectRef)value.ptr);
    }

    bool isBindingDestination(JSValueHandle value) override {
        if (!value.ptr || value.ctx != context_ ||
            !JSValueIsObject(context_, (JSValueRef)value.ptr)) {
            return false;
        }
        JSObjectRef object = (JSObjectRef)value.ptr;
        if (!ordinaryObjectClass_ ||
            !JSValueIsObjectOfClass(context_, object, ordinaryObjectClass_)) {
            return false;
        }
        JSValueRef prototype = JSObjectGetPrototype(context_, object);
        return objectPrototype_ && prototype &&
               JSValueIsStrictEqual(context_, prototype, objectPrototype_);
    }

    bool isSameValue(JSValueHandle left, JSValueHandle right) override {
        if (!left.ptr || !right.ptr) return left.ptr == right.ptr;
        JSValueRef leftValue = (JSValueRef)left.ptr;
        JSValueRef rightValue = (JSValueRef)right.ptr;
        if (JSValueIsNumber(context_, leftValue) &&
            JSValueIsNumber(context_, rightValue)) {
            const double leftNumber = JSValueToNumber(context_, leftValue, nullptr);
            const double rightNumber = JSValueToNumber(context_, rightValue, nullptr);
            if (std::isnan(leftNumber) && std::isnan(rightNumber)) return true;
            if (leftNumber == 0.0 && rightNumber == 0.0) {
                return std::signbit(leftNumber) == std::signbit(rightNumber);
            }
        }
        return JSValueIsStrictEqual(context_, leftValue, rightValue);
    }

    // ========================================================================
    // Object Operations
    // ========================================================================

    bool setProperty(JSValueHandle obj, const char* name, JSValueHandle value) override {
        JSStringRef nameStr = JSStringCreateWithUTF8CString(name);
        JSValueRef propertyName = JSValueMakeString(context_, nameStr);
        JSStringRelease(nameStr);
        return setPropertyWithReflect(
            (JSObjectRef)obj.ptr, propertyName, (JSValueRef)value.ptr);
    }

    JSValueHandle getProperty(JSValueHandle obj, const char* name) override {
        JSStringRef nameStr = JSStringCreateWithUTF8CString(name);
        JSValueRef exception = nullptr;
        JSValueRef result = JSObjectGetProperty(context_, (JSObjectRef)obj.ptr, nameStr, &exception);
        JSStringRelease(nameStr);
        if (exception != nullptr) {
            recordException(exception);
            result = JSValueMakeUndefined(context_);
        }
        return storeHandle(result);
    }

    bool getPropertyInfo(JSValueHandle obj, const char* name, JSPropertyInfo& info) override {
        if (!getOwnPropertyDescriptor_) {
            throwException("JavaScriptCore property descriptor intrinsic is unavailable");
            return false;
        }

        JSStringRef nameStr = JSStringCreateWithUTF8CString(name);
        JSValueRef propertyName = JSValueMakeString(context_, nameStr);
        JSStringRelease(nameStr);
        JSValueProtect(context_, propertyName);
        JSObjectRef current = (JSObjectRef)obj.ptr;
        bool own = true;
        std::vector<JSObjectRef> visited;
        const auto releaseTraversal = [&]() {
            for (const auto& value : visited) JSValueUnprotect(context_, value);
            visited.clear();
            JSValueUnprotect(context_, propertyName);
        };

        while (current) {
            for (const auto& seen : visited) {
                if (JSValueIsStrictEqual(context_, current, seen)) {
                    releaseTraversal();
                    throwException(
                        "JavaScript property prototype traversal detected a cycle");
                    return false;
                }
            }
            JSValueProtect(context_, current);
            visited.push_back(current);

            JSValueRef args[] = {(JSValueRef)current, propertyName};
            JSValueRef exception = nullptr;
            JSValueRef descriptor = JSObjectCallAsFunction(
                context_, getOwnPropertyDescriptor_, nullptr, 2, args, &exception);
            if (exception != nullptr) {
                recordException(exception);
                releaseTraversal();
                return false;
            }
            if (!JSValueIsUndefined(context_, descriptor)) {
                JSValueProtect(context_, descriptor);
                JSStringRef valueName = JSStringCreateWithUTF8CString("value");
                JSValueRef valueNameValue = JSValueMakeString(context_, valueName);
                JSStringRelease(valueName);
                JSValueRef valueDescriptorArgs[] = {descriptor, valueNameValue};
                JSValueRef valueDescriptorException = nullptr;
                JSValueRef valueDescriptor = JSObjectCallAsFunction(
                    context_, getOwnPropertyDescriptor_, nullptr, 2,
                    valueDescriptorArgs, &valueDescriptorException);
                if (valueDescriptorException != nullptr) {
                    recordException(valueDescriptorException);
                    JSValueUnprotect(context_, descriptor);
                    releaseTraversal();
                    return false;
                }
                const bool hasValue = !JSValueIsUndefined(context_, valueDescriptor);

                info.own = own;
                if (!getBooleanProperty(
                        (JSObjectRef)descriptor, "enumerable", info.enumerable) ||
                    !getBooleanProperty(
                        (JSObjectRef)descriptor, "configurable", info.configurable)) {
                    JSValueUnprotect(context_, descriptor);
                    releaseTraversal();
                    return false;
                }
                if (!hasValue) {
                    info.kind = JSPropertyKind::Accessor;
                    info.writable = false;
                    info.value = {};
                    JSValueUnprotect(context_, descriptor);
                    releaseTraversal();
                    return true;
                }

                if (!getBooleanProperty(
                        (JSObjectRef)descriptor, "writable", info.writable)) {
                    JSValueUnprotect(context_, descriptor);
                    releaseTraversal();
                    return false;
                }
                JSStringRef valuePropertyName = JSStringCreateWithUTF8CString("value");
                JSValueRef value = JSObjectGetProperty(
                    context_, (JSObjectRef)descriptor, valuePropertyName, &exception);
                JSStringRelease(valuePropertyName);
                if (exception != nullptr) {
                    recordException(exception);
                    JSValueUnprotect(context_, descriptor);
                    releaseTraversal();
                    return false;
                }
                info.kind = JSPropertyKind::Data;
                info.value = {(void*)value, context_};
                JSValueProtect(context_, value);
                JSValueUnprotect(context_, descriptor);
                releaseTraversal();
                return true;
            }

            if (!reflectGetPrototypeOf_) {
                releaseTraversal();
                throwException("JavaScriptCore Reflect.getPrototypeOf intrinsic is unavailable");
                return false;
            }
            JSValueRef prototypeArgs[] = {(JSValueRef)current};
            JSValueRef prototype = JSObjectCallAsFunction(
                context_, reflectGetPrototypeOf_, nullptr, 1, prototypeArgs, &exception);
            if (exception != nullptr) {
                recordException(exception);
                releaseTraversal();
                return false;
            }
            if (!prototype || !JSValueIsObject(context_, prototype)) break;
            current = (JSObjectRef)prototype;
            own = false;
        }

        info = {};
        releaseTraversal();
        return true;
    }

    void releasePropertyInfo(JSPropertyInfo& info) override {
        if (info.kind == JSPropertyKind::Data && info.value.ptr) {
            JSValueUnprotect(context_, (JSValueRef)info.value.ptr);
        }
        info = {};
    }

    bool hasProperty(JSValueHandle obj, const char* name) override {
        if (!reflectHas_) {
            throwException("JavaScriptCore Reflect.has intrinsic is unavailable");
            return false;
        }
        JSStringRef nameStr = JSStringCreateWithUTF8CString(name);
        JSValueRef propertyName = JSValueMakeString(context_, nameStr);
        JSStringRelease(nameStr);
        JSValueRef args[] = {(JSValueRef)obj.ptr, propertyName};
        JSValueRef exception = nullptr;
        JSValueRef result = JSObjectCallAsFunction(
            context_, reflectHas_, nullptr, 2, args, &exception);
        if (exception != nullptr) {
            recordException(exception);
            return false;
        }
        return JSValueToBoolean(context_, result);
    }

    bool deleteProperty(JSValueHandle obj, const char* name) override {
        JSStringRef nameStr = JSStringCreateWithUTF8CString(name);
        JSValueRef exception = nullptr;
        const bool result = JSObjectDeleteProperty(context_, (JSObjectRef)obj.ptr, nameStr, &exception);
        JSStringRelease(nameStr);
        if (exception != nullptr) {
            recordException(exception);
            return false;
        }
        return result;
    }

    bool setPropertyIndex(JSValueHandle arr, uint32_t index, JSValueHandle value) override {
        return setPropertyWithReflect(
            (JSObjectRef)arr.ptr,
            JSValueMakeNumber(context_, static_cast<double>(index)),
            (JSValueRef)value.ptr);
    }

    JSValueHandle getPropertyIndex(JSValueHandle arr, uint32_t index) override {
        JSValueRef exception = nullptr;
        JSValueRef result = JSObjectGetPropertyAtIndex(context_, (JSObjectRef)arr.ptr, index, &exception);
        return storeHandle(result);
    }

    JSValueHandle call(JSValueHandle func, JSValueHandle thisArg, const std::vector<JSValueHandle>& args) override {
        std::vector<JSValueRef> jsArgs;
        jsArgs.reserve(args.size());
        for (const auto& arg : args) {
            jsArgs.push_back((JSValueRef)arg.ptr);
        }

        JSValueRef exception = nullptr;
        JSValueRef result = JSObjectCallAsFunction(
            context_,
            (JSObjectRef)func.ptr,
            thisArg.ptr ? (JSObjectRef)thisArg.ptr : nullptr,
            jsArgs.size(),
            jsArgs.empty() ? nullptr : jsArgs.data(),
            &exception
        );

        if (exception) {
            recordException(exception);
            result = JSValueMakeUndefined(context_);
        }

        return storeHandle(result);
    }

    // ========================================================================
    // Memory Management
    // ========================================================================

    void freezeHandle(JSValueHandle value) override {
        if (!value.ptr) return;
        const JSValueRef rawValue = (JSValueRef)value.ptr;
        const auto frame = frameHandleRefs_.find(rawValue);
        if (frame != frameHandleRefs_.end()) {
            if (--frame->second == 0) frameHandleRefs_.erase(frame);
            ++protectedHandleRefs_[rawValue];
            return;
        }
        ++protectedHandleRefs_[rawValue];
        ++outstandingHandles_;
        JSValueProtect(context_, rawValue);
    }

    void freeHandle(JSValueHandle value) override {
        if (!value.ptr) return;
        const JSValueRef rawValue = (JSValueRef)value.ptr;
        const auto frame = frameHandleRefs_.find(rawValue);
        if (frame != frameHandleRefs_.end()) {
            if (--frame->second == 0) frameHandleRefs_.erase(frame);
            --outstandingHandles_;
            JSValueUnprotect(context_, rawValue);
            return;
        }
        const auto persistent = protectedHandleRefs_.find(rawValue);
        if (persistent == protectedHandleRefs_.end()) return;
        if (--persistent->second == 0) protectedHandleRefs_.erase(persistent);
        --outstandingHandles_;
        JSValueUnprotect(context_, rawValue);
    }

    void protect(JSValueHandle value) override { freezeHandle(value); }
    void unprotect(JSValueHandle value) override { freeHandle(value); }

    size_t outstandingHandleCount() const override { return outstandingHandles_; }

    void clearFrameHandles() override {
        for (const auto& [value, count] : frameHandleRefs_) {
            for (size_t index = 0; index < count; ++index) {
                JSValueUnprotect(context_, value);
            }
            outstandingHandles_ -= count;
        }
        frameHandleRefs_.clear();
    }

    void gc() override {
        JSGarbageCollect(context_);
    }

    // ========================================================================
    // Error Handling
    // ========================================================================

    bool hasException() override {
        return lastException_ != nullptr;
    }

    std::string getException() override {
        if (!lastException_) return "";

        JSValueRef exception = lastException_;
        lastException_ = nullptr;
        std::string result = toString({(void*)exception, context_});
        JSValueUnprotect(context_, exception);
        exceptionFromNativeCallback_ = false;
        return result;
    }

    void throwException(const char* message) override {
        JSStringRef msgStr = JSStringCreateWithUTF8CString(message);
        JSValueRef msgVal = JSValueMakeString(context_, msgStr);
        JSStringRelease(msgStr);
        JSValueProtect(context_, msgVal);

        // Create Error object
        JSValueRef args[] = {msgVal};
        JSStringRef errorName = JSStringCreateWithUTF8CString("Error");
        JSObjectRef errorConstructor = (JSObjectRef)JSObjectGetProperty(
            context_, JSContextGetGlobalObject(context_), errorName, nullptr);
        JSStringRelease(errorName);

        JSValueRef exception = nullptr;
        JSObjectRef error = JSObjectCallAsConstructor(context_, errorConstructor, 1, args, &exception);
        replaceLastException(exception ? exception : (error ? error : msgVal));
        JSValueUnprotect(context_, msgVal);
        if (nativeCallbackDepth_ > 0) exceptionFromNativeCallback_ = true;
    }

    // ========================================================================
    // Private Data
    // ========================================================================

    void setPrivateData(JSValueHandle obj, void* data) override {
        // JSC doesn't have a direct "set private data" - we'd need to use a weak map
        // or create a custom class. For now, use a property with a special name.
        // A better approach would be to use JSObjectSetPrivate with a custom class.
        privateDataMap_[(JSObjectRef)obj.ptr] = data;
    }

    void* getPrivateData(JSValueHandle obj) override {
        auto it = privateDataMap_.find((JSObjectRef)obj.ptr);
        return it != privateDataMap_.end() ? it->second : nullptr;
    }

    // ========================================================================
    // Raw Context Access
    // ========================================================================

    void* getRawContext() override {
        return context_;
    }

private:
    void cacheIntrinsics() {
        JSObjectRef global = JSContextGetGlobalObject(context_);
        JSStringRef objectName = JSStringCreateWithUTF8CString("Object");
        JSValueRef objectValue = JSObjectGetProperty(context_, global, objectName, nullptr);
        JSStringRelease(objectName);
        if (!objectValue || !JSValueIsObject(context_, objectValue)) return;

        JSStringRef prototypeName = JSStringCreateWithUTF8CString("prototype");
        JSValueRef objectPrototype = JSObjectGetProperty(
            context_, (JSObjectRef)objectValue, prototypeName, nullptr);
        if (objectPrototype && JSValueIsObject(context_, objectPrototype)) {
            objectPrototype_ = (JSObjectRef)objectPrototype;
            JSValueProtect(context_, objectPrototype_);
        }

        JSStringRef functionName = JSStringCreateWithUTF8CString("Function");
        JSValueRef functionValue = JSObjectGetProperty(
            context_, global, functionName, nullptr);
        JSStringRelease(functionName);
        if (functionValue && JSValueIsObject(context_, functionValue)) {
            JSValueRef functionPrototype = JSObjectGetProperty(
                context_, (JSObjectRef)functionValue, prototypeName, nullptr);
            if (functionPrototype && JSValueIsObject(context_, functionPrototype)) {
                functionPrototype_ = (JSObjectRef)functionPrototype;
                JSValueProtect(context_, functionPrototype_);
            }
        }
        JSStringRelease(prototypeName);

        JSStringRef descriptorName = JSStringCreateWithUTF8CString("getOwnPropertyDescriptor");
        JSValueRef descriptorValue = JSObjectGetProperty(
            context_, (JSObjectRef)objectValue, descriptorName, nullptr);
        JSStringRelease(descriptorName);
        if (descriptorValue && JSValueIsObject(context_, descriptorValue)) {
            getOwnPropertyDescriptor_ = (JSObjectRef)descriptorValue;
            JSValueProtect(context_, getOwnPropertyDescriptor_);
        }

        JSStringRef reflectName = JSStringCreateWithUTF8CString("Reflect");
        JSValueRef reflectValue = JSObjectGetProperty(context_, global, reflectName, nullptr);
        JSStringRelease(reflectName);
        if (!reflectValue || !JSValueIsObject(context_, reflectValue)) return;
        JSStringRef hasName = JSStringCreateWithUTF8CString("has");
        JSValueRef hasValue = JSObjectGetProperty(
            context_, (JSObjectRef)reflectValue, hasName, nullptr);
        JSStringRelease(hasName);
        if (hasValue && JSValueIsObject(context_, hasValue)) {
            reflectHas_ = (JSObjectRef)hasValue;
            JSValueProtect(context_, reflectHas_);
        }
        JSStringRef setName = JSStringCreateWithUTF8CString("set");
        JSValueRef setValue = JSObjectGetProperty(
            context_, (JSObjectRef)reflectValue, setName, nullptr);
        JSStringRelease(setName);
        if (setValue && JSValueIsObject(context_, setValue)) {
            reflectSet_ = (JSObjectRef)setValue;
            JSValueProtect(context_, reflectSet_);
        }
        JSStringRef getPrototypeOfName = JSStringCreateWithUTF8CString("getPrototypeOf");
        JSValueRef getPrototypeOfValue = JSObjectGetProperty(
            context_, (JSObjectRef)reflectValue, getPrototypeOfName, nullptr);
        JSStringRelease(getPrototypeOfName);
        if (getPrototypeOfValue && JSValueIsObject(context_, getPrototypeOfValue)) {
            reflectGetPrototypeOf_ = (JSObjectRef)getPrototypeOfValue;
            JSValueProtect(context_, reflectGetPrototypeOf_);
        }
    }

    bool setPropertyWithReflect(
        JSObjectRef object,
        JSValueRef property,
        JSValueRef value) {
        if (!reflectSet_) {
            throwException("JavaScriptCore Reflect.set intrinsic is unavailable");
            return false;
        }
        JSValueRef args[] = {object, property, value};
        JSValueRef exception = nullptr;
        JSValueRef result = JSObjectCallAsFunction(
            context_, reflectSet_, nullptr, 3, args, &exception);
        if (exception != nullptr) {
            recordException(exception);
            return false;
        }
        return JSValueToBoolean(context_, result);
    }

    bool getBooleanProperty(JSObjectRef object, const char* name, bool& result) {
        JSStringRef propertyName = JSStringCreateWithUTF8CString(name);
        JSValueRef exception = nullptr;
        JSValueRef value = JSObjectGetProperty(
            context_, object, propertyName, &exception);
        JSStringRelease(propertyName);
        if (exception != nullptr) {
            recordException(exception);
            return false;
        }
        result = JSValueToBoolean(context_, value);
        return true;
    }

    void clearLastException() {
        if (!lastException_) return;
        JSValueUnprotect(context_, lastException_);
        lastException_ = nullptr;
    }

    void replaceLastException(JSValueRef exception) {
        if (exception) JSValueProtect(context_, exception);
        clearLastException();
        lastException_ = exception;
    }

    void recordException(JSValueRef exception) {
        replaceLastException(exception);
        reportException(exception);
    }

    void setupGlobals() {
        // console.log / console.warn / console.error
        JSObjectRef console = JSObjectMake(context_, nullptr, nullptr);
        setGlobalProperty("console", {(void*)console, context_});

        auto consoleFn = [this](const char* prefix) {
            return newFunction(prefix, [prefix](void* ctx, const std::vector<JSValueHandle>& args) {
                JSGlobalContextRef context = (JSGlobalContextRef)ctx;
                std::ostringstream message;
                message << "[" << prefix << "] ";
                for (size_t i = 0; i < args.size(); i++) {
                    JSStringRef str = JSValueToStringCopy(context, (JSValueRef)args[i].ptr, nullptr);
                    if (str) {
                        size_t maxSize = JSStringGetMaximumUTF8CStringSize(str);
                        std::string result(maxSize, '\0');
                        JSStringGetUTF8CString(str, &result[0], maxSize);
                        message << result.c_str();
                        if (i < args.size() - 1) message << " ";
                        JSStringRelease(str);
                    }
                }
                const std::string output = message.str();
                std::cout << output << std::endl;
                NSLog(@"%s", output.c_str());
                return JSValueHandle{(void*)JSValueMakeUndefined(context), ctx};
            });
        };

        setProperty({(void*)console, context_}, "log", consoleFn("log"));
        setProperty({(void*)console, context_}, "warn", consoleFn("warn"));
        setProperty({(void*)console, context_}, "error", consoleFn("error"));
        setProperty({(void*)console, context_}, "info", consoleFn("info"));
        setProperty({(void*)console, context_}, "debug", consoleFn("debug"));

        // performance.now()
        JSObjectRef performance = JSObjectMake(context_, nullptr, nullptr);
        setGlobalProperty("performance", {(void*)performance, context_});

        startTime_ = std::chrono::high_resolution_clock::now();
        setProperty({(void*)performance, context_}, "now",
            newFunction("now", [this](void* ctx, const std::vector<JSValueHandle>& args) {
                auto now = std::chrono::high_resolution_clock::now();
                double ms = std::chrono::duration<double, std::milli>(now - startTime_).count();
                return JSValueHandle{(void*)JSValueMakeNumber((JSGlobalContextRef)ctx, ms), ctx};
            })
        );

        // Timers are deliberately absent until Runtime::setupTimers() installs
        // the scheduler backed by the host event loop. An engine-only JSC
        // context must not expose an ID-returning stub that claims delivery.
    }

    void reportException(JSValueRef exception) {
        std::string msg = toString({(void*)exception, context_});
        std::cerr << "[JSC] Error: " << msg << std::endl;
    }

    JSValueHandle storeHandle(JSValueRef value) {
        if (!value) return {nullptr, context_};
        ++frameHandleRefs_[value];
        ++outstandingHandles_;
        JSValueProtect(context_, value);
        return {(void*)value, context_};
    }

    static void finalizeNativeFunction(JSObjectRef object) {
        delete static_cast<NativeFunctionData*>(JSObjectGetPrivate(object));
    }

    static JSValueRef nativeCallback(JSContextRef ctx, JSObjectRef function,
                                     JSObjectRef thisObject, size_t argumentCount,
                                     const JSValueRef arguments[], JSValueRef* exception) {
        auto* callbackData = static_cast<NativeFunctionData*>(
            JSObjectGetPrivate(function));
        if (!callbackData ||
            callbackData->owner != JSContextGetGlobalContext(ctx)) {
            std::cerr << "[JSC] Native function owner not found for callback" << std::endl;
            return JSValueMakeUndefined(ctx);
        }
        // A native callback may have thrown an exception that JavaScript caught. Keep the
        // host-side exception latch aligned with the next callback boundary.
        if (callbackData->engine && callbackData->engine->nativeCallbackDepth_ == 0 &&
            callbackData->engine->exceptionFromNativeCallback_ &&
            callbackData->engine->hasException()) {
            callbackData->engine->getException();
        }
        if (callbackData->engine) callbackData->engine->nativeCallbackDepth_ += 1;

        // Convert arguments
        std::vector<JSValueHandle> args;
        args.reserve(argumentCount);
        for (size_t i = 0; i < argumentCount; i++) {
            args.push_back({(void*)arguments[i], (void*)ctx});
        }

        // Call the native function
        JSValueHandle result = callbackData->callback((void*)ctx, args);
        if (callbackData->engine) callbackData->engine->nativeCallbackDepth_ -= 1;
        if (callbackData->engine && result.ptr &&
            callbackData->engine->protectedHandleRefs_.find((JSValueRef)result.ptr) ==
                callbackData->engine->protectedHandleRefs_.end()) {
            // The JavaScript call now owns the returned value. Release the temporary Engine
            // handle without touching borrowed callback arguments.
            callbackData->engine->freeHandle(result);
        }
        return (JSValueRef)result.ptr;
    }

    JSContextGroupRef contextGroup_ = nullptr;
    JSGlobalContextRef context_ = nullptr;
    JSObjectRef getOwnPropertyDescriptor_ = nullptr;
    JSObjectRef reflectHas_ = nullptr;
    JSObjectRef reflectSet_ = nullptr;
    JSObjectRef reflectGetPrototypeOf_ = nullptr;
    JSObjectRef objectPrototype_ = nullptr;
    JSObjectRef functionPrototype_ = nullptr;
    JSClassRef ordinaryObjectClass_ = nullptr;
    JSClassRef nativeFunctionClass_ = nullptr;
    JSValueRef lastException_ = nullptr;
    int nativeCallbackDepth_ = 0;
    bool exceptionFromNativeCallback_ = false;
    std::unordered_map<JSObjectRef, void*> privateDataMap_;
    std::unordered_map<JSValueRef, size_t> frameHandleRefs_;
    std::unordered_map<JSValueRef, size_t> protectedHandleRefs_;
    size_t outstandingHandles_ = 0;
    std::chrono::high_resolution_clock::time_point startTime_;
};

// Factory function
std::unique_ptr<Engine> createJSCEngine() {
    return std::make_unique<JSCEngine>();
}

}  // namespace js
}  // namespace mystral

#endif  // MYSTRAL_JS_JSC && __APPLE__
