/**
 * ComfyUI Plugin Entry Hook (plugins/comfyui/index.js)
 * ====================================================
 * Connects the microkernel plugin system to the ComfyUI adapter.
 * 100% preserves existing adapter behaviors, workflows, and tools.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { ComfyUIAdapter } = require('../../comfyui-adapter.js');

let globalAdapter = null;

function getAdapter(context) {
  if (!globalAdapter) {
    const rootDir = context?.rootDir || path.resolve(__dirname, '..', '..');
    const config = context?.config || {};
    globalAdapter = new ComfyUIAdapter({
      rootDir,
      config
    });
  }
  return globalAdapter;
}

module.exports = {
  getAdapter,

  async init(context) {
    const adapter = getAdapter(context);
    context.logger?.info('[Plugin:ComfyUI] 初始化 ComfyUI 视觉适配中枢');
    return true;
  },

  async probe(context) {
    const adapter = getAdapter(context);
    const sniff = (typeof adapter.detectServer === 'function')
      ? await adapter.detectServer(false)
      : (typeof adapter.sniffActiveServer === 'function' ? await adapter.sniffActiveServer(false) : { isOnline: false });
    const devName = sniff.deviceInfo?.name || (typeof sniff.deviceInfo === 'string' ? sniff.deviceInfo : null);
    return {
      status: sniff.isOnline ? 'healthy' : 'stopped',
      isOnline: !!sniff.isOnline,
      serverUrl: sniff.serverUrl || null,
      deviceInfo: sniff.deviceInfo || null,
      message: sniff.isOnline ? `ComfyUI 活跃在线 (${devName || '就绪'})` : 'ComfyUI 本地服务未运行'
    };
  },

  async executeTool(toolName, args = {}, context) {
    const adapter = getAdapter(context);
    const safeArgs = (args && typeof args === 'object' && !Array.isArray(args)) ? args : {};
    const normalizedName = (toolName || '').replace(/^mcp__[a-zA-Z0-9_-]+__/, '');

    if (normalizedName === 'generate_image') {
      const { prompt, workflow, negative, width, height, seed } = safeArgs;
      if (!prompt) {
        return { isError: true, content: [{ type: 'text', text: '错误: 生图提示词 (prompt) 不能为空。' }] };
      }

      const res = await adapter.executeGeneration({
        prompt,
        workflow,
        negative,
        width,
        height,
        seed
      });

      if (!res.success) {
        return {
          isError: true,
          content: [{ type: 'text', text: `生图任务执行失败: ${res.error || '未知异常'}` }]
        };
      }

      const serverPort = context.routerPort || 4010;
      const imageUrl = res.imageUrl || (res.localFilename ? `http://127.0.0.1:${serverPort}/artifacts/images/${res.localFilename}` : '');
      const markdown = [
        `### 🎨 ComfyUI 工业级生图结果`,
        `- **调度工作流**: \`${res.workflowId || '默认'}\` (${res.workflowTitle || '自适应'})`,
        `- **生成耗时**: \`${res.durationMs || 0} ms\``,
        res.seed !== undefined ? `- **随机种子 (Seed)**: \`${res.seed}\`` : '',
        imageUrl ? `\n![生成的图像](${imageUrl})\n` : '',
        imageUrl ? `> 托管地址: [${imageUrl}](${imageUrl})` : ''
      ].filter(Boolean).join('\n');

      return {
        isError: false,
        content: [{ type: 'text', text: markdown }],
        imageUrl,
        localPath: res.localPath
      };
    }

    if (normalizedName === 'interrogate_image') {
      const image_path = safeArgs.image_path || safeArgs.image;
      if (!image_path) {
        return { isError: true, content: [{ type: 'text', text: '错误: 待反推的图片路径或 Base64 数据不能为空。' }] };
      }

      const rootDir = context.rootDir || path.resolve(__dirname, '..', '..');

      // Check directory defense and file size limits upfront
      if (typeof image_path === 'string' && fs.existsSync(image_path)) {
        try {
          const stat = fs.statSync(image_path);
          if (!stat.isFile()) {
            return { isError: true, content: [{ type: 'text', text: `错误: 指定路径不是有效的文件: ${image_path}` }] };
          }
          if (stat.size > 20 * 1024 * 1024) {
            return { isError: true, content: [{ type: 'text', text: `错误: 图像文件体积过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB > 20MB)，无法执行反推。` }] };
          }
        } catch (e) {
          return { isError: true, content: [{ type: 'text', text: `错误: 读取文件失败: ${e.message}` }] };
        }
      }

      let imgBuf = null;
      if (Buffer.isBuffer(image_path)) {
        imgBuf = image_path;
      } else if (typeof image_path === 'string') {
        const trimmed = image_path.trim();
        // 1. Data URL
        if (trimmed.startsWith('data:image/')) {
          const commaIdx = trimmed.indexOf(',');
          if (commaIdx !== -1) {
            const b64 = trimmed.slice(commaIdx + 1).replace(/\s+/g, '');
            imgBuf = Buffer.from(b64, 'base64');
          }
        }
        // 2. Gateway generated artifact URL (e.g. http://127.0.0.1:4010/artifacts/images/xxx.png or /artifacts/images/xxx.png)
        else if (/(?:https?:\/\/[^\/]+)?\/artifacts\/images\/([a-zA-Z0-9_\-\.]+)/.test(trimmed)) {
          const m = trimmed.match(/(?:https?:\/\/[^\/]+)?\/artifacts\/images\/([a-zA-Z0-9_\-\.]+)/);
          if (m && m[1]) {
            const cleanFilename = path.basename(m[1]);
            const candidatePath = path.join(rootDir, 'artifacts', 'images', cleanFilename);
            if (fs.existsSync(candidatePath)) {
              try {
                const stat = fs.statSync(candidatePath);
                if (stat.isFile()) {
                  imgBuf = fs.readFileSync(candidatePath);
                }
              } catch (_) {}
            }
          }
        }
        // 3. Local file path
        else if (fs.existsSync(trimmed)) {
          try {
            imgBuf = fs.readFileSync(trimmed);
          } catch (e) {
            return { isError: true, content: [{ type: 'text', text: `错误: 读取文件失败: ${e.message}` }] };
          }
        }
        // 4. Raw Base64 string with newline/whitespace tolerance (guarded against short strings)
        else {
          const stripped = trimmed.replace(/\s+/g, '');
          if (stripped.length >= 64 && /^[A-Za-z0-9+/]+=*$/.test(stripped)) {
            try {
              imgBuf = Buffer.from(stripped, 'base64');
            } catch (_) {}
          }
        }
      }

      if (!imgBuf) {
        return { isError: true, content: [{ type: 'text', text: `错误: 找不到指定的本地文件或无法解析的图像数据: ${image_path}` }] };
      }

      let res;
      try {
        res = await adapter.interrogateImage(imgBuf);
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `图片反推失败: ${err.message}` }]
        };
      }
      if (!res || !res.success) {
        return {
          isError: true,
          content: [{ type: 'text', text: `图片反推失败: ${(res && res.error) || '未知异常'}` }]
        };
      }

      const markdown = [
        `### 🔍 图片反推分析结果`,
        `- **信源通道**: \`${res.source === 'comfyui_wf03' ? '本地 ComfyUI WD14 反推工作流' : '网关多模态视觉大模型'}\``,
        `- **核心提示词/标签**: \`${res.tags || '无'}\``,
        res.description ? `- **详细描述**: ${res.description}` : ''
      ].filter(Boolean).join('\n');

      return {
        isError: false,
        content: [{ type: 'text', text: markdown }],
        tags: res.tags
      };
    }

    throw new Error(`ComfyUI 插件不支持工具: "${toolName}"`);
  },

  async startService(mode = 'gpu', context) {
    const adapter = getAdapter(context);
    return await adapter.startService(mode);
  },

  async stopService(context) {
    const adapter = getAdapter(context);
    return await adapter.stopService();
  },

  async restartService(context) {
    const adapter = getAdapter(context);
    return await adapter.restartService();
  },

  async syncWorkflows(repoUrl, context) {
    const adapter = getAdapter(context);
    return await adapter.syncWorkflowsFromGitHub(repoUrl);
  },

  async deployLocal(targetDir, context) {
    const adapter = getAdapter(context);
    return await adapter.deployToComfyUI(targetDir);
  },

  async stop(context) {
    context.logger?.info('[Plugin:ComfyUI] ComfyUI 插件已卸载');
    return true;
  }
};
