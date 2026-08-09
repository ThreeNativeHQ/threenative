// Quick script to get Chrome's default WebGPU limits
import { chromium } from 'playwright';

async function main() {
    const browser = await chromium.launch({
        headless: false,
        channel: 'chrome',
    });
    const page = await browser.newPage();

    // Use the local dev server which has WebGPU support
    await page.goto('http://localhost:3000/mystral/webgpu-limits.html');
    await page.waitForTimeout(2000);

    const limits = await page.evaluate(async () => {
        if (!navigator.gpu) {
            return { error: 'WebGPU not available - navigator.gpu is ' + typeof navigator.gpu };
        }

        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            return { error: 'No adapter' };
        }

        // Get adapter limits (what the hardware supports)
        const adapterLimits = {};
        for (const key in adapter.limits) {
            adapterLimits[key] = adapter.limits[key];
        }

        // Get device with default limits (what Chrome uses by default)
        const device = await adapter.requestDevice();
        const deviceLimits = {};
        for (const key in device.limits) {
            deviceLimits[key] = device.limits[key];
        }

        return {
            adapterLimits,
            deviceLimits
        };
    });

    console.log('=== Chrome WebGPU Default Limits ===\n');

    if (limits.error) {
        console.log('Error:', limits.error);
    } else {
        console.log('Device Limits (Chrome defaults):');
        console.log(JSON.stringify(limits.deviceLimits, null, 2));

        console.log('\n\nAdapter Limits (hardware max):');
        console.log(JSON.stringify(limits.adapterLimits, null, 2));

        // Highlight key limits for deferred rendering
        console.log('\n\n=== Key Limits for Deferred Rendering ===');
        console.log('maxColorAttachments:', limits.deviceLimits.maxColorAttachments);
        console.log('maxColorAttachmentBytesPerSample:', limits.deviceLimits.maxColorAttachmentBytesPerSample);
    }

    await browser.close();
}

main().catch(console.error);
