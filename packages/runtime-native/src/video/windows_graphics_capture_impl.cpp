/**
 * Windows.Graphics.Capture Implementation (C++/WinRT)
 *
 * Uses Windows.Graphics.Capture API for native OS-level screen capture.
 * All WinRT types are fully qualified to avoid namespace conflicts with
 * Windows SDK interop headers.
 */

#ifdef _WIN32

// Prevent Windows.h min/max macros
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

// C++/WinRT headers - must come before any Windows.h includes
#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.System.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>

// Windows interop - these introduce Windows:: namespace but we won't use it
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>

// D3D11
#include <d3d11.h>
#include <dxgi1_2.h>

// Define IDirect3DDxgiInterfaceAccess if not already defined
// This interface is needed to get D3D11 textures from WinRT surfaces
// Some SDK versions may not define it properly via the interop header
#ifndef __IDirect3DDxgiInterfaceAccess_INTERFACE_DEFINED__
#define __IDirect3DDxgiInterfaceAccess_INTERFACE_DEFINED__
MIDL_INTERFACE("A9B3D012-3DF2-4EE3-B8D1-8695F457D3C1")
IDirect3DDxgiInterfaceAccess : public IUnknown
{
public:
    virtual HRESULT STDMETHODCALLTYPE GetInterface(
        REFIID iid,
        _COM_Outptr_ void** p) = 0;
};
#endif

// Media Foundation
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <mferror.h>

// Standard library
#include <string>
#include <memory>
#include <atomic>
#include <mutex>
#include <thread>
#include <chrono>
#include <iostream>
#include <queue>
#include <vector>

#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfuuid.lib")
#pragma comment(lib, "mfreadwrite.lib")

namespace mystral {
namespace video {

// Namespace aliases to avoid conflicts with Windows:: from interop headers
namespace wrt = winrt;
namespace wf = winrt::Windows::Foundation;
namespace wgc = winrt::Windows::Graphics::Capture;
namespace wgdx = winrt::Windows::Graphics::DirectX;
namespace wgdx3d = winrt::Windows::Graphics::DirectX::Direct3D11;

// Helper to create GraphicsCaptureItem from HWND
inline wgc::GraphicsCaptureItem CreateCaptureItemForWindow(HWND hwnd) {
    auto interop = wrt::get_activation_factory<wgc::GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
    wgc::GraphicsCaptureItem item{ nullptr };
    wrt::check_hresult(interop->CreateForWindow(
        hwnd,
        winrt::guid_of<ABI::Windows::Graphics::Capture::IGraphicsCaptureItem>(),
        reinterpret_cast<void**>(wrt::put_abi(item))));
    return item;
}

// Helper to get IDXGIDevice from D3D11 device
inline wrt::com_ptr<IDXGIDevice> GetDXGIDevice(ID3D11Device* d3dDevice) {
    wrt::com_ptr<IDXGIDevice> dxgiDevice;
    d3dDevice->QueryInterface(IID_PPV_ARGS(dxgiDevice.put()));
    return dxgiDevice;
}

// Helper to create IDirect3DDevice from D3D11 device
inline wgdx3d::IDirect3DDevice CreateDirect3DDevice(ID3D11Device* d3dDevice) {
    auto dxgiDevice = GetDXGIDevice(d3dDevice);
    wrt::com_ptr<::IInspectable> inspectable;
    wrt::check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice.get(), inspectable.put()));
    return inspectable.as<wgdx3d::IDirect3DDevice>();
}

// Frame data for encoding
struct CapturedFrameData {
    std::vector<uint8_t> pixels;
    uint32_t width;
    uint32_t height;
    int64_t timestamp;
    int frameNumber;
};

/**
 * Windows Graphics Capture Implementation
 */
class WindowsGraphicsCaptureRecorderImpl {
public:
    WindowsGraphicsCaptureRecorderImpl() = default;

    ~WindowsGraphicsCaptureRecorderImpl() {
        if (isRecording()) {
            stopRecording();
        }
        cleanup();
    }

