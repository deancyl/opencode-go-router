# OpenCode Go Router 外挂与扩展插件开发者接入规范指南 (Plugin Developer Guide)

> **版本**：v1.0.0 (Baseline: Router v3.12.0+)  
> **微内核总线**：`plugin-manager.js` & `mcp-master.js`  
> **多端支持矩阵**：OpenCode 2.0 CLI、OpenChamber 桌面端、OpenAI Codex Desktop / CLI

---

## 1. 架构总览与核心设计哲学

OpenCode Go Router 采用微内核可插拔外挂中枢 (Pluggable Microkernel Hub) 架构。网关核心负责基础调度、负载均衡与多端协议桥接；所有能力扩展均作为独立插件在 `plugins/<plugin-id>/` 目录下进行隔离维护。

```
plugins/
├── comfyui/                 # 视觉生图与图片反推中枢 (后台服务 + MCP + 前端沙箱)
├── omo/                     # Oh My OpenAgent 多智能体协同插件 (Sisyphus/Hephaestus 角色注入)
└── custom/                  # 第三方开发者本地扩展目录
    └── <your-plugin-id>/    # 你的自定义插件
        ├── plugin.json      # 插件清单规范声明 (必需)
        ├── index.js         # 生命周期钩子与工具处理入口 (必需)
        └── ui/              # (可选) 前端控制台组件
```

### 核心特性
1. **插槽化能力模型 (Capabilities Contract)**：通过清单声明式挂载服务 (`service`)、工具 (`tools`)、智能体 (`agents`)、路由 (`routes`) 与前端组件 (`ui`)；
2. **4 级静态拓扑预检 (Topology Pre-flight Check)**：在激活前静态预检端口占用、硬件/显存需求、工具命名冲突与互斥依赖，防撞车、防死锁；
3. **Master-MCP 聚合工具总线 (Zero-Config / Zero-Reload)**：客户端接入单一 `mcp-master.js` 端点；插件启闭时客户端无需重启、无需修改本地文件即可毫秒级动态感知工具增删；
4. **卡片级多端自主勾选**：每张插件卡片独立支持 `[x] OpenCode` `[x] OpenChamber` `[x] OpenAI Codex` 客户端作用域控制；
5. **Windows 原生静默脱钩 (AV-Immune Compliance)**：严禁任何命令行黑框弹出，严禁黑产编码特征，通过标准 Node.js 原生 API 与进程树终止指令保障杀软零误报。

---

## 2. 插件清单文件规范 (`plugin.json`)

每个插件根目录下必须包含一个 UTF-8 编码的 `plugin.json`：

```json
{
  "$schema": "https://opencode.ai/schemas/router-plugin-v1.json",
  "id": "code-quality-guard",
  "name": "代码规范与安全扫描卫士",
  "version": "1.0.0",
  "description": "基于静态分析规则库对项目代码进行质量把关与安全漏洞检测",
  "author": "developer-name",
  "entry": "index.js",
  "category": "tools",

  "system": {
    "platforms": ["win32", "linux", "darwin"],
    "requiresNode": ">=18.0.0",
    "ports": [8990],
    "hardware": {
      "gpu": false,
      "recommendedVramMb": 0,
      "minVramMb": 0
    },
    "conflictsWith": [],
    "requires": []
  },

  "clientScopes": {
    "supported": ["opencode", "openchamber", "codex"],
    "defaultEnabled": ["opencode", "codex"]
  },

  "capabilities": {
    "service": {
      "daemonSupported": false,
      "defaultPort": 8990,
      "healthEndpoint": "http://127.0.0.1:8990/status",
      "modes": ["cpu"]
    },
    "tools": [
      {
        "name": "scan_security_risks",
        "description": "扫描指定文件或目录中潜在的安全风险与密钥泄露隐患",
        "parameters": {
          "type": "object",
          "properties": {
            "targetPath": {
              "type": "string",
              "description": "待扫描的本地绝对路径或相对于工作区的相对路径"
            },
            "strictMode": {
              "type": "boolean",
              "description": "是否开启高灵敏度严格审计模式"
            }
          },
          "required": ["targetPath"]
        }
      }
    ],
    "agents": [
      {
        "id": "security-reviewer",
        "name": "安全审计员",
        "description": "独立审计代码改动的安全性",
        "mode": "subagent"
      }
    ],
    "routes": [
      { "path": "/v1/plugins/security/scan", "method": "POST" }
    ],
    "ui": {
      "badge": "🛡️ 安全审计",
      "sandbox": false
    }
  }
}
```

### 字段说明
| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `id` | string | 是 | 唯一插件标识，仅允许小写英文字母、数字、短横线与下划线 |
| `name` | string | 是 | 插件显示名称（支持中文） |
| `version` | string | 是 | 符合语义化版本规范的版本号 (如 `1.0.0`) |
| `entry` | string | 是 | 入口脚本路径，默认为 `index.js` |
| `category` | string | 否 | 分类标签：`service` / `tools` / `agent` / `ui` / `general` |
| `system.ports` | number[] | 否 | 声明该插件占用的所有本地网络端口，用于拓扑冲突预检 |
| `system.hardware`| object | 否 | 硬件需求，包含 `gpu` 标记与显存预算 (`recommendedVramMb`) |
| `system.conflictsWith` | string[] | 否 | 互斥插件 ID 列表，若存在冲突插件运行则禁止激活 |
| `system.requires` | string[] | 否 | 依赖的前置插件 ID 列表 |
| `clientScopes` | object | 否 | 支持的目标客户端 (`supported`) 及默认启用的客户端 (`defaultEnabled`) |
| `capabilities.tools` | array | 否 | 暴露给 AI 智能体的 MCP 工具列表，需包含标准 JSON Schema 参数说明 |
| `capabilities.agents` | array | 否 | 声明需要注入到客户端的原生智能体定义 |

