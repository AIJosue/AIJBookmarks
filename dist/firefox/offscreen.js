/**
 * Bookmark AI - WebGPU Offscreen Compute Engine
 *
 * Implements:
 * 1. Persistent in-VRAM storage buffers for bookmark token/feature indices
 * 2. Parallel WGSL compute shaders for similarity scoring & relevance ranking
 * 3. Parallel GPU Bitonic sorting in VRAM
 * 4. Zero-copy ArrayBuffer transfer and mapped memory staging
 */

let gpuDevice = null;
let gpuAdapter = null;
let isInitializing = false;

// Persistent In-VRAM Storage Buffers
let vramBookmarksBuffer = null;
let vramBookmarksCapacity = 0;
let vramBookmarkCount = 0;
let vramPipelines = null;

// Bookmark feature layout in uint32 units (16 uint32s = 64 bytes per bookmark)
// [0]: bookmarkId u32
// [1]: dateAddedSeconds u32
// [2]: titleTokenCount u32
// [3]: urlTokenCount u32
// [4..11]: 8 title token hashes (u32)
// [12..15]: 4 URL/domain token hashes (u32)
const BOOKMARK_STRUCT_U32_COUNT = 16;
const BOOKMARK_STRUCT_BYTE_SIZE = BOOKMARK_STRUCT_U32_COUNT * 4;

/**
 * WGSL Compute Shader Sources
 */
const SCORING_WGSL = /* wgsl */ `
struct QueryParams {
  keywordHashes: array<vec4<u32>, 4>, // up to 16 keyword hashes packed in vec4
  keywordCount: u32,
  afterDate: u32,
  beforeDate: u32,
  flags: u32, // bit 0: hasDateAfter, bit 1: hasDateBefore
}

struct BookmarkFeature {
  id: u32,
  dateAdded: u32,
  titleLen: u32,
  urlLen: u32,
  titleHashes: array<vec4<u32>, 2>, // 8 title token hashes
  urlHashes: vec4<u32>,            // 4 url token hashes
}

struct ScoreResult {
  score: f32,
  index: u32,
}

@group(0) @binding(0) var<uniform> query: QueryParams;
@group(0) @binding(1) var<storage, read> bookmarks: array<BookmarkFeature>;
@group(0) @binding(2) var<storage, read_write> results: array<ScoreResult>;
@group(0) @binding(3) var<uniform> totalCount: u32;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;
  if (idx >= totalCount) {
    return;
  }

  let bm = bookmarks[idx];

  // Date filtering
  let hasAfter = (query.flags & 1u) != 0u;
  let hasBefore = (query.flags & 2u) != 0u;
  if (hasAfter && bm.dateAdded < query.afterDate) {
    results[idx] = ScoreResult(0.0, idx);
    return;
  }
  if (hasBefore && bm.dateAdded > query.beforeDate) {
    results[idx] = ScoreResult(0.0, idx);
    return;
  }

  var score: f32 = 0.0;
  let numKeywords = min(query.keywordCount, 16u);

  // If no keywords provided, score based on date recency
  if (numKeywords == 0u) {
    let recencyScore = f32(bm.dateAdded) / 1000000.0;
    results[idx] = ScoreResult(recencyScore, idx);
    return;
  }

  var matchedKeywords: u32 = 0u;

  for (var k: u32 = 0u; k < numKeywords; k = k + 1u) {
    let qVecIdx = k / 4u;
    let qElemIdx = k % 4u;
    let qHash = query.keywordHashes[qVecIdx][qElemIdx];
    if (qHash == 0u) {
      continue;
    }

    var kwMatched = false;

    // Check title tokens (weight: 3.0)
    for (var t: u32 = 0u; t < 8u; t = t + 1u) {
      let tVecIdx = t / 4u;
      let tElemIdx = t % 4u;
      let tHash = bm.titleHashes[tVecIdx][tElemIdx];
      if (tHash != 0u && tHash == qHash) {
        score = score + 3.0;
        kwMatched = true;
      }
    }

    // Check URL tokens (weight: 1.5)
    for (var u: u32 = 0u; u < 4u; u = u + 1u) {
      let uHash = bm.urlHashes[u];
      if (uHash != 0u && uHash == qHash) {
        score = score + 1.5;
        kwMatched = true;
      }
    }

    if (kwMatched) {
      matchedKeywords = matchedKeywords + 1u;
    }
  }

  // Bonus for matching all query keywords
  if (matchedKeywords == numKeywords && numKeywords > 1u) {
    score = score * 1.5;
  }

  // Slight recency tie-breaker
  if (score > 0.0) {
    score = score + (f32(bm.dateAdded % 100000u) / 1000000.0);
  }

  results[idx] = ScoreResult(score, idx);
}
`;

