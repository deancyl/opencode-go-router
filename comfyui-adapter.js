/**
 * ComfyUI Adapter & Visual Extension Engine (comfyui-adapter.js)
 * ==============================================================
 * Zero-hardcoding, manifest-driven adapter for local/remote ComfyUI instances.
 * Provides:
 *  - Debounced multi-target server sniffer (8284, 8188, custom URLs, env vars)
 *  - Machine-readable manifest resolution & semantic workflow matching
 *  - Execution graph parameter injection (prompt, negative, seed, resolution)
 *  - Robust queue polling, progress heartbeats, and /interrupt timeout safety
 *  - Local artifact image caching with safe URL serving
 *  - Dual-track image interrogation (ComfyUI WF03 + Vision LLM fallback)
 */

'use strict';

const http = require('http');
const https = require('https');
const url = require('url');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const child_process = require('child_process');

// Default constants
const DEFAULT_SNIFF_TARGETS = [
  'http://127.0.0.1:8284', // ZLUDA / AMD APU default
  'http://127.0.0.1:8188'  // Standard ComfyUI default
];
const SNIFF_CACHE_TTL_MS = 15000; // 15s debounce cache (Rule 7)
const DEFAULT_TASK_TIMEOUT_MS = 180000; // 3 minutes timeout

function cleanDeviceName(raw) {
  if (!raw || typeof raw !== 'string') return 'GPU Device';
  let s = raw.replace(/^cuda:[0-9]+ */i, '').replace(/ *: *native *$/i, '').trim();
  s = s.replace(/ Graphics/i, '');
  s = s.split('[').join('(').split(']').join(')');
  return s.trim() || raw;
}

class ComfyUIAdapter {
  constructor(options = {}) {
    this.config = options.config || {};
    this.enabled = this.config.comfyui?.enabled !== false;
    this.rootDir = options.rootDir || __dirname;
    this.artifactsDir = path.join(this.rootDir, 'artifacts', 'images');
    this.workflowsDir = this._resolveWorkflowsDir(options.workflowsDir);
    
    // Sniff cache
    this._sniffCache = {
      isOnline: false,
      serverUrl: null,
      deviceInfo: null,
      lastCheckedAt: 0,
      checking: false
    };

    // Manifest in-memory cache
    this.manifest = null;
    this.manifestPath = null;
    this._loadManifest();

    // Ensure artifacts directory exists
    try {
      if (!fs.existsSync(this.artifactsDir)) {
        fs.mkdirSync(this.artifactsDir, { recursive: true });
      }
    } catch (_) {}
  }

  /**
   * Resolve directory where workflows and workflows_manifest.json reside
   */
  _resolveWorkflowsDir(explicitDir) {
    const candidates = [
      explicitDir,
      this.config.comfyui?.workflowsDir,
      process.env.COMFYUI_WORKFLOWS_DIR,
      path.join(this.rootDir, 'comfyui-workflows'),
      path.join(this.rootDir, 'comfyui-agent-workflows'),
      path.join(this.rootDir, '..', 'comfyui-agent-workflows'),
      path.join(process.env.USERPROFILE || '', '.gemini', 'antigravity', 'scratch', 'comfyui-agent-workflows')
    ].filter(Boolean);

    for (const cand of candidates) {
      if (fs.existsSync(cand) && fs.existsSync(path.join(cand, 'workflows_manifest.json'))) {
        return cand;
      }
    }
    return candidates[0] || path.join(this.rootDir, 'comfyui-workflows');
  }

  /**
   * Load workflows_manifest.json into memory
   */
  _loadManifest() {
    if (!this.workflowsDir) return false;
    const mPath = path.join(this.workflowsDir, 'workflows_manifest.json');
    if (fs.existsSync(mPath)) {
      try {
        const raw = fs.readFileSync(mPath, 'utf8');
        this.manifest = JSON.parse(raw);
        this.manifestPath = mPath;
        return true;
      } catch (e) {
        console.error(`[ComfyUI] 无法解析 workflows_manifest.json: ${e.message}`);
      }
    }
    return false;
  }

  /**
   * Refresh manifest from disk
   */
  reloadManifest() {
    this.workflowsDir = this._resolveWorkflowsDir();
    return this._loadManifest();
  }

  /**
   * Sniff and detect ComfyUI server status with debouncing (TTL 15s)
   */
  async detectServer(force = false) {
    const now = Date.now();
    if (!force && this._sniffCache.lastCheckedAt && (now - this._sniffCache.lastCheckedAt < SNIFF_CACHE_TTL_MS)) {
      return { ...this._sniffCache };
    }

    // Candidate server URLs in priority order
    const targets = [];
    if (this.config.comfyui?.host) {
      const u = this._normalizeUrl(this.config.comfyui.host);
      if (u) targets.push(u);
    }
    if (process.env.COMFYUI_HOST) {
      const u = this._normalizeUrl(process.env.COMFYUI_HOST);
      if (u) targets.push(u);
    }
    for (const t of DEFAULT_SNIFF_TARGETS) {
      const norm = this._normalizeUrl(t);
      if (!targets.includes(norm)) targets.push(norm);
    }

    for (const targetUrl of targets) {
      try {
        const stats = await this._httpGetJson(`${targetUrl}/system_stats`, 2500);
        if (stats && stats.system) {
          const deviceName = stats.devices?.[0]?.name || 'GPU Device';
          const vramTotal = stats.devices?.[0]?.vram_total || 0;
          this._sniffCache = {
            isOnline: true,
            serverUrl: targetUrl,
            deviceInfo: {
              name: cleanDeviceName(deviceName),
              rawName: deviceName,
              vramTotal,
              os: stats.system.os,
              comfyVersion: stats.system.comfyui_version
            },
            lastCheckedAt: now
          };
          return { ...this._sniffCache };
        }
      } catch (_) {
        // Try next candidate
      }
    }

    // None reachable
    this._sniffCache = {
      isOnline: false,
      serverUrl: null,
      deviceInfo: null,
      lastCheckedAt: now
    };
    return { ...this._sniffCache };
  }

  /**
   * Alias for detectServer for backward compatibility and plugin probe interface
   */
  async sniffActiveServer(force = false) {
    return await this.detectServer(force);
  }

