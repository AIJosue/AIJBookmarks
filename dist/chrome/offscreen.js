/**
 * AIJbookmarks - WebGPU Offscreen Compute Environment
 */

let gpuDevice = null;
let gpuAdapter = null;

async function initWebGPU() {
  if (gpuDevice) {
    return { supported: true, adapterInfo: gpuAdapter ? await gpuAdapter.requestAdapterInfo?.() : null };
  }

  if (typeof navigator === 'undefined' || !navigator.gpu) {
    return { supported: false, reason: 'WebGPU is not supported in this environment.' };
  }

  try {
    gpuAdapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!gpuAdapter) {
      return { supported: false, reason: 'No appropriate WebGPU adapter found.' };
    }

    gpuDevice = await gpuAdapter.requestDevice();

    return {
      supported: true,
      limits: gpuDevice.limits,
      adapterInfo: await gpuAdapter.requestAdapterInfo?.()
    };
  } catch (err) {
    return { supported: false, reason: err.message };
  }
}

/**
 * Message Dispatcher for Service Worker <-> Offscreen Communication
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.target || message.target !== 'offscreen') {
    return false;
  }

  const { action } = message;

  (async () => {
    try {
      switch (action) {
      case 'gpuCheckAvailability': {
        const status = await initWebGPU();
        sendResponse({ success: true, ...status });
        break;
      }
      default:
        sendResponse({ success: false, error: `Unknown offscreen action: ${action}` });
      }
    } catch (err) {
      console.error(`Offscreen execution error (${action}):`, err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true; // Keep channel open for async response
});