const BITONIC_SORT_WGSL = /* wgsl */ `
struct SortParams {
  stage: u32,
  stepOfStage: u32,
  totalCount: u32,
  direction: u32, // 1: descending, 0: ascending
}

struct ScoreResult {
  score: f32,
  index: u32,
}

@group(0) @binding(0) var<uniform> params: SortParams;
@group(0) @binding(1) var<storage, read_write> data: array<ScoreResult>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let i = global_id.x;
  let pairDistance = 1u << params.stepOfStage;
  let blockWidth   = 2u * pairDistance;

  let leftId = (i / pairDistance) * blockWidth + (i % pairDistance);
  let rightId = leftId + pairDistance;

  if (rightId >= params.totalCount) {
    return;
  }

  let sameDirectionBlock = ((leftId / (1u << (params.stage + 1u))) % 2u) == 0u;
  let isDescending = (params.direction == 1u);
  let shouldBeAscending = select(isDescending, !isDescending, sameDirectionBlock);

  let leftElem = data[leftId];
  let rightElem = data[rightId];

  var shouldSwap: bool;
  if (shouldBeAscending) {
    shouldSwap = leftElem.score > rightElem.score;
  } else {
    shouldSwap = leftElem.score < rightElem.score;
  }

  if (shouldSwap) {
    data[leftId] = rightElem;
    data[rightId] = leftElem;
  }
}
`;

/**
 * Initializes WebGPU Device and creates compute shader pipelines
 */
async function initWebGPU() {
  if (gpuDevice) return { supported: true, device: gpuDevice };
  if (!navigator.gpu) {
    return { supported: false, reason: 'WebGPU not supported in this browser environment.' };
  }

  try {
    gpuAdapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!gpuAdapter) {
      return { supported: false, reason: 'Failed to acquire WebGPU adapter.' };
    }

    gpuDevice = await gpuAdapter.requestDevice();

    gpuDevice.lost.then((info) => {
      console.warn('WebGPU device was lost:', info);
      gpuDevice = null;
      vramBookmarksBuffer = null;
      vramPipelines = null;
    });

    // Compile compute pipelines
    const scoringModule = gpuDevice.createShaderModule({ code: SCORING_WGSL });
    const sortingModule = gpuDevice.createShaderModule({ code: BITONIC_SORT_WGSL });

    const scoringPipeline = gpuDevice.createComputePipeline({
      layout: 'auto',
      compute: { module: scoringModule, entryPoint: 'main' }
    });

    const sortingPipeline = gpuDevice.createComputePipeline({
      layout: 'auto',
      compute: { module: sortingModule, entryPoint: 'main' }
    });

    vramPipelines = { scoringPipeline, sortingPipeline };

    return {
      supported: true,
      adapterInfo: {
        vendor: gpuAdapter.info?.vendor || 'Generic GPU',
        architecture: gpuAdapter.info?.architecture || 'Generic Architecture',
        device: gpuAdapter.info?.device || 'WebGPU Device'
      }
    };
  } catch (err) {
    console.error('Error initializing WebGPU:', err);
    return { supported: false, reason: err.message };
  }
}

/**
 * Synchronizes/allocates persistent VRAM buffer with bookmark feature data
 * @param {ArrayBuffer} rawDataBuffer Binary packed bookmark features
 * @param {number} count Total number of bookmarks
 */
