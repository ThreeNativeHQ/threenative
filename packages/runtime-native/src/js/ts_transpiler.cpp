#include "mystral/js/ts_transpiler.h"

#include <string>

#if defined(MYSTRAL_HAS_SWC)
#include "swc.h"
#endif

namespace mystral {
namespace js {

bool isTypeScriptTranspilerAvailable() {
#if defined(MYSTRAL_HAS_SWC)
    return true;
#else
    return false;
#endif
}

bool transpileTypeScript(const std::string& source,
                          const std::string& filename,
                          std::string& outJs,
                          std::string& outError) {
    outJs.clear();
    outError.clear();

#if defined(MYSTRAL_HAS_SWC)
    char* outCode = nullptr;
    char* outMap = nullptr;
    char* outErr = nullptr;

    int result = swc_transpile_ts(
        source.c_str(),
        filename.c_str(),
        "none",
        &outCode,
        &outMap,
        &outErr);

    if (result != 0) {
        if (outErr) {
            outError = outErr;
            swc_free(outErr);
        } else {
            outError = "SWC transpile failed with error code " + std::to_string(result);
        }
        if (outCode) {
            swc_free(outCode);
        }
        if (outMap) {
            swc_free(outMap);
        }
        return false;
    }

    if (outErr) {
        outError = outErr;
        swc_free(outErr);
    }

    if (outCode) {
        outJs.assign(outCode);
        swc_free(outCode);
    }

    if (outMap) {
        swc_free(outMap);
    }

    return true;
#else
    outError = "TypeScript support not available (SWC not built)";
    return false;
#endif
}

}  // namespace js
}  // namespace mystral
