// Canvas 2D pixel-change tracking must let the host compositor skip the whole-canvas
// GPU upload when nothing has drawn since the last upload.
//
// compositeCanvas2DToWebGPU() (src/webgpu/bindings.cpp) used to push the full
// width x height x 4 pixel buffer through wgpuQueueWriteTexture every presented
// frame whether or not the canvas changed: on a Pixel 8 surface that is
// 1080 x 2400 x 4 = ~10.4 MB per frame, ~620 MB/s at 60 fps, for a canvas that
// never drew. The contract proven here: rasterizing operations dirty the pixels,
// state and measurement changes do not, the compositor consumes the flag exactly
// once per upload, and resize dirties (the buffer is reallocated).

#include "mystral/canvas/canvas2d.h"

#include <cstdio>
#include <string>
#include <vector>

using mystral::canvas::Canvas2DContext;

static int failures = 0;

static void check(bool condition, const char* name) {
    if (condition) {
        std::printf("ok - %s\n", name);
    } else {
        std::printf("FAILED - %s\n", name);
        failures += 1;
    }
}

int main() {
    Canvas2DContext ellipse(64, 64);
    ellipse.consumeDirtyPixels();
    ellipse.setFillStyle("#ff0000");
    ellipse.beginPath();
    ellipse.ellipse(32, 32, 20, 8, 1.57079632679f, 0, 6.28318530718f);
    check(!ellipse.hasDirtyPixels(), "ellipse path construction does not upload pixels");
    ellipse.fill();
    check(ellipse.consumeDirtyPixels(), "ellipse fill requires an upload");
    auto ellipsePixels = ellipse.getImageData(0, 0, 64, 64).data;
    check(ellipsePixels[(16 * 64 + 32) * 4] > 240, "rotated ellipse fills its long axis");
    check(ellipsePixels[(32 * 64 + 16) * 4 + 3] == 0, "rotated ellipse preserves its short axis");
    ellipse.clearRect(0, 0, 64, 64);
    ellipse.beginPath();
    ellipse.ellipse(32, 32, 20, 20, 0, 0, 1.57079632679f, true);
    ellipse.lineTo(32, 32);
    ellipse.closePath();
    ellipse.fill();
    ellipsePixels = ellipse.getImageData(0, 0, 64, 64).data;
    check(ellipsePixels[(24 * 64 + 24) * 4] > 240, "counterclockwise partial ellipse follows the long arc");
    check(ellipsePixels[(40 * 64 + 40) * 4 + 3] == 0, "counterclockwise partial ellipse leaves the short arc empty");
    Canvas2DContext canvas(64, 64);
#if defined(__linux__) && !defined(__ANDROID__)
    canvas.setFont("17px monospace");
    check(canvas.measureText("PREPARING TERRAIN").width > 20.0f,
          "Linux loading text resolves real glyphs instead of an empty font manager");
    Canvas2DContext text(256, 32);
    text.setFont("17px monospace");
    text.setFillStyle("#ffffff");
    text.setTextBaseline("top");
    text.fillText("PREPARING TERRAIN", 0, 0);
    const auto pixels = text.getImageData(0, 0, 256, 32);
    int ink = 0;
    for (size_t i = 3; i < pixels.data.size(); i += 4) {
        if (pixels.data[i] != 0) ++ink;
    }
    check(ink > 20, "Linux loading text rasterizes visible pixels");
#endif

    // A fresh context has never been composited: its first upload is required, and
    // peeking at the flag must not consume it.
    check(canvas.hasDirtyPixels(), "fresh canvas requires its first upload");
    check(canvas.hasDirtyPixels(), "peeking does not consume the flag");

    check(canvas.consumeDirtyPixels(), "first consume reports the pending upload");
    check(!canvas.hasDirtyPixels(), "consumed canvas is clean");
    check(!canvas.consumeDirtyPixels(), "second consume reports nothing to upload");

    // State and measurement changes do not rasterize; the compositor must not be
    // sent back into re-uploading because a game restyles before drawing.
    canvas.setFillStyle("#ff0000");
    canvas.setStrokeStyle("#00ff00");
    canvas.setLineWidth(2.0f);
    canvas.setGlobalAlpha(0.5f);
    canvas.setFont("12px sans-serif");
    canvas.setTextAlign("center");
    canvas.setTextBaseline("middle");
    canvas.setTransform(1.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f);
    canvas.save();
    canvas.restore();
    (void)canvas.measureText("hello");
    check(!canvas.hasDirtyPixels(), "state and measurement changes do not dirty pixels");

    // Every rasterizing operation dirties the pixels.
    canvas.fillRect(0.0f, 0.0f, 8.0f, 8.0f);
    check(canvas.hasDirtyPixels(), "fillRect dirties");
    check(canvas.consumeDirtyPixels(), "consume after fillRect");
    check(!canvas.hasDirtyPixels(), "clean after consuming fillRect");

    canvas.strokeRect(0.0f, 0.0f, 8.0f, 8.0f);
    check(canvas.hasDirtyPixels(), "strokeRect dirties");
    check(canvas.consumeDirtyPixels(), "consume after strokeRect");

    canvas.clearRect(0.0f, 0.0f, 8.0f, 8.0f);
    check(canvas.hasDirtyPixels(), "clearRect dirties");
    check(canvas.consumeDirtyPixels(), "consume after clearRect");

    canvas.beginPath();
    canvas.rect(0.0f, 0.0f, 4.0f, 4.0f);
    canvas.fill();
    check(canvas.hasDirtyPixels(), "path fill dirties");
    check(canvas.consumeDirtyPixels(), "consume after path fill");

    canvas.beginPath();
    canvas.moveTo(0.0f, 0.0f);
    canvas.lineTo(4.0f, 4.0f);
    canvas.stroke();
    check(canvas.hasDirtyPixels(), "path stroke dirties");
    check(canvas.consumeDirtyPixels(), "consume after path stroke");

    canvas.fillText("x", 1.0f, 1.0f);
    check(canvas.hasDirtyPixels(), "fillText dirties");
    check(canvas.consumeDirtyPixels(), "consume after fillText");

    canvas.strokeText("x", 1.0f, 1.0f);
    check(canvas.hasDirtyPixels(), "strokeText dirties");
    check(canvas.consumeDirtyPixels(), "consume after strokeText");

    mystral::canvas::ImageData image;
    image.width = 2;
    image.height = 2;
    image.data.assign(2 * 2 * 4, 128);
    canvas.putImageData(image, 0, 0);
    check(canvas.hasDirtyPixels(), "putImageData dirties");
    check(canvas.consumeDirtyPixels(), "consume after putImageData");

    // Reads stay side-effect free for the compositor's flag.
    (void)canvas.getImageData(0, 0, 2, 2);
    (void)canvas.getPixelData();
    check(!canvas.hasDirtyPixels(), "reads do not dirty or consume");

    // Resize reallocates the pixel buffer and the GPU texture must be refilled.
    canvas.resize(32, 32);
    check(canvas.hasDirtyPixels(), "resize dirties");
    check(canvas.consumeDirtyPixels(), "consume after resize");

    if (failures == 0) {
        std::printf("canvas2d dirty tracking passed\n");
        return 0;
    }
    std::printf("canvas2d dirty tracking FAILED: %d checks\n", failures);
    return 1;
}
