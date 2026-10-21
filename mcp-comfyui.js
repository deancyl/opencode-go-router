#!/usr/bin/env node
/**
 * ComfyUI MCP (Model Context Protocol) Server (mcp-comfyui.js)
 * ============================================================
 * Provides standard MCP tools (generate_image, interrogate_image) for Codex Desktop,
 * OpenCode, and any MCP-compatible client via Stdio transport.
 * Communicates directly with ComfyUIAdapter and the local opencode-go-router gateway.
 */

'use strict';

const readline = require('readline');
const path = require('path');
const fs = require('fs');
const { ComfyUIAdapter } = require('./comfyui-adapter.js');

const ROUTER_PORT = (() => {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    return cfg.port || 4010;
  } catch (_) {
    return 4010;
  }
})();

const adapter = new ComfyUIAdapter({
  rootDir: __dirname
});

const TOOLS_MANIFEST = [
  {
    name: 'generate_image',
    description: '调用本地或远程 ComfyUI 工业级工作流生成高质量图片。支持真人写实、二次元、国风厚涂、极速抽卡、唯美壁纸等多种风格，成片以 Markdown 格式优雅渲染。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: '画面英文或中文正向提示词 (例如: "1girl, cinematic lighting, 8k uhd, photorealistic, elegant smile")'
        },
        workflow: {
          type: 'string',
          description: '指定工作流编号或风格标签 (例如: "01" 或 "真人写实", "04" 或 "极速抽卡", "06" 或 "二次元吉卜力", "16" 或 "唯美风光壁纸"；留空或 "auto" 则选用最佳画质)'
        },
        negative: {
          type: 'string',
          description: '负向屏蔽词 (可选，工作流已默认内置最优负向过滤词)'
        },
        width: {
          type: 'integer',
          description: '自定义画幅宽度 (可选，默认采用工作流推荐画幅)'
        },
        height: {
          type: 'integer',
          description: '自定义画幅高度 (可选，默认采用工作流推荐画幅)'
        },
        seed: {
          type: 'integer',
          description: '随机种子 (可选，留空则完全随机生成)'
        }
      },
      required: ['prompt']
    }
  },
  {
    name: 'interrogate_image',
    description: '分析反推图片中的提示词、风格与关键特征 (支持本地 ComfyUI WD14 深度反推或网关视觉多模态大模型透明兜底)',
    inputSchema: {
      type: 'object',
      properties: {
        image_path: {
          type: 'string',
          description: '本地图片绝对文件路径或 Base64 编码图片数据'
        }
      },
      required: ['image_path']
    }
  }
];

function sendJson(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handleToolCall(name, args = {}) {
  if (name === 'generate_image') {
    const { prompt, workflow, negative, width, height, seed } = args;
    if (!prompt) {
      return { isError: true, content: [{ type: 'text', text: '错误: 生图提示词 (prompt) 不能为空。' }] };
    }

    try {
      const res = await adapter.executeGeneration({
        prompt,
        workflow: workflow || 'auto',
        negative,
        width,
        height,
        seed
      });

      const imageUrl = `http://127.0.0.1:${ROUTER_PORT}${res.url}`;
      const mdOutput = [
        `![效果图](${imageUrl})`,
        '',
        `> 🎨 **工作流**：${res.workflowName} (${res.workflowId}) | ⏱️ **耗时**：${(res.durationMs / 1000).toFixed(1)}s | 🎲 **Seed**：${res.seed}`,
        `> 📝 **提示词**：\`${res.prompt}\``,
        res.negative ? `> 🚫 **负向词**：\`${res.negative}\`` : '',
        `> 💾 **本地保存**：[${res.filename}](${imageUrl}) (${(res.sizeBytes / 1024).toFixed(1)} KB)`
      ].filter(Boolean).join('\n');

      return {
        isError: false,
        content: [
          { type: 'text', text: mdOutput }
        ]
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `❌ 生图失败: ${err.message}\n提示: 请确认本地 ComfyUI 是否在 8284/8188 运行，或在网关控制台设置中检查连接。`
          }
        ]
      };
    }
  }

  if (name === 'interrogate_image') {
    const { image_path } = args;
    if (!image_path) {
      return { isError: true, content: [{ type: 'text', text: '错误: 图片路径或数据不能为空。' }] };
    }

    try {
      const res = await adapter.interrogateImage(image_path);
      const text = [
        `### 🔍 图片反推提示词结果 (${res.source === 'comfyui_wf03' ? 'ComfyUI WD14 深度反推' : '网关视觉多模态大模型'})`,
        '',
        '```text',
        res.tags,
        '```',
        '',
        '💡 您可以直接复制上方提示词，或调用 `generate_image` 基于此提示词创作新图。'
      ].join('\n');

      return {
        isError: false,
        content: [{ type: 'text', text }]
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `❌ 图片反推失败: ${err.message}` }]
      };
    }
  }

  return {
    isError: true,
    content: [{ type: 'text', text: `未知工具名称: ${name}` }]
  };
}

// Stdio JSON-RPC Listener
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

let buffer = '';

rl.on('line', async line => {
  const trimmed = line.trim();
  if (!trimmed) return;

  // Handle optional Content-Length framing if sent
  if (trimmed.startsWith('Content-Length:')) {
    return;
  }

  try {
    const req = JSON.parse(trimmed);
    if (!req || typeof req !== 'object') return;

    const { id, method, params } = req;

    // 1. Initialize
    if (method === 'initialize') {
      sendJson({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'opencode-go-comfyui-mcp',
            version: '1.0.0'
          }
        }
      });
      return;
    }

    // 2. Notifications/initialized
    if (method === 'notifications/initialized' || method === 'initialized') {
      return; // No response needed for notifications
    }

    // 3. Ping
    if (method === 'ping') {
      sendJson({ jsonrpc: '2.0', id, result: {} });
      return;
    }

    // 4. Tools/list
    if (method === 'tools/list') {
      sendJson({
        jsonrpc: '2.0',
        id,
        result: {
          tools: TOOLS_MANIFEST
        }
      });
      return;
    }

    // 5. Tools/call
    if (method === 'tools/call') {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      const toolResult = await handleToolCall(toolName, toolArgs);
      sendJson({
        jsonrpc: '2.0',
        id,
        result: toolResult
      });
      return;
    }

    // Default unknown method
    if (id !== undefined) {
      sendJson({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`
        }
      });
    }
  } catch (err) {
    // Malformed JSON
  }
});