---

## 3. 插件生命周期与入口文件钩子 (`index.js`)

入口文件必须导出一个对象或类，支持以下标准生命周期钩子：

```javascript
/**
 * index.js - 插件入口模板
 */
'use strict';

module.exports = {
  /**
   * 1. 初始化钩子 (插件加载时触发)
   * @param {Object} context 包含 { pluginId, manifest, dir, rootDir, routerPort, logger, config, registerTool }
   */
  async init(context) {
    context.logger.info(`[Plugin:${context.pluginId}] 初始化完成，网关核心端口: ${context.routerPort}`);
  },

  /**
   * 2. 状态探活钩子 (网关健康检查与 Web 控制台轮询时触发)
   * @returns {Object} { status: 'healthy' | 'degraded' | 'stopped', message: string, ...extra }
   */
  async probe(context) {
    return {
      status: 'healthy',
      message: '扫描规则库正常加载',
      rulesCount: 42
    };
  },

  /**
   * 3. 工具执行处理函数 (当客户端通过 Master-MCP 调用插件声明的工具时触发)
   * @param {string} toolName 工具名称 (如 "scan_security_risks")
   * @param {Object} args 工具参数对象
   * @param {Object} context 执行上下文
   * @returns {Object} 格式需满足 MCP Content 规范: { isError: boolean, content: [{ type: 'text', text: '...' }] }
   */
  async executeTool(toolName, args, context) {
    if (toolName === 'scan_security_risks') {
      const { targetPath, strictMode } = args;
      if (!targetPath) {
        return {
          isError: true,
          content: [{ type: 'text', text: '错误: 目标路径不能为空' }]
        };
      }

      // 执行实际的扫描业务逻辑
      const report = `### 🛡️ 代码安全审计报告\n- **目标路径**: \`${targetPath}\`\n- **模式**: \`${strictMode ? '严格' : '常规'}\`\n- **扫描结果**: 未发现高危隐患，代码安全合规。`;

      return {
        isError: false,
        content: [{ type: 'text', text: report }]
      };
    }

    throw new Error(`未支持的工具调用: "${toolName}"`);
  },

  /**
   * 4. 守护服务生命周期钩子 (若 capabilities.service.daemonSupported 为 true 时实现)
   */
  async startService(mode, context) {
    // 启动本地后台服务 (必须使用 windowsHide: true 与 stdio: 'ignore'，绝不弹黑框)
    return { success: true, pid: 1234, message: '服务已静默启动' };
  },

  async stopService(context) {
    // 优雅关闭服务
    return { success: true, message: '服务已安全退出' };
  },

  /**
   * 5. 卸载钩子 (用户停用插件或网关重启时触发)
   */
  async stop(context) {
    context.logger.info(`[Plugin:${context.pluginId}] 资源已释放`);
  }
};
```

---

## 4. Windows 桌面静默脱钩与杀软防误报红线 (AV-Immune Compliance)

为保障用户良好的桌面体验与杀毒软件（Windows Defender 等）零误报，插件服务管理必须严格遵守以下 5 条铁律：

1. **严禁黑产混淆代码**：
   - 严禁使用 powershell `-EncodedCommand` 或 Base64 字符串混淆执行系统命令；
   - 严禁向用户 Temp 目录无签名临时释放 `.bat` / `.exe`；
2. **纯静默零黑框常驻**：
   - Windows 下派生子进程必须强制携带 `windowsHide: true` 与 `stdio: 'ignore'`，或通过宿主原生 VBScript 静默外壳唤出；
3. **明文与标准 API 传参**：
   - 强制使用 Node.js 原生标准 API (`child_process.spawn` / `child_process.execFile`)，所有命令与参数通过明文字符串数组传递（杜绝 Shell 字符串拼接注入）；
4. **规范进程树回收**：
   - 终止服务时统一调用 Windows 标准 `taskkill /PID <pid> /T /F`，避免孤立僵死进程残留霸占端口与显存；
5. **原子状态固化**：
   - 配置与启停状态通过网关提供的 `writeJsonAtomic` 进行原子落盘，杜绝并发写入中途断电导致文件损坏。

---

## 5. 极简 3 步快速接入示例

### 第一步：在 `plugins/custom/` 创建插件目录
例如创建 `plugins/custom/my-linter/`，并在其中放入 `plugin.json` 与 `index.js`。

### 第二步：点击 Web 控制台 “🔄 重新扫描本地扩展”
打开网关 Web 控制台 `http://127.0.0.1:4010/#/plugins`，点击顶部的 **“🔄 重新扫描本地扩展”** 按钮。网关将毫秒级扫描目录，并自动呈现你的插件卡片！

### 第三步：点击 “🔍 拓扑预检” 并启用
点击卡片上的 **“🔍 拓扑预检”**，确认无端口与命名冲突；点击开启总开关，并勾选目标客户端（如 `[x] OpenCode` `[x] Codex`）。
此时，你声明的工具已实时挂载在 Master-MCP 总线上，打开 Codex 或 OpenCode 会话即可直接调度该工具！
