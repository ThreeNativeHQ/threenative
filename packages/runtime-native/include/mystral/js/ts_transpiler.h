#pragma once

#include <string>

namespace mystral {
namespace js {

bool isTypeScriptTranspilerAvailable();

bool transpileTypeScript(const std::string& source,
                          const std::string& filename,
                          std::string& outJs,
                          std::string& outError);

}  // namespace js
}  // namespace mystral