  /**
   * Lookup and match workflow by ID, filename prefix, or semantic style tags
   */
  resolveWorkflow(identifierOrQuery, promptText = '') {
    if (!this.manifest) {
      this._loadManifest();
    }
    if (!this.manifest) return null;

    if (!identifierOrQuery || identifierOrQuery === 'auto') {
      // If user prompt explicitly requests fast sketch/draft, auto-route to 04 (Fast Draft)
      if (promptText && /极速|快速|速写|速画|草图|抽卡|试画|快画|draft|sketch|fast|preview/i.test(promptText)) {
        return this.manifest['04'] || this.manifest['01'] || Object.values(this.manifest)[0] || null;
      }
      // Default to 01 (Quality Photorealistic)
      return this.manifest['01'] || Object.values(this.manifest)[0] || null;
    }

    const clean = String(identifierOrQuery).trim();
    
    // 1. Direct ID match (e.g. "01", "04")
    if (this.manifest[clean]) {
      return this.manifest[clean];
    }

    // 2. Prefix match (e.g. "01_真人写实..." -> "01")
    const idPrefix = clean.split('_')[0];
    if (this.manifest[idPrefix]) {
      return this.manifest[idPrefix];
    }

    // 3. Exact name match
    for (const [wid, entry] of Object.entries(this.manifest)) {
      if (entry.name && entry.name.toLowerCase() === clean.toLowerCase()) {
        return entry;
      }
    }

    // 4. Semantic style tag or keyword match
    const qLower = clean.toLowerCase();
    for (const [wid, entry] of Object.entries(this.manifest)) {
      const tags = (entry.style_tags || []).map(t => String(t).toLowerCase());
      if (tags.some(t => t.includes(qLower) || qLower.includes(t))) {
        return entry;
      }
      if (entry.name && entry.name.toLowerCase().includes(qLower)) {
        return entry;
      }
      if (entry.description && entry.description.toLowerCase().includes(qLower)) {
        return entry;
      }
    }

    // Fallback to default
    return this.manifest['01'] || Object.values(this.manifest)[0] || null;
  }

  /**
   * Check if user explicitly requested heavy/twostage high-resolution upscale mode
   */
  isHeavyQualityRequested(options = {}) {
    if (options.mode === 'heavy' || options.mode === 'twostage' || options.mode === 'upscale') {
      return true;
    }
    const prompt = String(options.prompt || '');
    const heavyKeywords = ['超分', '精雕', '微雕', '高精重绘', '二阶段', '两阶段', '打印级', 'hires', 'upscale', 'highres'];
    return heavyKeywords.some(kw => prompt.toLowerCase().includes(kw));
  }

  /**
   * Build execution graph with parameters injected based on manifest node metadata
   */
  buildExecutionGraph(wfMeta, options = {}) {
    if (!wfMeta || !wfMeta.api_file) {
      throw new Error('无效的工作流元数据，无法构建执行图');
    }

    const apiPath = path.isAbsolute(wfMeta.api_file)
      ? wfMeta.api_file
      : path.join(this.workflowsDir, wfMeta.api_file);

    if (!fs.existsSync(apiPath)) {
      throw new Error(`找不到工作流 API 格式定义文件: ${apiPath}`);
    }

    let raw;
    try {
      raw = fs.readFileSync(apiPath, 'utf8');
    } catch (readErr) {
      throw new Error(`无法读取工作流定义文件 (${apiPath}): ${readErr.message}`);
    }

    let graph;
    try {
      graph = JSON.parse(raw);
    } catch (parseErr) {
      throw new Error(`工作流定义文件 JSON 语法损坏 (${apiPath}): ${parseErr.message}`);
    }

    const {
      prompt,
      negative,
      seed,
      width,
      height,
      steps,
      cfg,
      denoise
    } = options;

    const usedSeed = typeof seed === 'number' && !isNaN(seed)
      ? seed
      : Math.floor(Math.random() * 2147483647);

    const isHeavy = this.isHeavyQualityRequested(options);
    const fastDirectMode = !isHeavy;

    // 1. Inject Positive Prompt
    if (prompt && wfMeta.prompt_node) {
      const pnId = String(wfMeta.prompt_node.id);
      const field = wfMeta.prompt_node.field || 'text';
      if (graph[pnId] && graph[pnId].inputs) {
        graph[pnId].inputs[field] = prompt;
      }
    }

    // 2. Inject Negative Prompt
    if (negative && wfMeta.negative_node) {
      const nnId = String(wfMeta.negative_node.id);
      const field = wfMeta.negative_node.field || 'text';
      if (graph[nnId] && graph[nnId].inputs) {
        graph[nnId].inputs[field] = negative;
      }
    }

    // 3. Inject Seed & Sampler Parameters (Quality Track)
    const effectiveSteps = typeof steps === 'number'
      ? steps
      : (fastDirectMode ? 15 : undefined);

    if (wfMeta.sampler_node) {
      const snId = String(wfMeta.sampler_node.id);
      if (graph[snId] && graph[snId].inputs) {
        const sfield = wfMeta.sampler_node.seed_field || 'seed';
        graph[snId].inputs[sfield] = usedSeed;
        if (typeof effectiveSteps === 'number' && wfMeta.sampler_node.steps_field) {
          graph[snId].inputs[wfMeta.sampler_node.steps_field] = effectiveSteps;
        }
        if (typeof cfg === 'number' && wfMeta.sampler_node.cfg_field) {
          graph[snId].inputs[wfMeta.sampler_node.cfg_field] = cfg;
        }
        if (typeof denoise === 'number' && wfMeta.sampler_node.denoise_field) {
          graph[snId].inputs[wfMeta.sampler_node.denoise_field] = denoise;
        }
      }
    }

    // Refine sampler seed (keep consistent or randomize)
    if (wfMeta.refine_sampler_node) {
      const rsnId = String(wfMeta.refine_sampler_node.id);
      if (graph[rsnId] && graph[rsnId].inputs) {
        const sfield = wfMeta.refine_sampler_node.seed_field || 'seed';
        graph[rsnId].inputs[sfield] = usedSeed;
      }
    }

    // 4. Single-Stage Fast Direct Quality Track Pruning
    // In AMD iGPU / APU environments, 1.5x LatentUpscaleBy triggers severe memory paging.
    // Prune the second-stage upscale to achieve 15-step direct output (3x-5x speedup).
    if (fastDirectMode && wfMeta.sampler_node && wfMeta.refine_sampler_node) {
      const mainSamplerId = String(wfMeta.sampler_node.id);
      const refineSamplerId = String(wfMeta.refine_sampler_node.id);

      // Reconnect VAEDecode directly to main sampler
      for (const [nid, node] of Object.entries(graph)) {
        if (node.class_type === 'VAEDecode' && Array.isArray(node.inputs?.samples)) {
          if (node.inputs.samples[0] === refineSamplerId) {
            node.inputs.samples = [mainSamplerId, 0];
          }
        }
      }

      // Safely delete refine sampler node
      delete graph[refineSamplerId];

      // Safely delete all LatentUpscaleBy nodes
      for (const [nid, node] of Object.entries(graph)) {
        if (node.class_type === 'LatentUpscaleBy') {
          delete graph[nid];
        }
      }
    }

    // 5. Inject Latent Dimensions with Smart Clamping for SD1.5 (avoid 1024x1024 square distortion & OOM timeouts)
    if (width || height || wfMeta.default_size) {
      let w = width || (wfMeta.default_size?.width || 512);
      let h = height || (wfMeta.default_size?.height || 768);
      const isGiantSquare = (w >= 1024 && h >= 1024);
      const isExtreme = (w > 1024 || h > 1024);
      if (options.clampResolution === true || isGiantSquare || isExtreme) {
        const maxDim = 768;
        const scale = maxDim / Math.max(w, h);
        w = Math.round((w * scale) / 64) * 64;
        h = Math.round((h * scale) / 64) * 64;
      }
      for (const [nid, node] of Object.entries(graph)) {
        if (node.class_type === 'EmptyLatentImage' && node.inputs) {
          node.inputs.width = w;
          node.inputs.height = h;
          break;
        }
      }
    }

    // 6. Output Track Optimization: Prune redundant preview branch to accelerate Quality track by 2-3x
    if (options.track !== 'preview' && wfMeta.preview_output_node) {
      delete graph[String(wfMeta.preview_output_node)];
      if (wfMeta.preview_sampler_node?.id) {
        delete graph[String(wfMeta.preview_sampler_node.id)];
      }
    }

    return { graph, usedSeed, isFastDirect: fastDirectMode };
  }

