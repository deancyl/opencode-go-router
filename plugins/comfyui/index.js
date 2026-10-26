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
    const normalizedName = (toolName || '').replace(/^mcp__[a-zA-Z0-9_-]+__/, '');

    if (normalizedName === 'generate_image') {
      const { prompt, workflow, negative, width, height, seed } = args;
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
      const { image_path } = args;
      if (!image_path) {
        return { isError: true, content: [{ type: 'text', text: '错误: 待反推的图片路径或 Base64 数据不能为空。' }] };
      }

      let imgBuf = null;
      if (image_path.startsWith('data:image/') || /^[A-Za-z0-9+/=]+$/.test(image_path.trim())) {
        const b64 = image_path.includes(',') ? image_path.split(',')[1] : image_path;
        imgBuf = Buffer.from(b64, 'base64');
      } else if (fs.existsSync(image_path)) {
        try {
          const stat = fs.statSync(image_path);
          if (!stat.isFile()) {
            return { isError: true, content: [{ type: 'text', text: `错误: 指定路径不是有效的文件: ${image_path}` }] };
          }
          if (stat.size > 20 * 1024 * 1024) {
            return { isError: true, content: [{ type: 'text', text: `错误: 图像文件体积过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB > 20MB)，无法执行反推。` }] };
          }
          imgBuf = fs.readFileSync(image_path);
        } catch (e) {
          return { isError: true, content: [{ type: 'text', text: `错误: 读取文件失败: ${e.message}` }] };
        }
      } else {
        return { isError: true, content: [{ type: 'text', text: `错误: 找不到指定的本地文件: ${image_path}` }] };
      }

      const res = await adapter.interrogateImage(imgBuf);
      if (!res.success) {
        return {
          isError: true,
          content: [{ type: 'text', text: `图片反推失败: ${res.error || '未知异常'}` }]
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
