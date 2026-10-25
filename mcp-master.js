#!/usr/bin/env node
/**
 * Master-MCP Unified Tool Bus (mcp-master.js)
 * ==============================================================
 * Baseline: Router v3.12.0+ / Architecture Spec v1.0.0
 * 
 * Aggregates all active tools from enabled plugins into a single,
 * zero-reload, zero-reconfiguration MCP endpoint for AI clients:
 *  - OpenAI Codex Desktop & CLI
 *  - OpenCode 2.0 CLI
 *  - OpenChamber Desktop
 * 
 * Protocol: Standard Model Context Protocol (MCP) JSON-RPC 2.0 over Stdio
 */

'use strict';

const readline = require('readline');
const path = require('path');
const fs = require('fs');
const { PluginManager } = require('./plugin-manager.js');

const ROOT_DIR = __dirname;
const LOG_PATH = path.join(ROOT_DIR, 'mcp-master.log');

// Determine client caller from process environment or command line args
const CLIENT_CALLER = (() => {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--client=')) return arg.slice(9).trim();
  }
  return process.env.MCP_CLIENT_CALLER || process.env.CLIENT_SCOPE || null;
})();

function logMasterMcp(level, msg, data = null) {
  try {
    const logLine = `[${new Date().toISOString()}] [${level}] ${msg}${data ? ' ' + (typeof data === 'string' ? data : JSON.stringify(data)) : ''}\n`;
    fs.appendFileSync(LOG_PATH, logLine, 'utf8');
  } catch (_) {}
}

const pluginManager = new PluginManager({
  rootDir: ROOT_DIR,
  logger: {
    info: (m) => logMasterMcp('INFO', m),
    warn: (m) => logMasterMcp('WARN', m),
    error: (m) => logMasterMcp('ERROR', m)
  }
});

let isInitialized = false;

async function bootstrap() {
  if (isInitialized) return;
  try {
    pluginManager.scanPlugins();
    const pluginsCfg = pluginManager.getPluginsConfig();

    for (const [id, manifest] of pluginManager.discoveredPlugins.entries()) {
      const pCfg = pluginsCfg[id];
      const shouldEnable = pCfg ? pCfg.enabled !== false : (manifest.clientScopes?.defaultEnabled?.length > 0);
      if (shouldEnable) {
        try {
          await pluginManager.enablePlugin(id);
        } catch (e) {
          logMasterMcp('WARN', `启用插件 "${id}" 预检或加载失败: ${e.message}`);
        }
      }
    }
    isInitialized = true;
    logMasterMcp('INFO', `Master-MCP 已就绪，激活工具数: ${pluginManager.activeTools.size}`);
  } catch (err) {
    logMasterMcp('ERROR', `Master-MCP 初始化失败: ${err.message}`);
  }
}

function sendJson(msg) {
  try {
    process.stdout.write(JSON.stringify(msg) + '\n');
  } catch (err) {
    if (err && err.code === 'EPIPE') process.exit(0);
  }
}

async function handleRpcRequest(req) {
  if (!req || typeof req !== 'object' || Array.isArray(req)) {
    return sendJson({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error: invalid JSON payload' }
    });
  }

  const { id, method, params } = req;

  // Validate method presence (JSON-RPC 2.0 requires method)
  if (!method || typeof method !== 'string') {
    return sendJson({
      jsonrpc: '2.0',
      id: id || null,
      error: { code: -32600, message: 'Invalid Request: method is required' }
    });
  }

  // Silently ignore notifications
  if (id === undefined || id === null) {
    if (method === 'notifications/initialized') {
      logMasterMcp('INFO', 'Client sent notifications/initialized');
    }
    return;
  }

  await bootstrap();

  switch (method) {
    case 'initialize': {
      logMasterMcp('INFO', 'Handshake: initialize', params);
      return sendJson({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: true }
          },
          serverInfo: {
            name: 'opencode-go-master-mcp',
            version: '3.13.0'
          }
        }
      });
    }

    case 'ping': {
      return sendJson({
        jsonrpc: '2.0',
        id,
        result: {}
      });
    }

    case 'tools/list': {
      const tools = pluginManager.getActiveTools(CLIENT_CALLER);
      logMasterMcp('INFO', `tools/list returning ${tools.length} tools for client=${CLIENT_CALLER || 'all'}`);
      return sendJson({
        jsonrpc: '2.0',
        id,
        result: {
          tools
        }
      });
    }

    case 'tools/call': {
      const toolName = params?.name;
      let toolArgs = params?.arguments || {};
      if (typeof toolArgs === 'string') {
        try {
          toolArgs = JSON.parse(toolArgs);
        } catch (_) {}
      }
      if (!toolArgs || typeof toolArgs !== 'object') {
        toolArgs = {};
      }
      logMasterMcp('INFO', `tools/call requested: "${toolName}"`, toolArgs);

      if (!toolName) {
        return sendJson({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Invalid params: tool name is required' }
        });
      }

      try {
        const rawRes = await pluginManager.executeTool(toolName, toolArgs, CLIENT_CALLER);
        // Normalize result to MCP content structure
        let content = [];
        let isError = false;

        if (rawRes && typeof rawRes === 'object') {
          if (Array.isArray(rawRes.content)) {
            content = rawRes.content;
            isError = !!rawRes.isError;
          } else if (rawRes.text) {
            content = [{ type: 'text', text: String(rawRes.text) }];
            isError = !!rawRes.isError;
          } else {
            content = [{ type: 'text', text: JSON.stringify(rawRes, null, 2) }];
          }
        } else {
          content = [{ type: 'text', text: String(rawRes) }];
        }

        return sendJson({
          jsonrpc: '2.0',
          id,
          result: {
            content,
            isError
          }
        });
      } catch (err) {
        logMasterMcp('ERROR', `tools/call failed for "${toolName}": ${err.message}`);
        return sendJson({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `执行工具 "${toolName}" 发生异常: ${err.message}` }],
            isError: true
          }
        });
      }
    }

    default: {
      logMasterMcp('WARN', `Unknown method received: "${method}"`);
      return sendJson({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` }
      });
    }
  }
}

// Start stdio interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const req = JSON.parse(trimmed);
    handleRpcRequest(req).catch((err) => {
      logMasterMcp('ERROR', `Unhandled RPC rejection: ${err.message}`);
    });
  } catch (err) {
    sendJson({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: `Parse error: ${err.message}` }
    });
  }
});

process.stdout.on('error', (err) => {
  if (err && err.code === 'EPIPE') {
    process.exit(0);
  }
});

process.on('uncaughtException', (err) => {
  if (err && err.code === 'EPIPE') process.exit(0);
  logMasterMcp('FATAL', `Uncaught exception in mcp-master: ${err.message}`, err.stack);
});

process.on('unhandledRejection', (reason) => {
  logMasterMcp('FATAL', `Unhandled rejection in mcp-master: ${reason}`);
});

module.exports = {
  bootstrap,
  handleRpcRequest,
  pluginManager
};