  /**
   * Submit prompt and poll for completion with timeout & queue safety
   */
  async executeGeneration(options = {}) {
    const snInfo = await this.detectServer();
    if (!snInfo.isOnline) {
      throw new Error('ComfyUI 实例未在线。请确认本地服务已启动 (8284/8188) 或在网关控制台配置远端服务器。');
    }

    const {
      prompt,
      negative,
      workflow: reqWf,
      width,
      height,
      seed,
      onProgress
    } = options;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      throw new Error('生图提示词 (prompt) 不能为空');
    }

    const wfMeta = this.resolveWorkflow(reqWf, prompt.trim());
    if (!wfMeta) {
      throw new Error(`无法匹配适用的生图工作流: ${reqWf || 'default'}`);
    }

    const { graph, usedSeed, isFastDirect } = this.buildExecutionGraph(wfMeta, {
      ...options,
      prompt: prompt.trim(),
      negative: negative ? negative.trim() : null,
      seed,
      width,
      height
    });

    const startTime = Date.now();
    const serverUrl = snInfo.serverUrl;
    const clientId = `router-gen-${crypto.randomBytes(6).toString('hex')}`;

    // 1. Queue Prompt
    const queueRes = await this._httpPostJson(`${serverUrl}/prompt`, {
      prompt: graph,
      client_id: clientId
    });

    if (!queueRes || !queueRes.prompt_id) {
      const errMsg = queueRes?.node_errors
        ? `ComfyUI 节点校验失败: ${JSON.stringify(queueRes.node_errors)}`
        : '未能从 ComfyUI 接收到有效的 prompt_id';
      throw new Error(errMsg);
    }

    const promptId = queueRes.prompt_id;

    // 2. Poll for completion with Keep-Alive progress callbacks & cancellation guard
    const timeoutMs = options.timeoutMs || this.config.comfyui?.timeoutSec * 1000 || DEFAULT_TASK_TIMEOUT_MS;
    let historyEntry = null;
    let pollRounds = 0;

    try {
      while (Date.now() - startTime < timeoutMs) {
        if (typeof options.isCancelled === 'function' && options.isCancelled()) {
          this.cancelPrompt(serverUrl, promptId).catch(() => {});
          throw new Error('客户端连接已断开，生图任务已安全中断');
        }

        pollRounds++;
        const pollDelay = pollRounds <= 6 ? 700 : 1000;
        await new Promise(r => setTimeout(r, pollDelay));

        // Call progress callback to send keep-alive SSE pings or UI deltas
        if (typeof onProgress === 'function') {
          const elapsedSec = Math.round((Date.now() - startTime) / 1000);
          onProgress({ promptId, elapsedSec, round: pollRounds });
        }

        // Check history
        const hist = await this._httpGetJson(`${serverUrl}/history/${promptId}`);
        if (hist && hist[promptId]) {
          historyEntry = hist[promptId];
          break;
        }

        // Check queue to ensure task hasn't silently failed or vanished
        if (pollRounds % 4 === 0) {
          const qStatus = await this._httpGetJson(`${serverUrl}/queue`);
          const isPending = (qStatus?.queue_pending || []).some(item => item[1] === promptId);
          const isRunning = (qStatus?.queue_running || []).some(item => item[1] === promptId);
          if (!isPending && !isRunning && !historyEntry) {
            // Task neither in queue nor in history -> re-check history once more
            const recheck = await this._httpGetJson(`${serverUrl}/history/${promptId}`);
            if (recheck && recheck[promptId]) {
              historyEntry = recheck[promptId];
              break;
            }
            throw new Error(`生图任务 ${promptId} 在队列中意外中断或被移除。`);
          }
        }
      }
    } catch (err) {
      // If error or timeout, interrupt and purge from queue to free GPU VRAM & eliminate orphan tasks
      this.cancelPrompt(serverUrl, promptId).catch(() => {});
      throw err;
    }

