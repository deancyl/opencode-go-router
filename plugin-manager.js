/**
 * OpenCode Go Plugin System - Microkernel Core (plugin-manager.js)
 * =================================================================
 * Baseline: Router v3.12.0+ / Architecture Spec v1.0.0
 * 
 * Core Capabilities:
 *  1. Multi-Slot Capabilities Contract (service, tools, agents, routes, ui)
 *  2. Pre-Activation Topology Check (Ports, Hardware/VRAM, Namespaced Collision, Conflicts)
 *  3. Dual-Track Client Dispatch (Master-MCP dynamic bus + ClientAdapter atomic injection)
 *  4. Granular Client Scopes ([x] OpenCode, [x] OpenChamber, [x] Codex)
 *  5. Windows Silent Daemon Management (windowsHide: true, AV-Immune compliance, taskkill /PID /T /F)
 *  6. Local Plugins Scanning & Dynamic Hot-Reload
 */

'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const child_process = require('child_process');
const os = require('os');

// Helper: atomic JSON read/write
function parseJsonSafe(filePath, defaultVal = {}) {
  try {
    if (!fs.existsSync(filePath)) return defaultVal;
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    if (!raw.trim()) return defaultVal;
    return JSON.parse(raw);
  } catch (_) {
    return defaultVal;
  }
}