async function syncVramBookmarkIndex(rawDataBuffer, count) {
  const init = await initWebGPU();
  if (!init.supported) throw new Error(init.reason);

  const byteSize = count * BOOKMARK_STRUCT_BYTE_SIZE;
  if (byteSize === 0) {
    vramBookmarkCount = 0;
    return { success: true, count: 0, vramBytes: 0 };
  }

  // Allocate or resize VRAM buffer if capacity is insufficient
  if (!vramBookmarksBuffer || vramBookmarksCapacity < byteSize) {
    if (vramBookmarksBuffer) {
      vramBookmarksBuffer.destroy();
    }
    // Allocate with headroom (power of two or minimum 64KB)
    vramBookmarksCapacity = Math.max(65536, Math.pow(2, Math.ceil(Math.log2(byteSize))));
    vramBookmarksBuffer = gpuDevice.createBuffer({
      size: vramBookmarksCapacity,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'VRAM_Bookmark_Features_Buffer'
    });
  }

  // Zero-copy transfer data into VRAM buffer
  gpuDevice.queue.writeBuffer(
    vramBookmarksBuffer,
    0,
    rawDataBuffer,
    0,
    byteSize
  );

  vramBookmarkCount = count;
  return {
    success: true,
    count,
    vramBytes: vramBookmarksCapacity,
    allocatedMB: (vramBookmarksCapacity / (1024 * 1024)).toFixed(2)
  };
}

/**
 * Runs parallel scoring and bitonic sorting entirely in VRAM
 * @param {object} queryOptions
 * @returns {Promise<{results: Array<{index: number, score: number}>, durationMs: number}>}
 */