    if (!historyEntry) {
      this.cancelPrompt(serverUrl, promptId).catch(() => {});
      throw new Error(`生图任务超时 (${Math.round(timeoutMs / 1000)}s)，已执行安全熔断。`);
    }

    // 3. Locate generated output image
    const outputs = historyEntry.outputs || {};
    let targetImage = null;

    // Look for target output_node first
    const expectedOutNode = wfMeta.output_node ? String(wfMeta.output_node) : null;
    if (expectedOutNode && outputs[expectedOutNode]?.images?.[0]) {
      targetImage = outputs[expectedOutNode].images[0];
    } else {
      // Search all nodes for output images
      for (const [nid, nodeOut] of Object.entries(outputs)) {
        if (Array.isArray(nodeOut.images) && nodeOut.images.length > 0) {
          targetImage = nodeOut.images[0];
          break;
        }
      }
    }

    if (!targetImage || !targetImage.filename) {
      let errDetail = '';
      if (historyEntry.status && typeof historyEntry.status === 'object') {
        const msgs = historyEntry.status.messages;
        if (Array.isArray(msgs) && msgs.length > 0) {
          errDetail = msgs.map(m => Array.isArray(m) ? m.slice(1).join(': ') : String(m)).join('; ');
        } else if (historyEntry.status.status_str) {
          errDetail = historyEntry.status.status_str;
        }
      }
      const fullMsg = errDetail
        ? `ComfyUI 节点执行失败: ${errDetail}`
        : 'ComfyUI 执行完成但未产出图像文件。请检查工作流中是否包含 SaveImage 节点。';
      throw new Error(fullMsg);
    }

    // 4. Download image bytes from ComfyUI /view
    const viewUrl = `${serverUrl}/view?filename=${encodeURIComponent(targetImage.filename)}&subfolder=${encodeURIComponent(targetImage.subfolder || '')}&type=${encodeURIComponent(targetImage.type || 'output')}`;
    const imageBuffer = await this._httpGetBuffer(viewUrl);