    bool startRecording(void* hwnd, const std::string& outputPath, int fps, int width, int height) {
        if (recording_) {
            return false;
        }

        hwnd_ = static_cast<HWND>(hwnd);
        outputPath_ = outputPath;
        fps_ = fps;
        requestedWidth_ = width;
        requestedHeight_ = height;

        try {
            // Initialize COM/WinRT for this thread
            wrt::init_apartment(wrt::apartment_type::multi_threaded);

            // Create D3D11 device
            D3D_FEATURE_LEVEL featureLevels[] = {
                D3D_FEATURE_LEVEL_11_1,
                D3D_FEATURE_LEVEL_11_0,
                D3D_FEATURE_LEVEL_10_1,
                D3D_FEATURE_LEVEL_10_0
            };

            UINT createFlags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;

            HRESULT hr = D3D11CreateDevice(
                nullptr,
                D3D_DRIVER_TYPE_HARDWARE,
                nullptr,
                createFlags,
                featureLevels,
                ARRAYSIZE(featureLevels),
                D3D11_SDK_VERSION,
                d3dDevice_.put(),
                nullptr,
                d3dContext_.put()
            );

            if (FAILED(hr)) {
                std::cerr << "[WindowsGraphicsCapture] Failed to create D3D11 device: 0x"
                          << std::hex << hr << std::endl;
                return false;
            }

            // Create WinRT Direct3D device
            direct3dDevice_ = CreateDirect3DDevice(d3dDevice_.get());

            // Create capture item from window
            captureItem_ = CreateCaptureItemForWindow(hwnd_);
            auto size = captureItem_.Size();
            captureWidth_ = size.Width;
            captureHeight_ = size.Height;

            // Use requested dimensions if specified, otherwise use window size
            if (requestedWidth_ > 0 && requestedHeight_ > 0) {
                outputWidth_ = requestedWidth_;
                outputHeight_ = requestedHeight_;
            } else {
                outputWidth_ = captureWidth_;
                outputHeight_ = captureHeight_;
            }

            // Create frame pool
            framePool_ = wgc::Direct3D11CaptureFramePool::CreateFreeThreaded(
                direct3dDevice_,
                wgdx::DirectXPixelFormat::B8G8R8A8UIntNormalized,
                2,  // Buffer count
                size
            );

            // Set up frame arrived handler
            frameArrivedToken_ = framePool_.FrameArrived(
                [this](wgc::Direct3D11CaptureFramePool const& sender, wf::IInspectable const&) {
                    OnFrameArrived(sender);
                });

            // Create capture session
            captureSession_ = framePool_.CreateCaptureSession(captureItem_);

            // Initialize Media Foundation
            hr = MFStartup(MF_VERSION);
            if (FAILED(hr)) {
                std::cerr << "[WindowsGraphicsCapture] Failed to start Media Foundation: 0x"
                          << std::hex << hr << std::endl;
                return false;
            }
            mfStarted_ = true;

            // Create sink writer for MP4 output
            if (!initializeSinkWriter()) {
                return false;
            }

            // Start capture
            recording_ = true;
            frameNumber_ = 0;
            startTime_ = std::chrono::high_resolution_clock::now();
            capturedFrames_ = 0;
            droppedFrames_ = 0;

            // Start encoder thread
            encoderThread_ = std::thread([this]() { encoderThreadFunc(); });

            captureSession_.StartCapture();

            std::cout << "[WindowsGraphicsCapture] Started recording " << captureWidth_ << "x"
                      << captureHeight_ << " -> " << outputPath_ << std::endl;
            return true;

        } catch (const wrt::hresult_error& e) {
            std::cerr << "[WindowsGraphicsCapture] WinRT error: "
                      << wrt::to_string(e.message()) << std::endl;
            cleanup();
            return false;
        } catch (const std::exception& e) {
            std::cerr << "[WindowsGraphicsCapture] Error: " << e.what() << std::endl;
            cleanup();
            return false;
        }
    }

