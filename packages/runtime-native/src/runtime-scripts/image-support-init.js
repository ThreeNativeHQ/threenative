// Pre-cache WebP support so @loaders.gl knows we can decode it
// The library checks document.createElement('canvas').toDataURL('image/webp')
(() => {
  try {
    const canvas = document.createElement("canvas");
    if (canvas?.toDataURL) {
      // Test WebP support - this caches the result
      const webpResult = canvas.toDataURL("image/webp");
      const webpSupported = webpResult.indexOf("data:image/webp") === 0;
      console.log(`[Mystral] WebP format support: ${webpSupported ? "YES" : "NO"}`);
    }
  } catch (e) {
    console.log(`[Mystral] Error checking image format support: ${e}`);
  }
})();
