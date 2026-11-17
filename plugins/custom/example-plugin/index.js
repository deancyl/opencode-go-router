/**
 * Example Greeter Plugin Entry Hook (plugins/custom/example-plugin/index.js)
 * =========================================================================
 * Reference implementation for third-party plugin developers.
 */

'use strict';

module.exports = {
  async init(context) {
    context.logger?.info('[Plugin:ExampleGreeter] 示例问候插件已初始化');
  },

  async probe(context) {
    return {
      status: 'healthy',
      message: '示例问候插件就绪，运行良好',
      routerPort: context.routerPort
    };
  },

  async executeTool(toolName, args = {}, context) {
    if (toolName === 'greet_developer') {
      const name = args.name || '开发者';
      const greeting = [
        `### 👋 你好，${name}！欢迎接入 OpenCode 外挂与扩展插件中心！`,
        `- **插件系统架构**: 微内核插槽化契约 (\`plugin-manager.js\` + \`mcp-master.js\`)`,
        `- **工具调度接入**: Master-MCP 单总线聚合，多端零重启感知`,
        `- **客户端作用域**: 当前支持 OpenCode / OpenChamber / OpenAI Codex 独立按需分发`,
        `\n> 祝你编码愉快，体验极致的 AI 智能体工作流！`
      ].join('\n');

      return {
        isError: false,
        content: [{ type: 'text', text: greeting }]
      };
    }

    throw new Error(`未知工具调用: "${toolName}"`);
  },

  async stop(context) {
    context.logger?.info('[Plugin:ExampleGreeter] 示例问候插件已安全停用');
  }
};