    bool stopRecording() {
        if (!recording_) {
            return false;
        }

        recording_ = false;

        // Stop capture session
        if (captureSession_) {
            captureSession_.Close();
            captureSession_ = nullptr;
        }

        // Remove event handler
        if (framePool_ && frameArrivedToken_) {
            framePool_.FrameArrived(frameArrivedToken_);
            frameArrivedToken_ = {};
        }

        // Signal encoder thread to finish
        encodingDone_ = true;
        if (encoderThread_.joinable()) {
            encoderThread_.join();
        }

        // Finalize sink writer
        if (sinkWriter_) {
            sinkWriter_->Finalize();
            sinkWriter_ = nullptr;
        }

        auto endTime = std::chrono::high_resolution_clock::now();
        auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(endTime - startTime_);
        double elapsedSeconds = duration.count() / 1000.0;

        std::cout << "[WindowsGraphicsCapture] Stopped recording. Captured " << capturedFrames_
                  << " frames in " << elapsedSeconds << "s ("
                  << (elapsedSeconds > 0 ? capturedFrames_ / elapsedSeconds : 0) << " fps)" << std::endl;

        cleanup();
        return true;
    }

    bool isRecording() const {
        return recording_;
    }

    int getCapturedFrames() const { return capturedFrames_; }
    int getDroppedFrames() const { return droppedFrames_; }

private:
    void OnFrameArrived(wgc::Direct3D11CaptureFramePool const& sender) {
        if (!recording_) return;

        try {
            auto frame = sender.TryGetNextFrame();
            if (!frame) return;

            auto surface = frame.Surface();
            auto access = surface.as<::IDirect3DDxgiInterfaceAccess>();

            wrt::com_ptr<ID3D11Texture2D> texture;
            wrt::check_hresult(access->GetInterface(IID_PPV_ARGS(texture.put())));

            // Create staging texture for CPU access
            D3D11_TEXTURE2D_DESC desc;
            texture->GetDesc(&desc);
            desc.Usage = D3D11_USAGE_STAGING;
            desc.BindFlags = 0;
            desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
            desc.MiscFlags = 0;

            wrt::com_ptr<ID3D11Texture2D> stagingTexture;
            HRESULT hr = d3dDevice_->CreateTexture2D(&desc, nullptr, stagingTexture.put());
            if (FAILED(hr)) {
                droppedFrames_++;
                return;
            }

            // Copy to staging
            d3dContext_->CopyResource(stagingTexture.get(), texture.get());

            // Map and read pixels
            D3D11_MAPPED_SUBRESOURCE mapped;
            hr = d3dContext_->Map(stagingTexture.get(), 0, D3D11_MAP_READ, 0, &mapped);
            if (FAILED(hr)) {
                droppedFrames_++;
                return;
            }

            // Queue frame for encoding
            CapturedFrameData frameData;
            frameData.width = desc.Width;
            frameData.height = desc.Height;
            frameData.frameNumber = frameNumber_++;
            frameData.timestamp = std::chrono::duration_cast<std::chrono::microseconds>(
                std::chrono::high_resolution_clock::now() - startTime_).count();

            size_t pixelDataSize = desc.Width * desc.Height * 4;
            frameData.pixels.resize(pixelDataSize);

            // Copy row by row (accounting for pitch)
            uint8_t* dst = frameData.pixels.data();
            const uint8_t* src = static_cast<const uint8_t*>(mapped.pData);
            for (uint32_t y = 0; y < desc.Height; y++) {
                memcpy(dst + y * desc.Width * 4, src + y * mapped.RowPitch, desc.Width * 4);
            }

            d3dContext_->Unmap(stagingTexture.get(), 0);

            // Queue for encoding
            {
                std::lock_guard<std::mutex> lock(frameMutex_);
                if (frameQueue_.size() < 30) {  // Max queue size
                    frameQueue_.push(std::move(frameData));
                    capturedFrames_++;
                } else {
                    droppedFrames_++;
                }
            }

        } catch (const wrt::hresult_error& e) {
            std::cerr << "[WindowsGraphicsCapture] Frame capture error: "
                      << wrt::to_string(e.message()) << std::endl;
            droppedFrames_++;
        }
    }

