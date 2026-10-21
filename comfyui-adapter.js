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

// Default constants
const DEFAULT_SNIFF_TARGETS = [
  'http://127.0.0.1:8284', // ZLUDA / AMD APU default
  'http://127.0.0.1:8188'  // Standard ComfyUI default
];
const SNIFF_CACHE_TTL_MS = 15000; // 15s debounce cache (Rule 7)
const DEFAULT_TASK_TIMEOUT_MS = 180000; // 3 minutes timeout

class ComfyUIAdapter {
  constructor(options = {}) {
    this.config = options.config || {};
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
      path.join(process.env.USERPROFILE || '', '.gemini', 'antigravity', 'scratch', 'comfyui-agent-workflows'),
      path.join(this.rootDir, 'comfyui-workflows'),
      path.join(this.rootDir, '..', 'comfyui-agent-workflows')
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
    if (this.config.comfyui?.host) targets.push(this.config.comfyui.host.replace(/\/+$/, ''));
    if (process.env.COMFYUI_HOST) targets.push(process.env.COMFYUI_HOST.replace(/\/+$/, ''));
    for (const t of DEFAULT_SNIFF_TARGETS) {
      if (!targets.includes(t)) targets.push(t);
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
              name: deviceName,
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
   * Lookup and match workflow by ID, filename prefix, or semantic style tags
   */
  resolveWorkflow(identifierOrQuery) {
    if (!this.manifest) {
      this._loadManifest();
    }
    if (!this.manifest) return null;

    if (!identifierOrQuery || identifierOrQuery === 'auto') {
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

    const raw = fs.readFileSync(apiPath, 'utf8');
    const graph = JSON.parse(raw);

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
    if (wfMeta.sampler_node) {
      const snId = String(wfMeta.sampler_node.id);
      if (graph[snId] && graph[snId].inputs) {
        const sfield = wfMeta.sampler_node.seed_field || 'seed';
        graph[snId].inputs[sfield] = usedSeed;
        if (typeof steps === 'number' && wfMeta.sampler_node.steps_field) {
          graph[snId].inputs[wfMeta.sampler_node.steps_field] = steps;
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

    // 4. Inject Latent Dimensions if requested
    if (width || height) {
      for (const [nid, node] of Object.entries(graph)) {
        if (node.class_type === 'EmptyLatentImage' && node.inputs) {
          if (width) node.inputs.width = width;
          if (height) node.inputs.height = height;
          break;
        }
      }
    }

    return { graph, usedSeed };
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

    const wfMeta = this.resolveWorkflow(reqWf);
    if (!wfMeta) {
      throw new Error(`无法匹配适用的生图工作流: ${reqWf || 'default'}`);
    }

    const { graph, usedSeed } = this.buildExecutionGraph(wfMeta, {
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

    // 2. Poll for completion with Keep-Alive progress callbacks
    const timeoutMs = options.timeoutMs || this.config.comfyui?.timeoutSec * 1000 || DEFAULT_TASK_TIMEOUT_MS;
    let historyEntry = null;
    let pollRounds = 0;

    try {
      while (Date.now() - startTime < timeoutMs) {
        pollRounds++;
        await new Promise(r => setTimeout(r, 1200));

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
      // If error or timeout, attempt interrupt to free GPU VRAM
      this.interrupt(serverUrl).catch(() => {});
      throw err;
    }

    if (!historyEntry) {
      this.interrupt(serverUrl).catch(() => {});
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
      throw new Error('ComfyUI 执行成功但未产出图像文件。');
    }

    // 4. Download image bytes from ComfyUI /view
    const viewUrl = `${serverUrl}/view?filename=${encodeURIComponent(targetImage.filename)}&subfolder=${encodeURIComponent(targetImage.subfolder || '')}&type=${encodeURIComponent(targetImage.type || 'output')}`;
    const imageBuffer = await this._httpGetBuffer(viewUrl);

    // 5. Save to local artifacts directory
    const ext = path.extname(targetImage.filename) || '.png';
    const localFilename = `img_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
    const localFilePath = path.join(this.artifactsDir, localFilename);
    fs.writeFileSync(localFilePath, imageBuffer);

    const elapsedMs = Date.now() - startTime;

    return {
      success: true,
      filename: localFilename,
      localPath: localFilePath,
      url: `/artifacts/images/${localFilename}`,
      base64: imageBuffer.toString('base64'),
      mimeType: ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png',
      workflowName: wfMeta.name,
      workflowId: wfMeta.id,
      seed: usedSeed,
      prompt,
      negative: negative || '',
      durationMs: elapsedMs,
      sizeBytes: imageBuffer.length
    };
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

      const u = new URL(`${serverUrl}/upload/image`);
      const req = http.request({
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

  // HTTP Helper Methods
  _httpGetJson(targetUrl, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const u = new URL(targetUrl);
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
      const u = new URL(targetUrl);
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
      const u = new URL(targetUrl);
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
}

module.exports = {
  ComfyUIAdapter,
  DEFAULT_SNIFF_TARGETS
};