    // 5. Save to local artifacts directory (with directory guard)
    try {
      if (!fs.existsSync(this.artifactsDir)) {
        fs.mkdirSync(this.artifactsDir, { recursive: true });
      }
    } catch (_) {}
    const ext = path.extname(targetImage.filename) || '.png';
    const localFilename = `img_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
    const localFilePath = path.join(this.artifactsDir, localFilename);
    fs.writeFileSync(localFilePath, imageBuffer);

    const elapsedMs = Date.now() - startTime;
    const maxInlineB64Bytes = options.maxBase64Bytes || 5 * 1024 * 1024; // 5MB safety limit
    let cachedBase64 = null;
    const getBase64 = () => {
      if (cachedBase64 !== null) return cachedBase64;
      if (imageBuffer.length > maxInlineB64Bytes) {
        console.warn(`[ComfyUI] 产物图像体积 (${(imageBuffer.length / 1024 / 1024).toFixed(2)} MB) 超过单次 Base64 内联安全上限 (5MB)，已降级为本地 URL 引用以防止 V8 堆内存溢出。`);
        return null;
      }
      cachedBase64 = imageBuffer.toString('base64');
      return cachedBase64;
    };

    const resObj = {
      success: true,
      filename: localFilename,
      localPath: localFilePath,
      url: `/artifacts/images/${localFilename}`,
      mimeType: ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png',
      workflowName: wfMeta.name,
      workflowId: wfMeta.id,
      seed: usedSeed,
      prompt,
      negative: negative || '',
      durationMs: elapsedMs,
      sizeBytes: imageBuffer.length,
      isFastDirect
    };

    Object.defineProperty(resObj, 'base64', {
      enumerable: true,
      configurable: true,
      get: getBase64
    });

    return resObj;
  }

  /**
   * Cancel and purge task: interrupts running execution and deletes from pending queue
   */
  async cancelPrompt(serverUrl, promptId = null) {
    const sUrl = serverUrl || (await this.detectServer()).serverUrl;
    if (!sUrl) return false;
    try {
      const actions = [this.interrupt(sUrl)];
      if (promptId) {
        actions.push(this._deleteFromQueue(sUrl, promptId));
      }
      await Promise.allSettled(actions);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Delete pending prompt from ComfyUI queue to avoid orphan task execution
   */
  async _deleteFromQueue(serverUrl, promptId) {
    if (!serverUrl || !promptId) return false;
    try {
      await this._httpPostJson(`${serverUrl}/queue`, { delete: [promptId] }, 3000);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Interrupt current running tasks on ComfyUI
   */
  async interrupt(serverUrl) {
    const sUrl = serverUrl || (await this.detectServer()).serverUrl;
    if (!sUrl) return false;
    try {
      await this._httpPostJson(`${sUrl}/interrupt`, {});
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Safe image interrogation (WF03 + Vision LLM fallback)
   */
  async interrogateImage(imageBufferOrPath, fallbackVisionFn) {
    let imgBuf = null;
    if (typeof imageBufferOrPath === 'string') {
      if (fs.existsSync(imageBufferOrPath)) {
        imgBuf = fs.readFileSync(imageBufferOrPath);
      } else if (imageBufferOrPath.startsWith('data:image')) {
        const commaIdx = imageBufferOrPath.indexOf(',');
        imgBuf = Buffer.from(imageBufferOrPath.slice(commaIdx + 1), 'base64');
      }
    } else if (Buffer.isBuffer(imageBufferOrPath)) {
      imgBuf = imageBufferOrPath;
    }

    if (!imgBuf) {
      throw new Error('反推图像数据无效或文件不存在');
    }

    const snInfo = await this.detectServer();
    const wf03 = this.resolveWorkflow('03');

    // Track 1: If ComfyUI is online and WF03 exists, attempt local interrogation
    if (snInfo.isOnline && wf03) {
      try {
        const uploadRes = await this._uploadImageToComfy(snInfo.serverUrl, imgBuf);
        if (uploadRes && uploadRes.name) {
          const apiPath = path.isAbsolute(wf03.api_file)
            ? wf03.api_file
            : path.join(this.workflowsDir, wf03.api_file);
          if (fs.existsSync(apiPath)) {
            const graph = JSON.parse(fs.readFileSync(apiPath, 'utf8'));
            // LoadImage node (ID 1)
            if (graph['1'] && graph['1'].inputs) {
              graph['1'].inputs.image = uploadRes.name;
            }
            // Queue task and wait
            const clientId = `router-interrogate-${crypto.randomBytes(4).toString('hex')}`;
            const queueRes = await this._httpPostJson(`${snInfo.serverUrl}/prompt`, {
              prompt: graph,
              client_id: clientId
            });
            if (queueRes?.prompt_id) {
              const hist = await this._pollHistoryUntilDone(snInfo.serverUrl, queueRes.prompt_id, 30000);
              if (hist?.outputs) {
                // Find any text outputs
                const textParts = [];
                for (const out of Object.values(hist.outputs)) {
                  if (out.text) {
                    textParts.push(Array.isArray(out.text) ? out.text.join('\n') : String(out.text));
                  }
                }
                if (textParts.length > 0) {
                  return {
                    source: 'comfyui_wf03',
                    tags: textParts.join('\n\n'),
                    rawOutputs: hist.outputs
                  };
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[ComfyUI] 本地 WF03 反推失败，准备无缝降级至视觉大模型: ${err.message}`);
      }
    }

    // Track 2: Transparent fallback to Gateway Vision LLM
    if (typeof fallbackVisionFn === 'function') {
      const visionResult = await fallbackVisionFn(imgBuf);
      return {
        source: 'gateway_vision_llm',
        tags: visionResult
      };
    }

    throw new Error('本地反推工作流不可用，且未配置视觉模型兜底。');
  }

  async _uploadImageToComfy(serverUrl, imageBuffer) {
    return new Promise((resolve, reject) => {
      const boundary = `----WebKitFormBoundary${crypto.randomBytes(8).toString('hex')}`;
      const filename = `upload_${Date.now()}.png`;

      const header = `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`;
      const footer = `\r\n--${boundary}--\r\n`;

      const payload = Buffer.concat([
        Buffer.from(header, 'utf8'),
        imageBuffer,
        Buffer.from(footer, 'utf8')
      ]);

      const u = new URL(`${this._normalizeUrl(serverUrl)}/upload/image`);
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request({
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': payload.length
        },
        timeout: 10000
      }, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`上传图片失败: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('上传图片超时'));
      });

      req.write(payload);
      req.end();
    });
  }

  async _pollHistoryUntilDone(serverUrl, promptId, timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 1000));
      const hist = await this._httpGetJson(`${serverUrl}/history/${promptId}`);
      if (hist && hist[promptId]) {
        return hist[promptId];
      }
    }
    return null;
  }

  _normalizeUrl(url) {
    if (!url) return '';
    let trimmed = String(url).trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(trimmed)) {
      trimmed = 'http://' + trimmed;
    }
    return trimmed;
  }

  // HTTP Helper Methods
  _httpGetJson(targetUrl, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const u = new URL(this._normalizeUrl(targetUrl));
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.get({
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        timeout: timeoutMs
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error(`JSON 解析失败: ${data.slice(0, 100)}`));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 100)}`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`请求超时 (${timeoutMs}ms)`));
      });
    });
  }

  _httpGetBuffer(targetUrl, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const u = new URL(this._normalizeUrl(targetUrl));
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.get({
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        timeout: timeoutMs
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(Buffer.concat(chunks));
          } else {
            reject(new Error(`下载产物失败 HTTP ${res.statusCode}`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('下载图像超时'));
      });
    });
  }

  _httpPostJson(targetUrl, body, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const u = new URL(this._normalizeUrl(targetUrl));
      const mod = u.protocol === 'https:' ? https : http;
      const payload = Buffer.from(JSON.stringify(body), 'utf8');

      const req = mod.request({
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length
        },
        timeout: timeoutMs
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed);
            } else {
              resolve({ error: parsed, statusCode: res.statusCode });
            }
          } catch (_) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ raw: data });
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 100)}`));
            }
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('提交任务超时'));
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * Helper to test if a TCP port is currently active on localhost
   */
  _isPortListening(port) {
    return new Promise((resolve) => {
      const net = require('net');
      const socket = new net.Socket();
      socket.setTimeout(1200);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(port, '127.0.0.1');
    });
  }

  /**
   * Detect local ComfyUI installations on the host system
   */
  detectLocalComfyUIDirs() {
    const userProfile = process.env.USERPROFILE || process.env.HOME || '';
    const candidates = [
      this.config.comfyui?.localDir,
      path.join(userProfile, 'ComfyUI-Zluda'),
      'G:\\ComfyUI\\ComfyUI-aki\\ComfyUI-aki-v3.2\\ComfyUI',
      'C:\\ComfyUI',
      'D:\\ComfyUI',
      path.join(userProfile, 'ComfyUI'),
      path.join(this.rootDir, '..', 'ComfyUI-Zluda'),
      path.join(this.rootDir, '..', 'ComfyUI')
    ].filter(Boolean);

    const results = [];
    const seen = new Set();
    for (const c of candidates) {
      const norm = path.normalize(c);
      if (seen.has(norm.toLowerCase())) continue;
      seen.add(norm.toLowerCase());
      try {
        if (fs.existsSync(norm) && fs.existsSync(path.join(norm, 'main.py'))) {
          results.push({
            path: norm,
            hasZluda: fs.existsSync(path.join(norm, 'zluda', 'zluda.exe')),
            hasZludaScript: fs.existsSync(path.join(norm, 'start_zluda_amd.ps1')),
            hasCpuScript: fs.existsSync(path.join(norm, 'start_cpu_bg.ps1')),
            hasVenv: fs.existsSync(path.join(norm, 'venv', 'Scripts', 'python.exe')) || fs.existsSync(path.join(norm, 'venv', 'bin', 'python')),
            hasWorkflows: fs.existsSync(path.join(norm, 'user', 'default', 'workflows'))
          });
        }
      } catch (_) {}
    }
    return results;
  }

  /**
   * Start local ComfyUI service in background (GPU or CPU mode, zero console black box)
   */
  async startService(options = {}) {
    const port = parseInt(options.port, 10) || parseInt(this.config.comfyui?.port, 10) || 8284;
    const mode = options.mode || this.config.comfyui?.startupMode || 'gpu';

    // 1. Check if already listening
    const alreadyListening = await this._isPortListening(port);
    if (alreadyListening) {
      await this.detectServer(true);
      return {
        success: true,
        alreadyRunning: true,
        port,
        message: `ComfyUI 服务已在端口 ${port} 处于监听状态`,
        deviceInfo: this._sniffCache.deviceInfo
      };
    }

    // 2. Resolve ComfyUI installation directory
    let localDir = options.localDir || this.config.comfyui?.localDir;
    if (!localDir || !fs.existsSync(path.join(localDir, 'main.py'))) {
      const detected = this.detectLocalComfyUIDirs();
      if (detected.length > 0) {
        localDir = detected[0].path;
      }
    }

    if (!localDir || !fs.existsSync(path.join(localDir, 'main.py'))) {
      throw new Error('未检测到本地 ComfyUI 安装目录 (缺少 main.py)。请在控制面板指定目录或先从仓库部署。');
    }

    // 3. Launch process (Windows decoupled / native background)
    const isWin = process.platform === 'win32';
    if (isWin) {
      const zludaPs1 = path.join(localDir, 'start_zluda_amd.ps1');
      const cpuPs1 = path.join(localDir, 'start_cpu_bg.ps1');
      const venvPy = path.join(localDir, 'venv', 'Scripts', 'python.exe');
      const pythonExe = fs.existsSync(venvPy) ? venvPy : 'python.exe';

      let execCmd = 'powershell.exe';
      let execArgs = [];

      if (mode === 'cpu' && fs.existsSync(cpuPs1)) {
        execArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', cpuPs1];
      } else if (mode === 'gpu' && fs.existsSync(zludaPs1)) {
        execArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', zludaPs1, '-Port', String(port)];
      } else {
        execCmd = pythonExe;
        execArgs = ['main.py', '--port', String(port), '--disable-auto-launch'];
        if (mode === 'cpu') {
          execArgs.push('--cpu');
        } else {
          execArgs.push('--cpu-vae', '--use-pytorch-cross-attention', '--disable-comfy-compiler', '--reserve-vram', '0.9');
        }
      }

      const childEnv = { ...process.env };
      childEnv.COMFYUI_PORT = String(port);
      if (mode === 'gpu') {
        childEnv.HIP_PATH = childEnv.HIP_PATH || 'C:\\Program Files\\AMD\\ROCm\\5.7\\';
        childEnv.ROCBLAS_TENSILE_LIBPATH = path.join(localDir, 'gfx1103_libs', 'library');
        childEnv.PATH = path.join(localDir, 'zluda') + ';C:\\Program Files\\AMD\\ROCm\\5.7\\bin;' + (childEnv.PATH || '');
        childEnv.ZLUDA_COMGR_LOG_LEVEL = '1';
        childEnv.MIOPEN_FIND_MODE = '2';
        childEnv.MIOPEN_LOG_LEVEL = '3';
        childEnv.TORCH_BACKENDS_CUDNN_ENABLED = '0';
        childEnv.TORCH_COMPILE_DISABLE = '1';
      } else {
        childEnv.CUDA_VISIBLE_DEVICES = '';
        childEnv.PATH = path.join(localDir, 'zluda') + ';' + (childEnv.PATH || '');
        childEnv.TORCH_COMPILE_DISABLE = '1';
      }

      const sub = child_process.spawn(execCmd, execArgs, {
        cwd: localDir,
        env: childEnv,
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      sub.unref();
    } else {
      const venvPy = path.join(localDir, 'venv', 'bin', 'python');
      const pythonExe = fs.existsSync(venvPy) ? venvPy : 'python3';
      const args = ['main.py', '--port', String(port), '--disable-auto-launch'];
      if (mode === 'cpu') args.push('--cpu');
      const sub = child_process.spawn(pythonExe, args, {
        cwd: localDir,
        detached: true,
        stdio: 'ignore'
      });
      sub.unref();
    }

    // 4. Poll until port is active (up to 30s)
    let started = false;
    const startDeadline = Date.now() + 30000;
    while (Date.now() < startDeadline) {
      await new Promise(r => setTimeout(r, 600));
      const active = await this._isPortListening(port);
      if (active) {
        started = true;
        break;
      }
    }

    if (!started) {
      return {
        success: false,
        port,
        localDir,
        message: 'ComfyUI 已发送启动指令，但 30 秒内尚未完成加载，请稍后点击“探测重载”。'
      };
    }

    // 5. Update sniff cache
    await this.detectServer(true);

    return {
      success: true,
      port,
      mode,
      localDir,
      deviceInfo: this._sniffCache.deviceInfo,
      message: `ComfyUI 服务已成功启动并在端口 ${port} 监听！`
    };
  }

  /**
   * Stop local ComfyUI service safely and release port/VRAM
   */
  async stopService(options = {}) {
    const port = parseInt(options.port, 10) || parseInt(this.config.comfyui?.port, 10) || 8284;
    const isWin = process.platform === 'win32';

    if (isWin) {
      try {
        const psCmd = `$conns = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue; if ($conns) { $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($p in $pids) { taskkill /F /T /PID $p } }`;
        child_process.execSync(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${psCmd}"`, {
          timeout: 10000,
          windowsHide: true,
          stdio: 'ignore'
        });
      } catch (_) {}
    } else {
      try {
        child_process.execSync(`fuser -k ${port}/tcp`, { timeout: 5000, stdio: 'ignore' });
      } catch (_) {}
    }

    // Wait up to 5s for port release
    let released = false;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 300));
      const stillActive = await this._isPortListening(port);
      if (!stillActive) {
        released = true;
        break;
      }
    }

    this._sniffCache.isOnline = false;
    this._sniffCache.serverUrl = null;
    this._sniffCache.deviceInfo = null;
    this._sniffCache.lastCheckedAt = Date.now();

    return {
      success: true,
      port,
      released,
      message: released ? 'ComfyUI 服务已安全停止，显存与端口已完全释放。' : '停止指令已发送，端口正在释放中。'
    };
  }

  /**
   * Restart ComfyUI service
   */
  async restartService(options = {}) {
    await this.stopService(options);
    await new Promise(r => setTimeout(r, 1200));
    return await this.startService(options);
  }

  /**
   * Clone or pull workflows repository directly from GitHub
   */
  async syncWorkflowsFromGitHub(options = {}) {
    const repoUrl = (options.repoUrl || this.config.comfyui?.repoUrl || 'https://github.com/deancyl/comfyui-agent-workflows').trim();
    let targetDir = options.targetDir || this.workflowsDir;

    if (!targetDir || !fs.existsSync(targetDir)) {
      const scratchDir = path.join(process.env.USERPROFILE || '', '.gemini', 'antigravity', 'scratch', 'comfyui-agent-workflows');
      if (fs.existsSync(scratchDir) && fs.existsSync(path.join(scratchDir, 'workflows_manifest.json'))) {
        targetDir = scratchDir;
      } else {
        targetDir = path.join(this.rootDir, 'comfyui-agent-workflows');
      }
    }

    const logMessages = [];
    const log = (msg) => { logMessages.push(msg); };

    log(`[Sync] 正在从 GitHub 远端仓库同步: ${repoUrl}`);
    log(`[Sync] 本地存储目标目录: ${targetDir}`);

    const hasGit = (() => {
      try {
        child_process.execSync('git --version', { stdio: 'ignore', timeout: 3000 });
        return true;
      } catch (_) {
        return false;
      }
    })();

    let syncSuccess = false;

    // Strategy 1: Git clone or pull
    if (hasGit) {
      if (fs.existsSync(path.join(targetDir, '.git'))) {
        log('[Git] 检测到既有 Git 仓库，正在拉取最新提交 (git pull)...');
        try {
          const out = child_process.execSync('git pull origin main', { cwd: targetDir, encoding: 'utf8', timeout: 30000 });
          log(`[Git Pull 成功] ${out.trim()}`);
          syncSuccess = true;
        } catch (pullErr) {
          log(`[Git Pull 提示] ${pullErr.message}，尝试 git fetch & reset...`);
          try {
            child_process.execSync('git fetch --all && git reset --hard origin/main', { cwd: targetDir, encoding: 'utf8', timeout: 30000 });
            syncSuccess = true;
          } catch (fetchErr) {
            log(`[Git Reset 失败] ${fetchErr.message}`);
          }
        }
      } else {
        log('[Git] 正在克隆全新仓库 (git clone)...');
        try {
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
          const cloneRes = child_process.spawnSync('git', ['clone', repoUrl, targetDir], { encoding: 'utf8', timeout: 60000, windowsHide: true });
          if (cloneRes.status !== 0) throw new Error(cloneRes.stderr || cloneRes.error?.message || 'Git clone failed');
          log('[Git Clone 成功] 远端工作流库克隆完毕！');
          syncSuccess = true;
        } catch (cloneErr) {
          log(`[Git Clone 失败] ${cloneErr.message}`);
        }
      }
    }

    // Strategy 2: Zip archive download fallback
    if (!syncSuccess) {
      log('[Fallback] 切换至 GitHub Zip 归档直连下载模式...');
      const cleanRepo = repoUrl.replace(/\.git$/, '');
      const zipUrl = `${cleanRepo}/archive/refs/heads/main.zip`;
      const tempZip = path.join(this.rootDir, 'temp_workflows.zip');
      try {
        await this._downloadFileWithRedirects(zipUrl, tempZip, 45000);
        log('[Fallback] 归档下载成功，正在解压...');
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        const isWin = process.platform === 'win32';
        const extractTarget = `${targetDir}_extract`;
        if (isWin) {
          child_process.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'Expand-Archive', '-Path', tempZip, '-DestinationPath', extractTarget, '-Force'], { timeout: 30000, windowsHide: true });
        } else {
          child_process.spawnSync('unzip', ['-o', tempZip, '-d', extractTarget], { timeout: 30000 });
        }
        const extractedRoot = path.join(extractTarget, 'comfyui-agent-workflows-main');
        if (fs.existsSync(extractedRoot)) {
          this._copyDirSync(extractedRoot, targetDir);
        }
        try { fs.unlinkSync(tempZip); } catch (_) {}
        try { fs.rmSync(extractTarget, { recursive: true, force: true }); } catch (_) {}
        syncSuccess = true;
        log('[Fallback] Zip 解压并装配成功！');
      } catch (zipErr) {
        log(`[Fallback 失败] ${zipErr.message}`);
      }
    }

    const manifestFile = path.join(targetDir, 'workflows_manifest.json');
    if (!fs.existsSync(manifestFile)) {
      throw new Error(`同步完成但未找到 workflows_manifest.json。日志:\n${logMessages.join('\n')}`);
    }

    this.workflowsDir = targetDir;
    this.reloadManifest();
    const wfCount = Object.keys(this.manifest || {}).length;

    log(`[OK] 同步完成！成功载入 ${wfCount} 套工业级工作流。`);

    return {
      success: true,
      workflowsDir: targetDir,
      workflowsCount: wfCount,
      repoUrl,
      logs: logMessages
    };
  }

  /**
   * Deploy workflows, custom nodes, and launchers to local ComfyUI
   */
  async deployToComfyUI(options = {}) {
    const workflowsDir = options.workflowsDir || this.workflowsDir;
    let targetComfyDir = options.targetComfyDir || this.config.comfyui?.localDir;

    if (!targetComfyDir || !fs.existsSync(path.join(targetComfyDir, 'main.py'))) {
      const detected = this.detectLocalComfyUIDirs();
      if (detected.length > 0) {
        targetComfyDir = detected[0].path;
      }
    }

    if (!targetComfyDir || !fs.existsSync(path.join(targetComfyDir, 'main.py'))) {
      throw new Error('未检测到合法的本地 ComfyUI 根目录 (缺少 main.py)。');
    }

    const logMessages = [];
    const log = (msg) => { logMessages.push(msg); };

    log(`[Deploy] 工作流源目录: ${workflowsDir}`);
    log(`[Deploy] 目标 ComfyUI 目录: ${targetComfyDir}`);

    let copiedWorkflows = 0;

    // 1. Deploy 17 Workflows
    const srcWfDir = path.join(workflowsDir, 'workflows');
    const dstWfDir = path.join(targetComfyDir, 'user', 'default', 'workflows');
    if (fs.existsSync(srcWfDir)) {
      if (!fs.existsSync(dstWfDir)) {
        fs.mkdirSync(dstWfDir, { recursive: true });
      }
      const files = fs.readdirSync(srcWfDir).filter(f => f.endsWith('.json'));
      for (const f of files) {
        fs.copyFileSync(path.join(srcWfDir, f), path.join(dstWfDir, f));
        copiedWorkflows++;
      }
      log(`[Deploy 1/4] 成功部署 ${copiedWorkflows} 套双轨工作流至 ${dstWfDir}`);
    }

    // 2. Deploy custom nodes
    const srcNode = path.join(workflowsDir, 'custom_nodes', 'ComfyUI-NSFW-Interrogator');
    const dstNode = path.join(targetComfyDir, 'custom_nodes', 'ComfyUI-NSFW-Interrogator');
    if (fs.existsSync(srcNode)) {
      this._copyDirSync(srcNode, dstNode);
      log(`[Deploy 2/4] 成功部署自定义节点 ComfyUI-NSFW-Interrogator (含 Gacha 动态词池)`);
    }

    // 3. Deploy launchers
    const srcZluda = path.join(workflowsDir, 'scripts', 'start_zluda_amd.ps1');
    const dstZluda = path.join(targetComfyDir, 'start_zluda_amd.ps1');
    if (fs.existsSync(srcZluda)) {
      fs.copyFileSync(srcZluda, dstZluda);
    }
    const srcCpu = path.join(workflowsDir, 'scripts', 'start_cpu_bg.ps1');
    const dstCpu = path.join(targetComfyDir, 'start_cpu_bg.ps1');
    if (fs.existsSync(srcCpu)) {
      fs.copyFileSync(srcCpu, dstCpu);
    }
    log(`[Deploy 3/4] 成功部署静默后台守护脚本 (start_zluda_amd.ps1 / start_cpu_bg.ps1)`);

    // 4. Apply ZLUDA LayerNorm & Utils Patches
    const isWin = process.platform === 'win32';
    const venvPy = isWin
      ? path.join(targetComfyDir, 'venv', 'Scripts', 'python.exe')
      : path.join(targetComfyDir, 'venv', 'bin', 'python');
    const pyExe = fs.existsSync(venvPy) ? venvPy : (isWin ? 'python.exe' : 'python3');

    const lnPatch = path.join(workflowsDir, 'patches', 'apply_zluda_ln_patch.py');
    if (fs.existsSync(lnPatch)) {
      try {
        child_process.spawnSync(pyExe, [lnPatch, targetComfyDir], { timeout: 10000, stdio: 'ignore', windowsHide: true });
        log(`[Deploy 4/4] ZLUDA LayerNorm 硬件防崩溃补丁已生效`);
      } catch (_) {}
    }
    const utilsPatch = path.join(workflowsDir, 'patches', 'patch_utils.py');
    if (fs.existsSync(utilsPatch)) {
      try {
        child_process.spawnSync(pyExe, [utilsPatch, targetComfyDir], { timeout: 10000, stdio: 'ignore', windowsHide: true });
        log(`[Deploy 4/4] Safe Globals 序列化安全补丁已生效`);
      } catch (_) {}
    }

    log(`[OK] 本地 ComfyUI 全量配置部署完毕！`);

    return {
      success: true,
      targetComfyDir,
      deployedWorkflows: copiedWorkflows,
      logs: logMessages,
      message: `已成功将 ${copiedWorkflows} 套工业级工作流与扩展组件部署至本地 ComfyUI (${targetComfyDir})！`
    };
  }

  /**
   * Launch standalone Edge app window or default browser
   */
  openWebGui(targetUrl = 'http://127.0.0.1:8284') {
    const isWin = process.platform === 'win32';
    if (isWin) {
      try {
        const sub = child_process.spawn('msedge.exe', [`--app=${targetUrl}`], {
          detached: true,
          stdio: 'ignore'
        });
        sub.unref();
        return true;
      } catch (_) {
        child_process.spawn('explorer.exe', [targetUrl], { detached: true, stdio: 'ignore' }).unref();
        return true;
      }
    } else {
      child_process.spawn('xdg-open', [targetUrl], { detached: true, stdio: 'ignore' }).unref();
      return true;
    }
  }

  /**
   * Recursive directory copy helper
   */
  _copyDirSync(src, dst) {
    if (!fs.existsSync(dst)) {
      fs.mkdirSync(dst, { recursive: true });
    }
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);
      if (entry.isDirectory()) {
        this._copyDirSync(srcPath, dstPath);
      } else {
        fs.copyFileSync(srcPath, dstPath);
      }
    }
  }

  /**
   * Download file with HTTP redirect support
   */
  _downloadFileWithRedirects(sourceUrl, destPath, timeoutMs = 60000, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(sourceUrl);
      const mod = parsedUrl.protocol === 'https:' ? https : http;
      const fileStream = fs.createWriteStream(destPath);

      const req = mod.get(sourceUrl, { timeout: timeoutMs, headers: { 'User-Agent': 'OpenCode-Router' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fileStream.close();
          try { fs.unlinkSync(destPath); } catch (_) {}
          if (maxRedirects <= 0) {
            return reject(new Error('Too many redirects while downloading ' + sourceUrl));
          }
          const nextUrl = new URL(res.headers.location, sourceUrl).toString();
          return this._downloadFileWithRedirects(nextUrl, destPath, timeoutMs, maxRedirects - 1)
            .then(resolve)
            .catch(reject);
        }

        if (res.statusCode !== 200) {
          fileStream.close();
          try { fs.unlinkSync(destPath); } catch (_) {}
          return reject(new Error(`Failed to download file, HTTP ${res.statusCode}`));
        }

        res.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close(resolve);
        });
        fileStream.on('error', err => {
          try { fs.unlinkSync(destPath); } catch (_) {}
          reject(err);
        });
      });

      req.on('error', err => {
        fileStream.close();
        try { fs.unlinkSync(destPath); } catch (_) {}
        reject(err);
      });
      req.on('timeout', () => {
        req.destroy();
        fileStream.close();
        try { fs.unlinkSync(destPath); } catch (_) {}
        reject(new Error('Download timed out'));
      });
    });
  }
}

module.exports = {
  ComfyUIAdapter,
  DEFAULT_SNIFF_TARGETS
};