    bool initializeSinkWriter() {
        // Convert output path to wide string
        std::wstring wOutputPath(outputPath_.begin(), outputPath_.end());

        // Create sink writer
        wrt::com_ptr<IMFAttributes> attributes;
        MFCreateAttributes(attributes.put(), 1);
        attributes->SetUINT32(MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, TRUE);

        HRESULT hr = MFCreateSinkWriterFromURL(
            wOutputPath.c_str(),
            nullptr,
            attributes.get(),
            sinkWriter_.put()
        );
        if (FAILED(hr)) {
            std::cerr << "[WindowsGraphicsCapture] Failed to create sink writer: 0x"
                      << std::hex << hr << std::endl;
            return false;
        }

        // Set up output media type (H.264)
        wrt::com_ptr<IMFMediaType> outputType;
        MFCreateMediaType(outputType.put());
        outputType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
        outputType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
        outputType->SetUINT32(MF_MT_AVG_BITRATE, 8000000);  // 8 Mbps
        outputType->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
        MFSetAttributeSize(outputType.get(), MF_MT_FRAME_SIZE, outputWidth_, outputHeight_);
        MFSetAttributeRatio(outputType.get(), MF_MT_FRAME_RATE, fps_, 1);
        MFSetAttributeRatio(outputType.get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);

        hr = sinkWriter_->AddStream(outputType.get(), &streamIndex_);
        if (FAILED(hr)) {
            std::cerr << "[WindowsGraphicsCapture] Failed to add stream: 0x"
                      << std::hex << hr << std::endl;
            return false;
        }

        // Set up input media type (BGRA)
        wrt::com_ptr<IMFMediaType> inputType;
        MFCreateMediaType(inputType.put());
        inputType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
        inputType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_ARGB32);
        inputType->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
        MFSetAttributeSize(inputType.get(), MF_MT_FRAME_SIZE, outputWidth_, outputHeight_);
        MFSetAttributeRatio(inputType.get(), MF_MT_FRAME_RATE, fps_, 1);
        MFSetAttributeRatio(inputType.get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);

        hr = sinkWriter_->SetInputMediaType(streamIndex_, inputType.get(), nullptr);
        if (FAILED(hr)) {
            std::cerr << "[WindowsGraphicsCapture] Failed to set input type: 0x"
                      << std::hex << hr << std::endl;
            return false;
        }

        hr = sinkWriter_->BeginWriting();
        if (FAILED(hr)) {
            std::cerr << "[WindowsGraphicsCapture] Failed to begin writing: 0x"
                      << std::hex << hr << std::endl;
            return false;
        }