async function runParallelGpuSearchAndSort(queryOptions) {
  const init = await initWebGPU();
  if (!init.supported) throw new Error(init.reason);
  if (!vramBookmarksBuffer || vramBookmarkCount === 0) {
    return { results: [], durationMs: 0 };
  }

  const startTime = performance.now();
  const count = vramBookmarkCount;

  // Round up count to next power of 2 for bitonic sorting
  const paddedCount = Math.max(256, Math.pow(2, Math.ceil(Math.log2(count))));
  const scoreElementByteSize = 8; // f32 score + u32 index = 8 bytes
  const scoreBufferSize = paddedCount * scoreElementByteSize;

  // 1. Create Query Uniform Buffer
  // QueryParams layout:
  // 16 u32 keywordHashes (64 bytes)
  // 1 u32 keywordCount (4 bytes)
  // 1 u32 afterDate (4 bytes)
  // 1 u32 beforeDate (4 bytes)
  // 1 u32 flags (4 bytes)
  const queryUniformData = new Uint32Array(20);
  const keywordHashes = queryOptions.keywordHashes || [];
  for (let i = 0; i < Math.min(16, keywordHashes.length); i++) {
    queryUniformData[i] = keywordHashes[i];
  }
  queryUniformData[16] = keywordHashes.length;
  queryUniformData[17] = queryOptions.afterDateSeconds || 0;
  queryUniformData[18] = queryOptions.beforeDateSeconds || 0;
  let flags = 0;
  if (queryOptions.afterDateSeconds) flags |= 1;
  if (queryOptions.beforeDateSeconds) flags |= 2;
  queryUniformData[19] = flags;

  const queryBuffer = gpuDevice.createBuffer({
    size: 80,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  gpuDevice.queue.writeBuffer(queryBuffer, 0, queryUniformData.buffer);

  const totalCountBuffer = gpuDevice.createBuffer({
    size: 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  gpuDevice.queue.writeBuffer(totalCountBuffer, 0, new Uint32Array([count]));

  // 2. Create VRAM Scores Buffer & Staging Buffer
  const scoresBuffer = gpuDevice.createBuffer({
    size: scoreBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    label: 'VRAM_Scores_Buffer'
  });

  const stagingBuffer = gpuDevice.createBuffer({
    size: scoreBufferSize,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    label: 'Staging_Readback_Buffer'
  });

  // 3. Bind and Dispatch Scoring Shader
  const scoringBindGroup = gpuDevice.createBindGroup({
    layout: vramPipelines.scoringPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: queryBuffer } },
      { binding: 1, resource: { buffer: vramBookmarksBuffer } },
      { binding: 2, resource: { buffer: scoresBuffer } },
      { binding: 3, resource: { buffer: totalCountBuffer } }
    ]
  });

  const commandEncoder = gpuDevice.createCommandEncoder();
  const scorePass = commandEncoder.beginComputePass();
  scorePass.setPipeline(vramPipelines.scoringPipeline);
  scorePass.setBindGroup(0, scoringBindGroup);
  scorePass.dispatchWorkgroups(Math.ceil(count / 256));
  scorePass.end();

  // 4. Bitonic Sort Passes in VRAM (Descending Order)
  const numStages = Math.log2(paddedCount);
  const sortParamsBuffer = gpuDevice.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

  for (let stage = 0; stage < numStages; stage++) {
    for (let step = stage; step >= 0; step--) {
      // SortParams: stage, stepOfStage, totalCount, direction (1 = descending)
      const sortParams = new Uint32Array([stage, step, paddedCount, 1]);
      gpuDevice.queue.writeBuffer(sortParamsBuffer, 0, sortParams);

      const sortBindGroup = gpuDevice.createBindGroup({
        layout: vramPipelines.sortingPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: sortParamsBuffer } },
          { binding: 1, resource: { buffer: scoresBuffer } }
        ]
      });

      const sortPass = commandEncoder.beginComputePass();
      sortPass.setPipeline(vramPipelines.sortingPipeline);
      sortPass.setBindGroup(0, sortBindGroup);
      sortPass.dispatchWorkgroups(Math.ceil((paddedCount / 2) / 256));
      sortPass.end();
    }
  }

  // 5. Copy sorted VRAM scores buffer to mapped readback buffer
  commandEncoder.copyBufferToBuffer(scoresBuffer, 0, stagingBuffer, 0, scoreBufferSize);
  gpuDevice.queue.submit([commandEncoder.finish()]);

  // 6. Asynchronous Map & Zero-Copy Result Read
  await stagingBuffer.mapAsync(GPUMapMode.READ);
  const mappedArray = new ArrayBuffer(scoreBufferSize);
  new Uint8Array(mappedArray).set(new Uint8Array(stagingBuffer.getMappedRange()));
  stagingBuffer.unmap();

  // Parse Top-K results
  const topK = queryOptions.topK || 50;
  const floatView = new Float32Array(mappedArray);
  const uintView = new Uint32Array(mappedArray);
  const results = [];

  for (let i = 0; i < Math.min(count, paddedCount); i++) {
    const score = floatView[i * 2];
    const index = uintView[i * 2 + 1];
    if (score > 0 && results.length < topK) {
      results.push({ index, score: parseFloat(score.toFixed(4)) });
    }
  }

  // Clean up transient execution buffers
  queryBuffer.destroy();
  totalCountBuffer.destroy();
  scoresBuffer.destroy();
  sortParamsBuffer.destroy();
  stagingBuffer.destroy();

  const durationMs = parseFloat((performance.now() - startTime).toFixed(2));
  return { results, durationMs, totalProcessed: count };
}

/**
 * Message Dispatcher for Service Worker <-> Offscreen Communication
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.target || message.target !== 'offscreen') {
    return false;
  }

  const { action, payload } = message;

  (async () => {
    try {
      switch (action) {
        case 'gpuCheckAvailability': {
          const status = await initWebGPU();
          sendResponse({ success: true, ...status });
          break;
        }
        case 'gpuSyncIndex': {
          const buffer = payload.buffer instanceof ArrayBuffer
            ? payload.buffer
            : (payload.buffer?.buffer || new Uint8Array(payload.buffer).buffer);
          const result = await syncVramBookmarkIndex(buffer, payload.count);
          sendResponse({ success: true, data: result });
          break;
        }
        case 'gpuSearchAndSort': {
          const result = await runParallelGpuSearchAndSort(payload);
          sendResponse({ success: true, data: result });
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

