#pragma once

#include <string>
#include <vector>
#include <map>
#include <memory>
#include <cstdint>

namespace mystral {
namespace http {

/**
 * HTTP request options
 */
struct HttpOptions {
    std::map<std::string, std::string> headers;
    long timeout = 30;  // seconds
    bool verifySSL = true;
};

/**
 * HTTP response
 */
struct HttpResponse {
    bool ok = false;
    int status = 0;
    std::string url;
    std::string error;
    std::vector<uint8_t> data;
    std::map<std::string, std::string> headers;
};

/**
 * HTTP Client using libcurl
 */
class HttpClient {
public:
    HttpClient();
    ~HttpClient();

    // Simple GET request
    HttpResponse get(const std::string& url, const HttpOptions& options = {});

    // POST request with body
    HttpResponse post(const std::string& url, const std::vector<uint8_t>& body,
                      const HttpOptions& options = {});

    // Generic request
    HttpResponse request(const std::string& method, const std::string& url,
                        const std::vector<uint8_t>& body = {},
                        const HttpOptions& options = {});
};

// Global HTTP client accessor
HttpClient& getHttpClient();

} // namespace http
} // namespace mystral