        return true;
    }

    void encoderThreadFunc() {
        while (!encodingDone_ || !frameQueue_.empty()) {
            CapturedFrameData frame;
            bool hasFrame = false;

            {
                std::lock_guard<std::mutex> lock(frameMutex_);
                if (!frameQueue_.empty()) {
                    frame = std::move(frameQueue_.front());
                    frameQueue_.pop();
                    hasFrame = true;
                }
            }

            if (hasFrame) {
                encodeFrame(frame);
            } else {
                std::this_thread::sleep_for(std::chrono::milliseconds(1));
            }
        }
    }

    void encodeFrame(const CapturedFrameData& frame) {
        if (!sinkWriter_) return;

        // Create sample
        wrt::com_ptr<IMFSample> sample;
        HRESULT hr = MFCreateSample(sample.put());
        if (FAILED(hr)) return;

        // Create buffer
        DWORD bufferSize = frame.width * frame.height * 4;
        wrt::com_ptr<IMFMediaBuffer> buffer;
        hr = MFCreateMemoryBuffer(bufferSize, buffer.put());
        if (FAILED(hr)) return;

        // Lock and copy data
        BYTE* bufferData = nullptr;
        hr = buffer->Lock(&bufferData, nullptr, nullptr);
        if (SUCCEEDED(hr)) {
            // Convert BGRA to ARGB (swap B and R)
            const uint8_t* src = frame.pixels.data();
            for (uint32_t i = 0; i < frame.width * frame.height; i++) {
                bufferData[i * 4 + 0] = src[i * 4 + 2];  // B -> R
                bufferData[i * 4 + 1] = src[i * 4 + 1];  // G
                bufferData[i * 4 + 2] = src[i * 4 + 0];  // R -> B
                bufferData[i * 4 + 3] = src[i * 4 + 3];  // A
            }
            buffer->Unlock();
        }

        buffer->SetCurrentLength(bufferSize);
        sample->AddBuffer(buffer.get());

        // Set timestamps
        LONGLONG duration = 10000000LL / fps_;  // 100-nanosecond units
        LONGLONG timestamp = frame.frameNumber * duration;
        sample->SetSampleTime(timestamp);
        sample->SetSampleDuration(duration);

        // Write sample
        hr = sinkWriter_->WriteSample(streamIndex_, sample.get());
        if (FAILED(hr)) {
            std::cerr << "[WindowsGraphicsCapture] Failed to write sample: 0x"
                      << std::hex << hr << std::endl;
        }
    }

    void cleanup() {
        if (captureSession_) {
            captureSession_.Close();
            captureSession_ = nullptr;
        }
        if (framePool_) {
            framePool_.Close();
            framePool_ = nullptr;
        }
        captureItem_ = nullptr;
        direct3dDevice_ = nullptr;
        d3dContext_ = nullptr;
        d3dDevice_ = nullptr;
        sinkWriter_ = nullptr;

        if (mfStarted_) {
            MFShutdown();
            mfStarted_ = false;
        }
    }

    // Window handle
    HWND hwnd_ = nullptr;
    std::string outputPath_;
    int fps_ = 60;
    int requestedWidth_ = 0;
    int requestedHeight_ = 0;

    // Capture dimensions
    uint32_t captureWidth_ = 0;
    uint32_t captureHeight_ = 0;
    uint32_t outputWidth_ = 0;
    uint32_t outputHeight_ = 0;

    // D3D11
    wrt::com_ptr<ID3D11Device> d3dDevice_;
    wrt::com_ptr<ID3D11DeviceContext> d3dContext_;
    wgdx3d::IDirect3DDevice direct3dDevice_{ nullptr };

    // Capture
    wgc::GraphicsCaptureItem captureItem_{ nullptr };
    wgc::Direct3D11CaptureFramePool framePool_{ nullptr };
    wgc::GraphicsCaptureSession captureSession_{ nullptr };
    wrt::event_token frameArrivedToken_{};

    // Media Foundation
    wrt::com_ptr<IMFSinkWriter> sinkWriter_;
    DWORD streamIndex_ = 0;
    bool mfStarted_ = false;

    // State
    std::atomic<bool> recording_{ false };
    std::atomic<bool> encodingDone_{ false };
    std::chrono::high_resolution_clock::time_point startTime_;
    std::atomic<int> frameNumber_{ 0 };
    std::atomic<int> capturedFrames_{ 0 };
    std::atomic<int> droppedFrames_{ 0 };

    // Frame queue
    std::queue<CapturedFrameData> frameQueue_;
    std::mutex frameMutex_;
    std::thread encoderThread_;
};

// Check if Windows.Graphics.Capture is available
bool checkWindowsGraphicsCaptureAvailable() {
    try {
        return wgc::GraphicsCaptureSession::IsSupported();
    } catch (...) {
        return false;
    }
}

WindowsGraphicsCaptureRecorderImpl* createWindowsGraphicsCaptureImplRaw() {
    if (!checkWindowsGraphicsCaptureAvailable()) {
        return nullptr;
    }
    return new WindowsGraphicsCaptureRecorderImpl();
}

void destroyWindowsGraphicsCaptureImpl(WindowsGraphicsCaptureRecorderImpl* impl) {
    delete impl;
}

// Interface functions called from windows_graphics_capture.cpp
bool implStartRecording(WindowsGraphicsCaptureRecorderImpl* impl, void* hwnd,
                        const std::string& outputPath, int fps, int width, int height) {
    if (!impl) return false;
    return impl->startRecording(hwnd, outputPath, fps, width, height);
}

bool implStopRecording(WindowsGraphicsCaptureRecorderImpl* impl) {
    if (!impl) return false;
    return impl->stopRecording();
}

bool implIsRecording(WindowsGraphicsCaptureRecorderImpl* impl) {
    if (!impl) return false;
    return impl->isRecording();
}

int implGetCapturedFrames(WindowsGraphicsCaptureRecorderImpl* impl) {
    if (!impl) return 0;
    return impl->getCapturedFrames();
}

int implGetDroppedFrames(WindowsGraphicsCaptureRecorderImpl* impl) {
    if (!impl) return 0;
    return impl->getDroppedFrames();
}

}  // namespace video
}  // namespace mystral

#endif  // _WIN32
