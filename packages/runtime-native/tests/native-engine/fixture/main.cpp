// tn-native-engine-fixture-driver: run-native.ts spawns this and writes one fixture on stdin.
#include "driver.h"
#include "bindings.h"

#include <iostream>

int main() {
    tn::fixture::Driver driver;
    tn::fixture::registerBindings(driver);
    return driver.run(std::cin, std::cout);
}