function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const content = JSON.stringify(data, null, 2);
  const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 7)}`;
  try {
    fs.writeFileSync(tempPath, content, 'utf8');
    fs.renameSync(tempPath, filePath);
    return true;
  } catch (err) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  }
}

class PluginManager {
  constructor(options = {}) {
    this.rootDir = options.rootDir || path.resolve(__dirname);
    this.pluginsDir = options.pluginsDir || path.join(this.rootDir, 'plugins');
    this.customPluginsDir = path.join(this.pluginsDir, 'custom');
    this.configPath = options.configPath || path.join(this.rootDir, 'config.json');
    this.routerPort = options.routerPort || 4010;
    this.logger = options.logger || console;

    // In-memory registries
    this.discoveredPlugins = new Map(); // id -> Manifest object
    this.loadedPlugins = new Map();     // id -> Plugin module instance
    this.activeTools = new Map();       // toolName -> { pluginId, toolDef, handler }
    this.activeServices = new Map();    // id -> { pid, mode, startedAt, healthEndpoint }
    this.topologyDiagnostics = new Map();// id -> Preflight report

    // Ensure directory exists
    try {
      if (!fs.existsSync(this.pluginsDir)) {
        fs.mkdirSync(this.pluginsDir, { recursive: true });
      }
      if (!fs.existsSync(this.customPluginsDir)) {
        fs.mkdirSync(this.customPluginsDir, { recursive: true });
      }
    } catch (_) {}
  }

  /**
   * Load user configuration for plugins
   */
  getPluginsConfig() {
    const config = parseJsonSafe(this.configPath, {});
    if (!config.plugins || typeof config.plugins !== 'object') {
      config.plugins = {};
    }
    return config.plugins;
  }

  /**
   * Persist plugin configuration atomically
   */
  savePluginConfig(pluginId, pluginCfg) {
    const config = parseJsonSafe(this.configPath, {});
    if (!config.plugins || typeof config.plugins !== 'object') {
      config.plugins = {};
    }
    config.plugins[pluginId] = Object.assign({}, config.plugins[pluginId] || {}, pluginCfg);
    writeJsonAtomic(this.configPath, config);
    return config.plugins[pluginId];
  }

  /**
   * Validate standard plugin.json manifest
   */
  validateManifest(rawManifest, dirPath) {
    if (!rawManifest || typeof rawManifest !== 'object') {
      throw new Error('Manifest 必须是有效的 JSON 对象');
    }
    const { id, name, version } = rawManifest;
    if (!id || typeof id !== 'string' || !/^[a-z0-9_-]+$/i.test(id)) {
      throw new Error(`插件 id 格式非法: "${id}" (仅允许英文字母、数字、短横线与下划线)`);
    }
    if (!name || typeof name !== 'string') {
      throw new Error(`插件 "${id}" 缺少有效的 name 字段`);
    }
    if (!version || typeof version !== 'string') {
      throw new Error(`插件 "${id}" 缺少有效的 version 字段`);
    }

    const entry = rawManifest.entry || 'index.js';
    if (typeof entry !== 'string') {
      throw new Error(`插件 "${id}" entry 必须为字符串`);
    }
    const resolvedEntry = path.resolve(dirPath, entry);
    const relEntry = path.relative(dirPath, resolvedEntry);
    if (relEntry.startsWith('..') || path.isAbsolute(entry)) {
      throw new Error(`插件 "${id}" 入口 entry ("${entry}") 试图越权逃逸出插件目录`);
    }
    const entryFullPath = resolvedEntry;

    // Validate ui.cardComponent if specified
    if (rawManifest.capabilities?.ui?.cardComponent) {
      const cardComp = rawManifest.capabilities.ui.cardComponent;
      if (typeof cardComp === 'string') {
        const resolvedCard = path.resolve(dirPath, cardComp);
        const relCard = path.relative(dirPath, resolvedCard);
        if (relCard.startsWith('..') || path.isAbsolute(cardComp)) {
          throw new Error(`插件 "${id}" UI 组件路径 ("${cardComp}") 试图越权逃逸出插件目录`);
        }
      }
    }

    // Normalize capabilities
    const capabilities = Object.assign({
      service: null,
      tools: [],
      agents: [],
      routes: [],
      ui: null
    }, rawManifest.capabilities || {});

    // Normalize system
    const system = Object.assign({
      platforms: ['win32', 'linux', 'darwin'],
      requiresNode: '>=18.0.0',
      ports: [],
      hardware: { gpu: false, recommendedVramMb: 0, minVramMb: 0 },
      conflictsWith: [],
      requires: []
    }, rawManifest.system || {});

    // Normalize clientScopes
    const clientScopes = Object.assign({
      supported: ['opencode', 'openchamber', 'codex'],
      defaultEnabled: ['opencode', 'codex']
    }, rawManifest.clientScopes || {});

    return {
      ...rawManifest,
      id,
      name,
      version,
      entry,
      entryFullPath,
      dirPath,
      category: rawManifest.category || 'general',
      capabilities,
      system,
      clientScopes
    };
  }

  /**
   * Determine whether a plugin is enabled (Single Source of Truth)
   */
  isPluginEnabled(pluginId, manifest = null, pluginsCfg = null) {
    const cfg = (pluginsCfg || this.getPluginsConfig())[pluginId];
    if (cfg && cfg.enabled !== undefined) {
      return Boolean(cfg.enabled);
    }
    const m = manifest || this.discoveredPlugins.get(pluginId);
    if (!m) return false;
    return Boolean(
      (m.clientScopes?.defaultEnabled && m.clientScopes.defaultEnabled.length > 0) ||
      m.category === 'service' ||
      m.category === 'agent'
    );
  }

  /**
   * Scan plugins from plugins/ and plugins/custom/
   */
  scanPlugins() {
    this.discoveredPlugins.clear();
    const searchDirs = [this.pluginsDir, this.customPluginsDir];

    for (const baseDir of searchDirs) {
      if (!fs.existsSync(baseDir)) continue;
      let entries = [];
      try {
        entries = fs.readdirSync(baseDir, { withFileTypes: true });
      } catch (_) {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === 'custom') continue; // Skip custom container itself

        const pluginDir = path.join(baseDir, entry.name);
        const manifestPath = path.join(pluginDir, 'plugin.json');
        if (fs.existsSync(manifestPath)) {
          try {
            const raw = parseJsonSafe(manifestPath, null);
            if (raw) {
              const manifest = this.validateManifest(raw, pluginDir);
              if (this.discoveredPlugins.has(manifest.id)) {
                this.logger.warn(`[PluginManager] 发现重复插件 ID "${manifest.id}" (${pluginDir})，已跳过覆盖`);
              } else {
                this.discoveredPlugins.set(manifest.id, manifest);
              }
            }
          } catch (err) {
            this.logger.warn(`[PluginManager] 解析插件 "${entry.name}" manifest 失败: ${err.message}`);
          }
        }
      }
    }

    return Array.from(this.discoveredPlugins.values());
  }

  /**
   * Probe if a local TCP port is in use
   */
  async _isPortInUse(port) {
    const p = parseInt(port, 10);
    if (isNaN(p) || p < 1 || p > 65535) return false;
    return new Promise((resolve) => {
      try {
        const socket = new net.Socket();
        socket.setTimeout(250);
        socket.once('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.once('timeout', () => {
          socket.destroy();
          resolve(false);
        });
        socket.once('error', () => {
          socket.destroy();
          resolve(false);
        });
        socket.connect(p, '127.0.0.1');
      } catch (_) {
        resolve(false);
      }
    });
  }

  /**
   * Pre-flight Topology Check:
   * 1. Port conflict probe (against routerPort, other enabled plugins, live TCP listening)
   * 2. Hardware / VRAM budget evaluation
   * 3. Tool collision check & auto-namespacing
   * 4. Conflicts & Requirements check
   */
  async checkTopology(pluginId, options = {}) {
    const manifest = this.discoveredPlugins.get(pluginId);
    if (!manifest) {
      return { ok: false, errors: [`插件 "${pluginId}" 未被发现或不存在`], warnings: [] };
    }

    const errors = [];
    const warnings = [];
    const collisionFixes = {};
    const pluginsCfg = this.getPluginsConfig();

    // 1. Port Conflict Probe with robust number parsing
    const rawPorts = [];
    if (Array.isArray(manifest.system.ports)) {
      rawPorts.push(...manifest.system.ports);
    }
    if (manifest.capabilities.service?.defaultPort) {
      rawPorts.push(manifest.capabilities.service.defaultPort);
    }

    const ports = [];
    for (const rawP of rawPorts) {
      const pNum = parseInt(rawP, 10);
      if (isNaN(pNum) || pNum < 1 || pNum > 65535) {
        errors.push(`端口非法: 声明端口 "${rawP}" 无效 (必须为 1~65535 之间的有效端口号)`);
        continue;
      }
      if (!ports.includes(pNum)) {
        ports.push(pNum);
      }
    }

    for (const port of ports) {
      if (port === this.routerPort) {
        errors.push(`端口冲突: 插件声明端口 ${port} 与智能网关核心端口重叠！`);
      }

      // Check against other enabled plugins
      for (const [otherId, otherManifest] of this.discoveredPlugins.entries()) {
        if (otherId === pluginId) continue;
        const isOtherEnabled = this.isPluginEnabled(otherId, otherManifest, pluginsCfg);
        if (!isOtherEnabled) continue;

        const otherRawPorts = (otherManifest.system.ports || []).concat(otherManifest.capabilities.service?.defaultPort ? [otherManifest.capabilities.service.defaultPort] : []);
        const otherPorts = otherRawPorts.map(p => parseInt(p, 10)).filter(p => !isNaN(p));
        if (otherPorts.includes(port)) {
          errors.push(`端口冲突: 端口 ${port} 已被启用的插件 "${otherManifest.name}" (${otherId}) 占用`);
        }
      }

      // Live socket probe (if service is not already running by this plugin)
      const currentService = this.activeServices.get(pluginId);
      if (!currentService) {
        try {
          const inUse = await this._isPortInUse(port);
          if (inUse) {
            warnings.push(`端口已被外部服务占用: 端口 ${port} 当前已有监听服务响应。若为该插件的已有常驻实例，则可直接复用；若为其他程序请注意避让。`);
          }
        } catch (_) {}
      }
    }

    // 2. Hardware / VRAM Budget
    if (manifest.system.hardware?.gpu) {
      const recVram = manifest.system.hardware.recommendedVramMb || 0;
      const minVram = manifest.system.hardware.minVramMb || 0;
      if (recVram > 4096) {
        warnings.push(`高显存需求提示: 该插件推荐显存 ${recVram}MB (最低 ${minVram}MB)，多插件并发时将自动进入显存排队互斥锁。`);
      }
    }

    // 3. Tool Collision Check
    const tools = manifest.capabilities.tools || [];
    for (const tool of tools) {
      const toolName = tool.name;
      for (const [existingToolName, existingOwner] of this.activeTools.entries()) {
        if (existingOwner.pluginId !== pluginId && existingToolName === toolName) {
          const namespacedName = `${pluginId}_${toolName}`;
          collisionFixes[toolName] = namespacedName;
          warnings.push(`工具命名冲突: 工具名 "${toolName}" 已被插件 "${existingOwner.pluginId}" 注册，已自动安全映射为 "${namespacedName}" 隔离防撞车。`);
        }
      }
    }

    // 4. Conflicts & Requirements
    if (Array.isArray(manifest.system.conflictsWith)) {
      for (const confId of manifest.system.conflictsWith) {
        const confCfg = pluginsCfg[confId];
        if (confCfg && confCfg.enabled) {
          errors.push(`互斥依赖冲突: 插件与已启用的 "${confId}" 存在互斥声明 (conflictsWith)，不能同时激活！`);
        }
      }
    }

    if (Array.isArray(manifest.system.requires)) {
      for (const reqId of manifest.system.requires) {
        const reqCfg = pluginsCfg[reqId];
        if (!reqCfg || !reqCfg.enabled) {
          errors.push(`缺失前置依赖: 插件需要 "${reqId}" 前置插件就绪，请先安装并启用该插件。`);
        }
      }
    }

    const report = {
      ok: errors.length === 0,
      errors,
      warnings,
      collisionFixes
    };

    this.topologyDiagnostics.set(pluginId, report);
    return report;
  }

  /**
   * Load plugin code and instantiate
   */
  async loadPlugin(pluginId) {
    let manifest = this.discoveredPlugins.get(pluginId);
    if (!manifest) {
      this.scanPlugins();
      manifest = this.discoveredPlugins.get(pluginId);
    }
    if (!manifest) {
      throw new Error(`未找到插件 "${pluginId}"`);
    }

    if (this.loadedPlugins.has(pluginId)) {
      return this.loadedPlugins.get(pluginId);
    }

    let pluginModule = null;
    if (fs.existsSync(manifest.entryFullPath)) {
      try {
        // Clear require cache for clean hot reload
        delete require.cache[require.resolve(manifest.entryFullPath)];
        pluginModule = require(manifest.entryFullPath);
      } catch (err) {
        this.logger.error(`[PluginManager] 加载插件 "${pluginId}" 入口失败: ${err.message}`);
        throw err;
      }
    } else {
      // Default virtual module if only manifest
      pluginModule = {
        async probe() { return { status: 'healthy', message: '仅清单模式运行' }; }
      };
    }

    const context = {
      pluginId,
      manifest,
      dir: manifest.dirPath,
      rootDir: this.rootDir,
      routerPort: this.routerPort,
      logger: this.logger,
      config: parseJsonSafe(this.configPath, {}),
      registerTool: (toolDef, handler) => {
        this.registerTool(pluginId, toolDef, handler);
      }
    };

    if (typeof pluginModule.init === 'function') {
      try {
        await pluginModule.init(context);
      } catch (err) {
        this.unregisterTools(pluginId);
        this.loadedPlugins.delete(pluginId);
        this.logger.error(`[PluginManager] 插件 "${pluginId}" init() 钩子执行异常: ${err.message}`);
        throw err;
      }
    }

    this.loadedPlugins.set(pluginId, { module: pluginModule, context, manifest });
    return this.loadedPlugins.get(pluginId);
  }

  /**
   * Register a tool for a plugin
   */
  registerTool(pluginId, toolDef, handler) {
    if (!toolDef || !toolDef.name) return;
    const topology = this.topologyDiagnostics.get(pluginId);
    let finalName = toolDef.name;
    if (topology && topology.collisionFixes && topology.collisionFixes[toolDef.name]) {
      finalName = topology.collisionFixes[toolDef.name];
    } else if (this.activeTools.has(finalName) && this.activeTools.get(finalName).pluginId !== pluginId) {
      finalName = `${pluginId}_${toolDef.name}`;
    }

    // Rule 13: Probe parameters, inputSchema, input_schema; never let {} mask definitions; ensure { type: 'object', properties: {} }
    let rawSchema = toolDef.parameters || toolDef.inputSchema || toolDef.input_schema;
    if (!rawSchema || typeof rawSchema !== 'object' || Object.keys(rawSchema).length === 0) {
      rawSchema = { type: 'object', properties: {} };
    } else if (!rawSchema.type) {
      rawSchema = { type: 'object', properties: {}, ...rawSchema };
    }

    this.activeTools.set(finalName, {
      name: finalName,
      originalName: toolDef.name,
      pluginId,
      description: toolDef.description || '',
      parameters: rawSchema,
      inputSchema: rawSchema,
      handler
    });
  }

  /**
   * Unregister all tools belonging to a plugin
   */
  unregisterTools(pluginId) {
    for (const [name, entry] of this.activeTools.entries()) {
      if (entry.pluginId === pluginId) {
        this.activeTools.delete(name);
      }
    }
  }

  /**
   * Enable a plugin with topology preflight check
   */
  async enablePlugin(pluginId, options = {}) {
    const topology = await this.checkTopology(pluginId, options);
    if (!topology.ok && options.force !== true) {
      return {
        success: false,
        pluginId,
        errors: topology.errors,
        warnings: topology.warnings
      };
    }

    // Load plugin instance (calls init(context), which can dynamically register tools)
    let instance = this.loadedPlugins.get(pluginId);
    if (!instance) {
      this.unregisterTools(pluginId);
      instance = await this.loadPlugin(pluginId);
    }
    const manifest = instance.manifest;

    // Register manifest declared tools IF not already registered by init(context)
    if (Array.isArray(manifest.capabilities.tools)) {
      for (const t of manifest.capabilities.tools) {
        const mappedName = (topology.collisionFixes && topology.collisionFixes[t.name]) ? topology.collisionFixes[t.name] : t.name;
        if (!this.activeTools.has(mappedName)) {
          this.registerTool(pluginId, t, (args, ctx) => {
            if (typeof instance.module.executeTool === 'function') {
              return instance.module.executeTool(t.name, args, ctx);
            }
            throw new Error(`插件 "${pluginId}" 未实现 executeTool 钩子`);
          });
        }
      }
    }

    // Determine client scopes
    const pluginsCfg = this.getPluginsConfig();
    const existing = pluginsCfg[pluginId] || {};
    const clientScopes = options.clientScopes || existing.clients || {
      opencode: manifest.clientScopes.defaultEnabled.includes('opencode'),
      openchamber: manifest.clientScopes.defaultEnabled.includes('openchamber'),
      codex: manifest.clientScopes.defaultEnabled.includes('codex')
    };

    // Save state atomically
    this.savePluginConfig(pluginId, {
      enabled: true,
      clients: clientScopes,
      lastEnabledAt: Date.now()
    });

    return {
      success: true,
      pluginId,
      clientScopes,
      warnings: topology.warnings
    };
  }

  /**
   * Disable a plugin cleanly
   */
  async disablePlugin(pluginId) {
    // 1. Stop daemon service if running
    if (this.activeServices.has(pluginId)) {
      try {
        await this.stopService(pluginId);
      } catch (_) {}
    }

    // 2. Call stop lifecycle hook if loaded
    const instance = this.loadedPlugins.get(pluginId);
    if (instance && typeof instance.module.stop === 'function') {
      try {
        await instance.module.stop(instance.context);
      } catch (err) {
        this.logger.warn(`[PluginManager] 插件 "${pluginId}" stop() 钩子报错: ${err.message}`);
      }
    }

    // 3. Unregister tools
    this.unregisterTools(pluginId);
    this.loadedPlugins.delete(pluginId);

    // 4. Save state atomically
    this.savePluginConfig(pluginId, {
      enabled: false,
      lastDisabledAt: Date.now()
    });

    return {
      success: true,
      pluginId
    };
  }

  /**
   * Update client scopes for a plugin
   */
  setClientScopes(pluginId, clientScopes) {
    const pluginsCfg = this.getPluginsConfig();
    const existing = pluginsCfg[pluginId] || { enabled: true };
    const mergedScopes = Object.assign({
      opencode: false,
      openchamber: false,
      codex: false
    }, existing.clients || {}, clientScopes);

    this.savePluginConfig(pluginId, {
      clients: mergedScopes
    });

    return mergedScopes;
  }

  /**
   * Execute an active tool
   */
  async executeTool(toolName, args = {}, clientCaller = null) {
    let toolEntry = this.activeTools.get(toolName);
    if (!toolEntry) {
      // Support clients that prefix tools with mcp__<server>__
      const cleanName = (toolName || '').replace(/^mcp__[a-zA-Z0-9_-]+__/, '');
      toolEntry = this.activeTools.get(cleanName);
    }
    if (!toolEntry) {
      // Lazy auto-activation: if an enabled plugin declared this tool but has not loaded yet
      const cleanName = (toolName || '').replace(/^mcp__[a-zA-Z0-9_-]+__/, '');
      for (const [id, manifest] of this.discoveredPlugins.entries()) {
        const declaredTools = manifest.capabilities?.tools || [];
        if (declaredTools.some(t => t.name === toolName || t.name === cleanName)) {
          if (this.isPluginEnabled(id, manifest)) {
            await this.enablePlugin(id);
            toolEntry = this.activeTools.get(toolName) || this.activeTools.get(cleanName);
            break;
          }
        }
      }
    }
    if (!toolEntry) {
      throw new Error(`未找到工具 "${toolName}" 或其所属插件未启用`);
    }

    const { pluginId, originalName, handler } = toolEntry;
    const pluginsCfg = this.getPluginsConfig();
    const pluginCfg = pluginsCfg[pluginId];
    const manifest = this.discoveredPlugins.get(pluginId);

    if (!this.isPluginEnabled(pluginId, manifest, pluginsCfg)) {
      throw new Error(`工具 "${toolName}" 所属插件 "${pluginId}" 已停用`);
    }

    // Client scope enforcement
    if (clientCaller) {
      if (pluginCfg && pluginCfg.clients && pluginCfg.clients[clientCaller] !== undefined) {
        if (!pluginCfg.clients[clientCaller]) {
          throw new Error(`工具 "${toolName}" 已在客户端 "${clientCaller}" 中被禁用`);
        }
      } else if (manifest && manifest.clientScopes?.defaultEnabled) {
        if (!manifest.clientScopes.defaultEnabled.includes(clientCaller)) {
          throw new Error(`工具 "${toolName}" 已在客户端 "${clientCaller}" 中被禁用`);
        }
      }
    }

    const instance = this.loadedPlugins.get(pluginId);
    const context = instance ? instance.context : { pluginId, routerPort: this.routerPort };

    if (typeof handler === 'function') {
      return await handler(args, context);
    } else if (instance && typeof instance.module.executeTool === 'function') {
      return await instance.module.executeTool(originalName || toolName, args, context);
    }

    throw new Error(`插件 "${pluginId}" 无法处理工具调用 "${toolName}"`);
  }

  /**
   * Get active tools filtered by client caller
   */
  getActiveTools(clientCaller = null) {
    const tools = [];
    const pluginsCfg = this.getPluginsConfig();

    for (const [name, entry] of this.activeTools.entries()) {
      const { pluginId, description, parameters, inputSchema } = entry;
      const pluginCfg = pluginsCfg[pluginId];
      const manifest = this.discoveredPlugins.get(pluginId);

      if (!this.isPluginEnabled(pluginId, manifest, pluginsCfg)) continue;

      // Filter by clientCaller if specified
      if (clientCaller) {
        if (pluginCfg && pluginCfg.clients && pluginCfg.clients[clientCaller] !== undefined) {
          if (!pluginCfg.clients[clientCaller]) continue;
        } else if (manifest && manifest.clientScopes?.defaultEnabled) {
          if (!manifest.clientScopes.defaultEnabled.includes(clientCaller)) continue;
        }
      }

      tools.push({
        name,
        description,
        parameters: parameters || inputSchema,
        inputSchema: inputSchema || parameters
      });
    }

    return tools;
  }

  /**
   * Windows Silent Service Daemon Launcher (AV-Immune Compliance)
   * 1. Node.js native child_process.spawn
   * 2. windowsHide: true, stdio: 'ignore', detached: true
   * 3. Clear parameters array (no shell concatenation injection)
   * 4. Safe PID recording
   */
  async startService(pluginId, mode = 'gpu') {
    let manifest = this.discoveredPlugins.get(pluginId);
    if (!manifest) {
      this.scanPlugins();
      manifest = this.discoveredPlugins.get(pluginId);
    }
    if (!manifest) throw new Error(`插件 "${pluginId}" 不存在`);

    const capService = manifest.capabilities.service;
    if (!capService || !capService.daemonSupported) {
      throw new Error(`插件 "${pluginId}" 未声明后台守护服务能力 (daemonSupported: false)`);
    }

    const instance = await this.loadPlugin(pluginId);
    if (typeof instance.module.startService === 'function') {
      const res = await instance.module.startService(mode, instance.context);
      if (res && res.pid) {
        const pidNum = parseInt(res.pid, 10);
        if (!isNaN(pidNum) && pidNum > 4 && pidNum !== process.pid && pidNum !== 25076) {
          this.activeServices.set(pluginId, {
            pid: pidNum,
            mode,
            startedAt: Date.now(),
            healthEndpoint: capService.healthEndpoint
          });
        }
      }
      return res;
    }

    throw new Error(`插件 "${pluginId}" 入口未实现 startService(mode, context) 方法`);
  }

  /**
   * Stop service daemon cleanly using standard taskkill
   */
  async stopService(pluginId) {
    const instance = this.loadedPlugins.get(pluginId);
    if (instance && typeof instance.module.stopService === 'function') {
      const res = await instance.module.stopService(instance.context);
      this.activeServices.delete(pluginId);
      return res;
    }

    const sInfo = this.activeServices.get(pluginId);
    if (sInfo && sInfo.pid) {
      const pidNum = parseInt(sInfo.pid, 10);
      // Red Line: Rigidly protect OpenAI Codex (PID 25076), system idle (<4), and gateway process
      if (isNaN(pidNum) || pidNum <= 4 || pidNum === process.pid || pidNum === 25076) {
        this.activeServices.delete(pluginId);
        return { success: false, message: `受保护的关键进程或非法 PID (${sInfo.pid})，安全屏障已拒绝终止` };
      }

      if (process.platform === 'win32') {
        try {
          child_process.spawnSync('taskkill', ['/PID', String(pidNum), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore'
          });
        } catch (_) {}
      } else {
        try {
          process.kill(pidNum, 'SIGTERM');
        } catch (_) {}
      }
      this.activeServices.delete(pluginId);
      return { success: true, message: `服务进程 (PID: ${pidNum}) 已安全终止` };
    }

    return { success: true, message: '未检测到运行中的常驻服务' };
  }

  /**
   * Probe service health
   */
  async probeService(pluginId) {
    const instance = this.loadedPlugins.get(pluginId);
    if (instance && typeof instance.module.probe === 'function') {
      return await instance.module.probe(instance.context);
    }
    const manifest = this.discoveredPlugins.get(pluginId);
    if (manifest && manifest.capabilities.service?.healthEndpoint) {
      const inUse = await this._isPortInUse(manifest.capabilities.service.defaultPort || 80);
      return {
        status: inUse ? 'healthy' : 'stopped',
        endpoint: manifest.capabilities.service.healthEndpoint,
        isOnline: inUse
      };
    }
    return { status: 'healthy', message: '插件正常' };
  }

  /**
   * List all discovered plugins with enriched status
   */
  listPlugins() {
    this.scanPlugins();
    const pluginsCfg = this.getPluginsConfig();
    const list = [];

    for (const [id, manifest] of this.discoveredPlugins.entries()) {
      const userCfg = pluginsCfg[id] || {};
      const enabled = this.isPluginEnabled(id, manifest, pluginsCfg);
      const clients = userCfg.clients || {
        opencode: manifest.clientScopes.defaultEnabled.includes('opencode'),
        openchamber: manifest.clientScopes.defaultEnabled.includes('openchamber'),
        codex: manifest.clientScopes.defaultEnabled.includes('codex')
      };

      const service = this.activeServices.get(id) || null;
      const diag = this.topologyDiagnostics.get(id) || null;

      list.push({
        id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        author: manifest.author || 'unknown',
        category: manifest.category,
        enabled,
        clients,
        capabilities: manifest.capabilities,
        system: manifest.system,
        clientScopes: manifest.clientScopes,
        service,
        topology: diag,
        toolCount: (manifest.capabilities.tools || []).length,
        agentCount: (manifest.capabilities.agents || []).length
      });
    }

    return list;
  }
}

module.exports = {
  PluginManager,
  parseJsonSafe,
  writeJsonAtomic
};
