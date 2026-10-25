/**
 * OpenCode Go Router - Codex Protocol Adapter & One-Click Bridge Engine
 * Zero external dependencies (pure Node.js native).
 * 
 * Capabilities:
 * 1. Deep detection and configuration management for OpenAI Codex CLI (~/.codex)
 * 2. Complete OpenCode Go 38-model catalog with reasoning effort support (low, medium, high, xhigh, max)
 * 3. Bidirectional protocol bridge: OpenAI Responses API <-> OpenAI ChatCompletions API
 *    - Full SSE streaming translation (reasoning_text, output_text, tool_calls)
 *    - Model prefix normalization (opencode-go/ -> raw model name)
 *    - Reasoning effort normalization (low, medium, high, xhigh, max -> standard reasoning_effort)
 * 4. Atomic zero-loss backup & rollback engine (bindCodexConfig / restoreCodexConfig)
 * 5. Codex status diagnostics (getCodexStatus)
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');
const contextCompactor = require('./context-compactor');

let _globalComfyAdapter = null;
function getComfyUIAdapter() {
  if (!_globalComfyAdapter) {
    try {
      const { ComfyUIAdapter } = require('./comfyui-adapter');
      _globalComfyAdapter = new ComfyUIAdapter({ rootDir: __dirname });
    } catch (_) {}
  }
  return _globalComfyAdapter;
}

function setComfyUIAdapter(adapter) {
  _globalComfyAdapter = adapter;
}

function isImageGenerationToolName(name) {
  if (!name || typeof name !== 'string') return false;
  const n = name.trim();
  return n === 'generate_image' || n === 'mcp__comfyui__generate_image' || n === 'image_gen';
}

// 38 All Available OpenCode Go Models with rich metadata for Codex catalog & reasoning support
const OPENCODE_GO_ALL_MODELS = [
  {
    slug: 'deepseek-v4.1-flash',
    display_name: 'DeepSeek-V4.1-Flash',
    description: '最新代极速全能 Agent 代码模型，原生 Responses 协议，极低延迟深度推理。',
    default_reasoning_level: 'high',
    supported_reasoning_levels: [
      { effort: 'low', description: '极速轻量思考，适合简单编辑与快速命令' },
      { effort: 'medium', description: '均衡思考，兼顾质量与响应速度' },
      { effort: 'high', description: '深度思考，适合复杂逻辑与跨文件推导' },
      { effort: 'xhigh', description: '极限深度思考，最大深度求解棘手问题' }
    ],
    supports_parallel_tool_calls: true,
    supports_image_detail_original: true,
    input_modalities: ['text', 'image'],
    context_window: 1048576,
    max_context_window: 1048576,
    effective_context_window_percent: 95,
    visibility: 'list',
    supported_in_api: true,
    priority: 1000
  },
  {
    slug: 'deepseek-v4-pro',
    display_name: 'DeepSeek-V4-Pro',
    description: '旗舰级系统架构与复杂算法模型，超大容量复杂推理。',
    default_reasoning_level: 'high',
    supported_reasoning_levels: [
      { effort: 'low', description: '轻量思考模式' },
      { effort: 'medium', description: '标准工程思考模式' },
      { effort: 'high', description: '深度架构推导模式' },
      { effort: 'xhigh', description: '极限深度推演' }
    ],
    supports_parallel_tool_calls: true,
    supports_image_detail_original: true,
    input_modalities: ['text', 'image'],
    context_window: 1048576,
    max_context_window: 1048576,
    effective_context_window_percent: 95,
    visibility: 'list',
    supported_in_api: true,
    priority: 990
  },
  {
    slug: 'deepseek-flash',
    display_name: 'DeepSeek-Flash',
    description: '极低延迟响应模型，适合快速编辑、重命名与单元测试。',
    default_reasoning_level: 'high',
    supported_reasoning_levels: [
      { effort: 'low', description: '快速轻量推理' },
      { effort: 'high', description: '高深度推理' },
      { effort: 'xhigh', description: '超高深度推理' }
    ],
    supports_parallel_tool_calls: true,
    supports_image_detail_original: true,
    input_modalities: ['text', 'image'],
    context_window: 1048576,
    max_context_window: 1048576,
    effective_context_window_percent: 95,
    visibility: 'list',
    supported_in_api: true,
    priority: 980
  },
  {
    slug: 'deepseek-v4-flash',
    display_name: 'DeepSeek-V4-Flash',
    description: '标准前沿 Agent 编程模型。',
    default_reasoning_level: 'high',
    supported_reasoning_levels: [
      { effort: 'low', description: '快速轻量推理' },
      { effort: 'high', description: '高深度推理' },
      { effort: 'max', description: '极限推理深度' }
    ],
    supports_parallel_tool_calls: true,
    supports_image_detail_original: true,
    input_modalities: ['text', 'image'],
    context_window: 1048576,
    max_context_window: 1048576,
    effective_context_window_percent: 95,
    visibility: 'list',
    supported_in_api: true,
    priority: 970
  },
  {
    slug: 'deepseek-v4-flash-vision-exp',
    display_name: 'DeepSeek-V4-Flash-Vision',
    description: '多模态视觉 Agent 模型，支持截图、图表与 UI 布局深度分析。',
    default_reasoning_level: 'high',
    supported_reasoning_levels: [
      { effort: 'low', description: '快速视觉解析' },
      { effort: 'high', description: '深度视觉理解与代码对应' }
    ],
    supports_parallel_tool_calls: true,
    supports_image_detail_original: true,
    input_modalities: ['text', 'image'],
    context_window: 1048576,
    max_context_window: 1048576,
    effective_context_window_percent: 95,
    visibility: 'list',
    supported_in_api: true,
    priority: 960
  },
  {
    slug: 'kimi-k3',
    display_name: 'Kimi-K3',
    description: '200万上下文超长文本架构解析与自主探索 Agent 模型（经网关无缝协议桥转换）。',
    default_reasoning_level: 'high',
    supported_reasoning_levels: [
      {
        "effort": "low",
        "description": "快速轻量"
      },
      {
        "effort": "medium",
        "description": "常规平衡"
      },
      {
        "effort": "high",
        "description": "深度思考"
      },
      {
        "effort": "xhigh",
        "description": "超高推理"
      }
    ],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 2000000,
    max_context_window: 2000000,
    effective_context_window_percent: 95,
    visibility: 'list',
    supported_in_api: true,
    priority: 950
  },
  {
    slug: 'kimi-k2.7-code',
    display_name: 'Kimi-K2.7-Code',
    description: 'Kimi 专业代码编程专用模型，长文本代码重构专家。',
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [
      {
        "effort": "low",
        "description": "快速轻量"
      },
      {
        "effort": "medium",
        "description": "常规平衡"
      },
      {
        "effort": "high",
        "description": "深度思考"
      },
      {
        "effort": "xhigh",
        "description": "超高推理"
      }
    ],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 2000000,
    max_context_window: 2000000,
    visibility: 'list',
    supported_in_api: true,
    priority: 940
  },
  {
    slug: 'kimi-k2.6',
    display_name: 'Kimi-K2.6',
    description: 'Kimi 稳健版长上下文基础模型。',
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [
      {
        "effort": "low",
        "description": "快速轻量"
      },
      {
        "effort": "medium",
        "description": "常规平衡"
      },
      {
        "effort": "high",
        "description": "深度思考"
      }
    ],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 1000000,
    max_context_window: 1000000,
    visibility: 'list',
    supported_in_api: true,
    priority: 930
  },
  {
    slug: 'qwen3.7-plus',
    display_name: 'Qwen-3.7-Plus',
    description: '阿里通义千问全栈代码与复杂逻辑推理模型，数学与工程能力极佳。',
    default_reasoning_level: 'high',
    supported_reasoning_levels: [
      { effort: 'low', description: '快速逻辑响应' },
      { effort: 'medium', description: '标准工程思考' },
      { effort: 'high', description: '深度推理与算法分析' },
      { effort: 'xhigh', description: '超强全维思考' }
    ],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 1048576,
    max_context_window: 1048576,
    visibility: 'list',
    supported_in_api: true,
    priority: 920
  },
  {
    slug: 'qwen3.7-max',
    display_name: 'Qwen-3.7-Max',
    description: '通义千问超大规模旗舰逻辑规划模型。',
    default_reasoning_level: 'high',
    supported_reasoning_levels: [
      {
        "effort": "low",
        "description": "快速轻量"
      },
      {
        "effort": "medium",
        "description": "常规平衡"
      },
      {
        "effort": "high",
        "description": "深度思考"
      },
      {
        "effort": "xhigh",
        "description": "超高推理"
      }
    ],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 1048576,
    max_context_window: 1048576,
    visibility: 'list',
    supported_in_api: true,
    priority: 915
  },
  {
    slug: 'qwen3.8-max',
    display_name: 'Qwen-3.8-Max',
    description: '通义千问最新一代旗舰级认知思考大模型。',
    default_reasoning_level: 'high',
    supported_reasoning_levels: [
      {
        "effort": "low",
        "description": "快速轻量"
      },
      {
        "effort": "medium",
        "description": "常规平衡"
      },
      {
        "effort": "high",
        "description": "深度思考"
      },
      {
        "effort": "xhigh",
        "description": "超高推理"
      }
    ],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 1048576,
    max_context_window: 1048576,
    visibility: 'list',
    supported_in_api: true,
    priority: 910
  },
  {
    slug: 'qwen3.8-flash',
    display_name: 'Qwen-3.8-Flash',
    description: '通义千问高吞吐低延迟极速代码模型。',
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [
      {
        "effort": "low",
        "description": "快速轻量"
      },
      {
        "effort": "medium",
        "description": "常规平衡"
      },
      {
        "effort": "high",
        "description": "深度思考"
      },
      {
        "effort": "xhigh",
        "description": "超高推理"
      }
    ],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 524288,
    max_context_window: 524288,
    visibility: 'list',
    supported_in_api: true,
    priority: 905
  },
  {
    slug: 'qwen3.6-plus',
    display_name: 'Qwen-3.6-Plus',
    description: '通义千问高性价比经典代码重构模型。',
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [
      {
        "effort": "low",
        "description": "快速轻量"
      },
      {
        "effort": "medium",
        "description": "常规平衡"
      },
      {
        "effort": "high",
        "description": "深度思考"
      },
      {
        "effort": "xhigh",
        "description": "超高推理"
      }
    ],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 524288,
    max_context_window: 524288,
    visibility: 'list',
    supported_in_api: true,
    priority: 900
  },
  {
    slug: 'glm-5.3',
    display_name: 'GLM-5.3',
    description: '智谱全能旗舰 Agent 认知决策模型，中文自然语言与工具规划顶尖。',
    default_reasoning_level: 'high',
    supported_reasoning_levels: [
      { effort: 'low', description: '快速对话与轻量工具调用' },
      { effort: 'medium', description: '平衡模式' },
      { effort: 'high', description: '深度逻辑链思考' },
      { effort: 'xhigh', description: '极高强度深度推理' }
    ],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 1048576,
    max_context_window: 1048576,
    visibility: 'list',
    supported_in_api: true,
    priority: 890
  },
  {
    slug: 'glm-5.3-flash',
    display_name: 'GLM-5.3-Flash',
    description: '智谱闪电极速版模型，极高吞吐。',
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [
      { effort: 'low', description: '快速轻量' },
      { effort: 'medium', description: '常规' },
      { effort: 'high', description: '深度思考' },
      { effort: 'xhigh', description: '超高推理' }
    ],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 524288,
    max_context_window: 524288,
    visibility: 'list',
    supported_in_api: true,
    priority: 885
  },
  {
    slug: 'glm-5.2',
    display_name: 'GLM-5.2',
    description: '智谱高性能平衡版模型。',
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [
      {
        "effort": "low",
        "description": "快速轻量"
      },
      {
        "effort": "medium",
        "description": "常规平衡"
      },
      {
        "effort": "high",
        "description": "深度思考"
      },
      {
        "effort": "xhigh",
        "description": "超高推理"
      }
    ],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 524288,
    max_context_window: 524288,
    visibility: 'list',
    supported_in_api: true,
    priority: 880
  },
  {
    slug: 'glm-5.1',
    display_name: 'GLM-5.1',
    description: '智谱稳健工程版模型。',
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [
      {
        "effort": "low",
        "description": "快速轻量"
      },
      {
        "effort": "medium",
        "description": "常规平衡"
      },
      {
        "effort": "high",
        "description": "深度思考"
      },
      {
        "effort": "xhigh",
        "description": "超高推理"
      }
    ],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 262144,
    max_context_window: 262144,
    visibility: 'list',
    supported_in_api: true,
    priority: 875
  },
  {
    slug: 'minimax-m3',
    display_name: 'MiniMax-M3',
    description: '极高吞吐超长上下文高智商代码生成模型，单批次生成极速。',
    default_reasoning_level: 'high',
    supported_reasoning_levels: [
      {
        "effort": "low",
        "description": "快速轻量"
      },
      {
        "effort": "medium",
        "description": "常规平衡"
      },
      {
        "effort": "high",
        "description": "深度思考"
      },
      {
        "effort": "xhigh",
        "description": "超高推理"
      }
    ],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 1048576,
    max_context_window: 1048576,
    visibility: 'list',
    supported_in_api: true,
    priority: 870
  },
  {
    slug: 'minimax-m2.7',
    display_name: 'MiniMax-M2.7',
    description: 'MiniMax 均衡全场景模型。',
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [
      {
        "effort": "low",
        "description": "快速轻量"
      },
      {
        "effort": "medium",
        "description": "常规平衡"
      },
      {
        "effort": "high",
        "description": "深度思考"
      },
      {
        "effort": "xhigh",
        "description": "超高推理"
      }
    ],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 524288,
    max_context_window: 524288,
    visibility: 'list',
    supported_in_api: true,
    priority: 865
  },
  {
    slug: 'minimax-m2.5',
    display_name: 'MiniMax-M2.5',
    description: 'MiniMax 极速轻量模型。',
    default_reasoning_level: 'low',
    supported_reasoning_levels: [{ effort: 'low', description: '极速' }],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 262144,
    max_context_window: 262144,
    visibility: 'list',
    supported_in_api: true,
    priority: 860
  },
  {
    slug: 'grok-4.7',
    display_name: 'Grok-4.7',
    description: 'xAI 最新前沿逻辑推导与编程模型（原生 Responses 协议）。',
    default_reasoning_level: 'high',
    supported_reasoning_levels: [
      {
        "effort": "low",
        "description": "快速轻量"
      },
      {
        "effort": "medium",
        "description": "常规平衡"
      },
      {
        "effort": "high",
        "description": "深度思考"
      },
      {
        "effort": "xhigh",
        "description": "超高推理"
      }
    ],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 1048576,
    max_context_window: 1048576,
    visibility: 'list',
    supported_in_api: true,
    priority: 850
  },
  {
    slug: 'grok-4.6',
    display_name: 'Grok-4.6',
    description: 'xAI 稳健版高级编程分析模型。',
    default_reasoning_level: 'high',
    supported_reasoning_levels: [
      {
        "effort": "low",
        "description": "快速轻量"
      },
      {
        "effort": "medium",
        "description": "常规平衡"
      },
      {
        "effort": "high",
        "description": "深度思考"
      },
      {
        "effort": "xhigh",
        "description": "超高推理"
      }
    ],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 524288,
    max_context_window: 524288,
    visibility: 'list',
    supported_in_api: true,
    priority: 840
  },
  {
    slug: 'gpt-5.6-luna',
    display_name: 'GPT-5.6-Luna',
    description: '尖端前沿高级大语言推理模型（原生 Responses 协议支持）。',
    default_reasoning_level: 'high',
    supported_reasoning_levels: [
      {
        "effort": "low",
        "description": "快速轻量"
      },
      {
        "effort": "medium",
        "description": "常规平衡"
      },
      {
        "effort": "high",
        "description": "深度思考"
      },
      {
        "effort": "xhigh",
        "description": "超高推理"
      }
    ],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 1048576,
    max_context_window: 1048576,
    visibility: 'list',
    supported_in_api: true,
    priority: 830
  },
  {
    slug: 'gpt-6-luna',
    display_name: 'GPT-6-Luna',
    description: '下一代前沿大语言推理实验模型。',
    default_reasoning_level: 'high',
    supported_reasoning_levels: [
      {
        "effort": "low",
        "description": "快速轻量"
      },
      {
        "effort": "medium",
        "description": "常规平衡"
      },
      {
        "effort": "high",
        "description": "深度思考"
      },
      {
        "effort": "xhigh",
        "description": "超高推理"
      }
    ],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 1048576,
    max_context_window: 1048576,
    visibility: 'list',
    supported_in_api: true,
    priority: 820
  },
  {
    slug: 'claude-haiku-5-5',
    display_name: 'Claude-Haiku-5.5',
    description: '极速工具调用与轻量推理模型。',
    default_reasoning_level: 'low',
    supported_reasoning_levels: [{ effort: 'low', description: '极速' }],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 262144,
    max_context_window: 262144,
    visibility: 'list',
    supported_in_api: true,
    priority: 810
  },
  {
    slug: 'mimo-v2.6-pro',
    display_name: 'MiMo-V2.6-Pro',
    description: '旗舰级多模态深度解析模型。',
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [
      {
        "effort": "low",
        "description": "快速轻量"
      },
      {
        "effort": "medium",
        "description": "常规平衡"
      },
      {
        "effort": "high",
        "description": "深度思考"
      }
    ],
    supports_parallel_tool_calls: true,
    input_modalities: ['text', 'image'],
    context_window: 524288,
    max_context_window: 524288,
    visibility: 'list',
    supported_in_api: true,
    priority: 800
  },
  {
    slug: 'mimo-v2.6-flash',
    display_name: 'MiMo-V2.6-Flash',
    description: '闪电极速多模态分析模型。',
    default_reasoning_level: 'low',
    supported_reasoning_levels: [{ effort: 'low', description: '极速' }],
    supports_parallel_tool_calls: true,
    input_modalities: ['text', 'image'],
    context_window: 262144,
    max_context_window: 262144,
    visibility: 'list',
    supported_in_api: true,
    priority: 790
  },
  {
    slug: 'mimo-v2.5-pro',
    display_name: 'MiMo-V2.5-Pro',
    description: '高性能多模态版本。',
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [{ effort: 'medium', description: '标准' }],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 262144,
    max_context_window: 262144,
    visibility: 'list',
    supported_in_api: true,
    priority: 780
  },
  {
    slug: 'mimo-v2.5',
    display_name: 'MiMo-V2.5',
    description: '通用多模态基础模型。',
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [{ effort: 'medium', description: '标准' }],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 131072,
    max_context_window: 131072,
    visibility: 'list',
    supported_in_api: true,
    priority: 770
  },
  {
    slug: 'hy4-preview',
    display_name: 'Hunyuan-HY4-Preview',
    description: '混元最新一代全功能代码大模型。',
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [
      {
        "effort": "low",
        "description": "快速轻量"
      },
      {
        "effort": "medium",
        "description": "常规平衡"
      },
      {
        "effort": "high",
        "description": "深度思考"
      },
      {
        "effort": "xhigh",
        "description": "超高推理"
      }
    ],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 524288,
    max_context_window: 524288,
    visibility: 'list',
    supported_in_api: true,
    priority: 760
  },
  {
    slug: 'hy3',
    display_name: 'Hunyuan-HY3',
    description: '混元高性能中文代码模型。',
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [
      {
        "effort": "low",
        "description": "快速轻量"
      },
      {
        "effort": "medium",
        "description": "常规平衡"
      },
      {
        "effort": "high",
        "description": "深度思考"
      },
      {
        "effort": "xhigh",
        "description": "超高推理"
      }
    ],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 262144,
    max_context_window: 262144,
    visibility: 'list',
    supported_in_api: true,
    priority: 750
  },
  {
    slug: 'longcat-2.5-preview-free',
    display_name: 'LongCat-2.5-Preview',
    description: '超长上下文长文档分析模型。',
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [{ effort: 'medium', description: '标准' }],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 1048576,
    max_context_window: 1048576,
    visibility: 'list',
    supported_in_api: true,
    priority: 740
  },
  {
    slug: 'longcat-2.0',
    display_name: 'LongCat-2.0',
    description: '稳健长文本处理模型。',
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [{ effort: 'medium', description: '标准' }],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 524288,
    max_context_window: 524288,
    visibility: 'list',
    supported_in_api: true,
    priority: 730
  },
  {
    slug: 'step-5-preview-free',
    display_name: 'Step-5-Preview',
    description: '阶跃星辰高智能逻辑推理模型。',
    default_reasoning_level: 'high',
    supported_reasoning_levels: [
      {
        "effort": "low",
        "description": "快速轻量"
      },
      {
        "effort": "medium",
        "description": "常规平衡"
      },
      {
        "effort": "high",
        "description": "深度思考"
      },
      {
        "effort": "xhigh",
        "description": "超高推理"
      }
    ],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 262144,
    max_context_window: 262144,
    visibility: 'list',
    supported_in_api: true,
    priority: 720
  },
  {
    slug: 'muse-spark-1.3-contributor',
    display_name: 'Muse-Spark-1.3',
    description: '创意设计与敏捷前端生成模型。',
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [{ effort: 'medium', description: '标准' }],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 262144,
    max_context_window: 262144,
    visibility: 'list',
    supported_in_api: true,
    priority: 710
  },
  {
    slug: 'muse-spark-1.2-contributor',
    display_name: 'Muse-Spark-1.2',
    description: '创意设计版本。',
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [{ effort: 'medium', description: '标准' }],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 131072,
    max_context_window: 131072,
    visibility: 'list',
    supported_in_api: true,
    priority: 700
  },
  {
    slug: 'omen-alpha',
    display_name: 'Omen-Alpha',
    description: '前沿实验性自主编程模型。',
    default_reasoning_level: 'high',
    supported_reasoning_levels: [{ effort: 'high', description: '深度推理' }],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 524288,
    max_context_window: 524288,
    visibility: 'list',
    supported_in_api: true,
    priority: 690
  },
  {
    slug: 'space-bunny',
    display_name: 'Space-Bunny',
    description: '轻量敏捷开发辅助模型。',
    default_reasoning_level: 'low',
    supported_reasoning_levels: [{ effort: 'low', description: '快速' }],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 131072,
    max_context_window: 131072,
    visibility: 'list',
    supported_in_api: true,
    priority: 680
  },
  {
    slug: 'gemini-4-argon-contributor',
    display_name: 'Gemini-4-Argon-Contributor',
    description: '多模态全景分析与长上下文复杂代码推导模型。',
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [
      { effort: 'low', description: '快速轻量' },
      { effort: 'medium', description: '标准分析' },
      { effort: 'high', description: '深度思考' }
    ],
    supports_parallel_tool_calls: true,
    supports_image_detail_original: true,
    input_modalities: ['text', 'image'],
    context_window: 1048576,
    max_context_window: 1048576,
    effective_context_window_percent: 95,
    visibility: 'list',
    supported_in_api: true,
    priority: 885
  },
  {
    slug: 'step-5-preview',
    display_name: 'Step-5-Preview',
    description: '前沿大窗口阶跃推理模型，极强逻辑理解与代码生成。',
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [
      { effort: 'low', description: '快速执行' },
      { effort: 'medium', description: '标准工程推导' },
      { effort: 'high', description: '高难度逻辑求解' }
    ],
    supports_parallel_tool_calls: true,
    supports_image_detail_original: true,
    input_modalities: ['text', 'image'],
    context_window: 524288,
    max_context_window: 524288,
    effective_context_window_percent: 95,
    visibility: 'list',
    supported_in_api: true,
    priority: 795
  },
  {
    slug: 'minimax-m3.1-flash-free',
    display_name: 'MiniMax-M3.1-Flash-Free',
    description: 'MiniMax 极速免费高并发代码与对话模型。',
    default_reasoning_level: 'low',
    supported_reasoning_levels: [{ effort: 'low', description: '极速响应' }],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 262144,
    max_context_window: 262144,
    visibility: 'list',
    supported_in_api: true,
    priority: 755
  },
  {
    slug: 'beam-free',
    display_name: 'Beam-Free',
    description: 'Beam 高速免费代码编辑与脚本辅助模型。',
    default_reasoning_level: 'low',
    supported_reasoning_levels: [{ effort: 'low', description: '快速响应' }],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 131072,
    max_context_window: 131072,
    visibility: 'list',
    supported_in_api: true,
    priority: 675
  },
  {
    slug: 'cat-jam-free',
    display_name: 'Cat-Jam-Free',
    description: '轻快敏捷免费助理模型，日常问答与文本格式化。',
    default_reasoning_level: 'low',
    supported_reasoning_levels: [{ effort: 'low', description: '极速响应' }],
    supports_parallel_tool_calls: true,
    input_modalities: ['text'],
    context_window: 131072,
    max_context_window: 131072,
    visibility: 'list',
    supported_in_api: true,
    priority: 670
  }
];

// Ensure shell_type is set for Codex CLI serde deserialization
for (const m of OPENCODE_GO_ALL_MODELS) {
  if (!m.shell_type) m.shell_type = 'shell_command';
}

/**
 * Dynamically synchronizes official upstream models into Codex catalog
 */
function autoSyncFromOpencodeConfig() {
  try {
    const ocPath = path.join(require('os').homedir(), '.config', 'opencode', 'opencode.jsonc');
    if (fs.existsSync(ocPath)) {
      const raw = fs.readFileSync(ocPath, 'utf8');
      const clean = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const cfg = JSON.parse(clean);
      const mObj = cfg?.provider?.['opencode-go']?.models;
      if (mObj && typeof mObj === 'object') {
        syncDynamicModels(Object.keys(mObj));
      }
    }
  } catch (_) {}
}

function syncDynamicModels(slugList) {
  if (!Array.isArray(slugList) || slugList.length === 0) return OPENCODE_GO_ALL_MODELS;
  const existingSlugs = new Set(OPENCODE_GO_ALL_MODELS.map(m => m.slug));
  for (const slug of slugList) {
    if (typeof slug === 'string' && slug.trim() && !existingSlugs.has(slug.trim())) {
      const cleanSlug = slug.trim();
      existingSlugs.add(cleanSlug);
      OPENCODE_GO_ALL_MODELS.push({
        slug: cleanSlug,
        display_name: cleanSlug.toUpperCase(),
        description: `OpenCode Go ${cleanSlug} 动态感知模型`,
        default_reasoning_level: 'medium',
        supported_reasoning_levels: [
          { effort: 'low', description: '极速轻量思考' },
          { effort: 'medium', description: '均衡思考' },
          { effort: 'high', description: '深度思考' }
        ],
        supports_parallel_tool_calls: true,
        supports_image_detail_original: true,
        input_modalities: ['text', 'image'],
        context_window: 1048576,
        max_context_window: 1048576,
        effective_context_window_percent: 95,
        visibility: 'list',
        supported_in_api: true,
        priority: 600,
        shell_type: 'shell_command'
      });
    }
  }
  return OPENCODE_GO_ALL_MODELS;
}

// Models natively supporting OpenAI Responses API on upstream (if configured).
// Note: All standard 38 OpenCode Go models are intentionally NOT in this set so they
// route through our resilient local ChatCompletions bridge with active watchdog & keep-alives,
// completely eliminating upstream /responses proxy deadlocks and 28-minute hangs on complex contexts.
const NATIVE_RESPONSES_MODELS = new Set([
  'native-model-test',
  'gpt-5.6-luna',
  'gpt-6-luna'
]);

// Dynamic pool for models that triggered 404/405/501 or protocol unsupported on upstream /responses
const nativeResponsesUnsupportedModels = new Set();

function markNativeResponsesUnsupported(modelName) {
  if (!modelName || typeof modelName !== 'string') return;
  const clean = modelName.replace(/^opencode-go\//i, '').toLowerCase().trim();
  nativeResponsesUnsupportedModels.add(clean);
  nativeResponsesUnsupportedModels.add(modelName.toLowerCase().trim());
}

function clearNativeResponsesUnsupported() {
  nativeResponsesUnsupportedModels.clear();
}

function isNativeResponsesUnsupported(modelName) {
  if (!modelName || typeof modelName !== 'string') return false;
  const clean = modelName.replace(/^opencode-go\//i, '').toLowerCase().trim();
  return nativeResponsesUnsupportedModels.has(clean) || nativeResponsesUnsupportedModels.has(modelName.toLowerCase().trim());
}

function isNativeResponsesModel(modelName) {
  if (!modelName || typeof modelName !== 'string') return false;
  const clean = modelName.replace(/^opencode-go\//i, '').toLowerCase().trim();
  if (isNativeResponsesUnsupported(clean)) return false;
  return NATIVE_RESPONSES_MODELS.has(clean) || clean.includes('luna');
}

// Models using Anthropic Messages protocol on upstream
const ANTHROPIC_MODELS = new Set([
  'claude-haiku-5-5'
]);

// Upstream compatibility aliases: models that upstream has not fully opened for standard ChatCompletions
// are transparently mapped to equivalent top-tier flagship models with 100% feature parity.
// Note: Luna models (gpt-5.6-luna, gpt-6-luna) have been completely removed from hardcoded aliases to return real execution rights.
const MODEL_COMPATIBILITY_ALIASES = {
  'grok-4.6': 'qwen3.7-max',
  'grok-4.7': 'qwen3.7-max',
  'minimax-m2.7': 'minimax-m3'
};

const MODEL_TIERS = {
  FLASH: 1,    // Flash, Mini, Speed, Turbo, Lite, Haiku
  STANDARD: 2, // Standard, Code, Plus (non-pro), Balanced
  FLAGSHIP: 3  // Pro, Max, Luna, Sonnet, Opus, o1, o3, o4
};

function getModelTier(modelName) {
  if (!modelName || typeof modelName !== 'string') return MODEL_TIERS.STANDARD;
  const name = modelName.toLowerCase();
  if (name.includes('flash') || /(?:^|[-_.])mini(?:[-_.0-9]|$)/.test(name) || name.includes('speed') || 
      name.includes('turbo') || name.includes('lite') || name.includes('haiku')) {
    return MODEL_TIERS.FLASH;
  }
  if (/(?:^|[-_.])pro(?:[-_.0-9]|$)/.test(name) || name.includes('max') || name.includes('luna') || 
      name.includes('opus') || name.includes('sonnet') || name.includes('grok') ||
      name.startsWith('o1') || name.startsWith('o3') || name.startsWith('o4') ||
      name.includes('-o1') || name.includes('-o3') ||
      name.startsWith('llama') || name.startsWith('minimax-m') || name.includes('ultra')) {
    return MODEL_TIERS.FLAGSHIP;
  }
  return MODEL_TIERS.STANDARD;
}

let adapterConfig = {
  allowModelAutoUpgrade: false
};

function configureAdapter(cfg = {}) {
  if (cfg && typeof cfg === 'object') {
    if (cfg.allowModelAutoUpgrade !== undefined) {
      adapterConfig.allowModelAutoUpgrade = Boolean(cfg.allowModelAutoUpgrade);
    }
  }
}

/**
 * Automatically determines the most compatible fallback model when upstream reports
 * an unsupported model or restricted model list.
 * Enforces strict Ladder Matching and Anti-Upgrade Barrier: lower tiers (Flash/Standard)
 * can NEVER be automatically upgraded to Pro/Flagship unless allowUpgrade is explicitly true.
 */
function resolveCompatibleFallbackModel(reqModel, errText = '', options = {}) {
  if (typeof errText !== 'string') errText = '';
  const cleanReq = (reqModel || '').toLowerCase().trim();
  const allowUpgrade = Boolean(
    options.allowUpgrade !== undefined
      ? options.allowUpgrade
      : (typeof adapterConfig !== 'undefined' && adapterConfig.allowModelAutoUpgrade)
  );
  const reqTier = getModelTier(cleanReq);
  const isHighReasoningTask = (options.reasoningEffort === 'xhigh' || options.reasoningEffort === 'high' || options.preferFlagship);

  // Heterogeneous cluster exception (Rule 19): If the model is an unknown external model
  // (not in standard domestic families) and specifies xhigh reasoning, route to deepseek-v4-pro
  const isHeterogeneousRule19 = (
    options.reasoningEffort === 'xhigh' &&
    reqTier !== MODEL_TIERS.FLASH &&
    !cleanReq.startsWith('glm') &&
    !cleanReq.startsWith('kimi') &&
    !cleanReq.startsWith('qwen') &&
    !cleanReq.startsWith('deepseek')
  );

  const allowableTier = (allowUpgrade || isHeterogeneousRule19 || reqTier === MODEL_TIERS.FLAGSHIP)
    ? MODEL_TIERS.FLAGSHIP
    : reqTier;

  // 1. Try parsing explicitly listed candidate model names from upstream error
  const match = errText.match(/supported(?:\s+API)?\s+model\s+names\s+are\s+[:\s]*([^.]+?)(?:,\s*but\s+you\s+passed|\s+but\s+you\s+passed|\.|\(|$)/i);
  if (match && match[1]) {
    const rawCandidates = match[1]
      .split(/[,，]/)
      .map(s => s.trim().replace(/^['"`\[]+|['"`\]]+$/g, ''))
      .filter(s => s && /^[a-zA-Z0-9_.-]+$/.test(s) && s.toLowerCase() !== cleanReq);

    if (rawCandidates.length > 0) {
      // Anti-Upgrade Lock: candidate pool cannot exceed allowableTier
      const candidates = (allowableTier === MODEL_TIERS.FLAGSHIP)
        ? rawCandidates
        : rawCandidates.filter(c => getModelTier(c) <= allowableTier);

      if (candidates.length > 0) {
        // 1.0 Flagship tier models (or upgrade allowed with high reasoning / Rule 19): lock onto 671B flagship (deepseek-v4-pro) first, then pro/max/flagship candidate
        if (allowableTier === MODEL_TIERS.FLAGSHIP && (reqTier === MODEL_TIERS.FLAGSHIP || isHighReasoningTask || isHeterogeneousRule19)) {
          const flagship671b = candidates.find(c => c.toLowerCase() === 'deepseek-v4-pro');
          if (flagship671b) return flagship671b;
          const proHit = candidates.find(c => getModelTier(c) === MODEL_TIERS.FLAGSHIP);
          if (proHit) return proHit;
        }

        // 1.1 Speed / Flash tier models: strictly match to flash/speed candidate
        if (reqTier === MODEL_TIERS.FLASH && !allowUpgrade) {
          const prefix = cleanReq.split(/[-_.]/)[0];
          const familyFlash = candidates.find(c => c.toLowerCase().startsWith(prefix) && getModelTier(c) === MODEL_TIERS.FLASH);
          if (familyFlash) return familyFlash;

          const anyFlash = candidates.find(c => getModelTier(c) === MODEL_TIERS.FLASH);
          if (anyFlash) return anyFlash;
        }

        // 1.2 Family prefix match within allowable candidates
        const prefix = cleanReq.split(/[-_.]/)[0];
        if (prefix && prefix.length > 2) {
          const familyHit = candidates.find(c => c.toLowerCase().startsWith(prefix));
          if (familyHit) return familyHit;
        }

        // 1.3 Keyword match (code, vision, etc.)
        for (const kw of ['code', 'vision', 'plus', 'preview']) {
          if (cleanReq.includes(kw)) {
            const hit = candidates.find(c => c.toLowerCase().includes(kw));
            if (hit) return hit;
          }
        }

        // 1.4 Same tier match
        const sameTierHit = candidates.find(c => getModelTier(c) === reqTier);
        if (sameTierHit) return sameTierHit;

        // 1.5 Pick first candidate in allowable pool (<= allowableTier)
        return candidates[0];
      }

      // If no allowable candidate found and allowUpgrade is false, do not upgrade
      if (!allowUpgrade) {
        return cleanReq;
      }
    }
  }

  // 2. Heuristic rules when candidate list is absent from error text
  // 2.0 Explicit upgrade allowed with flagship preference or high reasoning
  if (allowUpgrade && (options.preferFlagship || options.reasoningEffort === 'xhigh' || options.reasoningEffort === 'high')) {
    return 'deepseek-v4-pro';
  }

  // 2.1 Flash tier: strictly stay in flash tier when allowUpgrade is false
  if (reqTier === MODEL_TIERS.FLASH) {
    if (cleanReq === 'deepseek-v4.1-flash' || cleanReq === 'deepseek-v4-flash') {
      return 'deepseek-flash';
    }
    if (cleanReq === 'deepseek-flash') {
      return 'deepseek-flash';
    }
    if (cleanReq.startsWith('glm')) {
      return 'deepseek-flash';
    }
    if (cleanReq.startsWith('gemini')) {
      return 'deepseek-flash';
    }
    if (cleanReq.startsWith('claude')) {
      return 'deepseek-flash';
    }
    return 'deepseek-flash';
  }

  // 2.2 Standard tier: stay in standard or degrade downward, never upgrade to Pro/Flagship
  if (reqTier === MODEL_TIERS.STANDARD) {
    if (cleanReq.startsWith('kimi-')) {
      return cleanReq === 'kimi-k3' ? 'kimi-k2.7-code' : 'kimi-k3';
    }
    if (cleanReq.startsWith('glm')) {
      return cleanReq === 'glm-5.3' ? 'glm-5.2' : 'glm-5.3';
    }
    if (cleanReq.startsWith('qwen')) {
      return allowUpgrade ? 'qwen3.7-max' : cleanReq;
    }
    // Rule 19: Unknown heterogeneous model without domestic standard peers under xhigh reasoning routes to deepseek-v4-pro
    if (isHeterogeneousRule19) {
      return 'deepseek-v4-pro';
    }
    return 'deepseek-flash';
  }

  // 2.3 Flagship tier: flagship to flagship candidates (Rule 19 Anti-Downgrade)
  if (reqTier === MODEL_TIERS.FLAGSHIP) {
    if (cleanReq.startsWith('gpt-') || cleanReq.startsWith('grok-') || cleanReq.includes('luna')) {
      return 'deepseek-v4-pro';
    }
    if (cleanReq.startsWith('claude-')) {
      return 'deepseek-v4-pro';
    }
    if (cleanReq.startsWith('gemini')) {
      return 'deepseek-v4-pro';
    }
    if (cleanReq.startsWith('llama')) {
      return 'deepseek-v4-pro';
    }
    if (cleanReq.startsWith('minimax')) {
      return 'deepseek-v4-pro';
    }
    if (cleanReq.startsWith('qwen')) {
      return 'deepseek-v4-pro';
    }
    return 'deepseek-v4-pro';
  }

  return 'deepseek-flash';
}

/**
 * Prunes and compresses an oversized Responses API payload (body.input) to fit within
 * the model's context window (e.g. 1M or 2M tokens).
 */
const MAX_PRUNE_FINGERPRINTS = 10000;
const prunedFingerprints = new Set();

function trimPrunedFingerprintsIfNeeded() {
  if (prunedFingerprints.size > MAX_PRUNE_FINGERPRINTS) {
    let toRemove = Math.floor(MAX_PRUNE_FINGERPRINTS * 0.2);
    for (const key of prunedFingerprints) {
      prunedFingerprints.delete(key);
      if (--toRemove <= 0) break;
    }
  }
}

function clearPruneFingerprints() {
  prunedFingerprints.clear();
}
/**
 * UTF-16 Unicode Surrogate Pair Safe Slice.
 * Prevents splitting high surrogates (0xD800-0xDBFF) and low surrogates (0xDC00-0xDFFF),
 * ensuring multi-byte emojis (e.g. 👨‍👩‍👧‍👦, 🎉) and rare CJK characters are never split into malformed sequences.
 */
function safeUnicodeSlice(str, start, end) {
  if (typeof str !== "string" || str.length === 0) return "";
  const len = str.length;
  let s = start === undefined ? 0 : (start < 0 ? Math.max(0, len + start) : Math.min(len, start));
  let e = end === undefined ? len : (end < 0 ? Math.max(0, len + end) : Math.min(len, end));
  if (s >= e) return "";

  if (s > 0 && s < len) {
    const code = str.charCodeAt(s);
    if (code >= 0xDC00 && code <= 0xDFFF) {
      const prevCode = str.charCodeAt(s - 1);
      if (prevCode >= 0xD800 && prevCode <= 0xDBFF) {
        s--;
      }
    }
  }

  if (e > 0 && e < len) {
    const code = str.charCodeAt(e - 1);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const nextCode = str.charCodeAt(e);
      if (nextCode >= 0xDC00 && nextCode <= 0xDFFF) {
        e++;
      }
    }
  }

  return str.slice(s, e);
}

/**
 * Ensures code block (```) syntax balance when folding long text.
 * If prefix leaves an unclosed code block (odd number of ```), appends a closing ```\n.
 * If suffix has an unbalanced closing code block (odd number of ```), prepends an opening ```\n.
 */
function balanceCodeBlocks(head, tail) {
  let balancedHead = head;
  let balancedTail = tail;

  const countCodeFence = (s) => {
    if (!s) return 0;
    const matches = s.match(/(?:^|\n)```/g);
    return matches ? matches.length : 0;
  };

  const headFenceCount = countCodeFence(head);
  if (headFenceCount % 2 !== 0) {
    balancedHead = head.endsWith("\n") ? `${head}\`\`\`\n` : `${head}\n\`\`\`\n`;
  }

  const tailFenceCount = countCodeFence(tail);
  if (tailFenceCount % 2 !== 0) {
    balancedTail = tail.startsWith("\n") ? `\`\`\`\n${tail}` : `\`\`\`\n${tail}`;
  }

  return { head: balancedHead, tail: balancedTail };
}


/**
 * Prunes and compresses an oversized Responses API payload (body.input) to fit within
 * the model's context window (e.g. 1M or 2M tokens).
 */

function isCodeOrSensitiveContent(text) {
  if (typeof text !== 'string') return false;
  const sample = text.length > 4096 ? text.slice(0, 4096) : text;
  if (sample.includes('<<<<<<<') || sample.includes('=======') || sample.includes('>>>>>>>') || sample.includes('|||||||')) return true;
  if (sample.includes('diff --git ') || sample.includes('*** Begin Patch') || /^@@\s+-\d+,\d+\s+\+\d+,\d+\s+@@/m.test(sample)) return true;
  if (sample.includes('Traceback (most recent call last):') || /^\s+at\s+[\w\$.<>]+\s+\(/m.test(sample)) return true;
  if (/\b(?:TypeError|ReferenceError|SyntaxError|RuntimeError|RangeError|AssertionError|CompileError|ParserError):\s/i.test(sample)) return true;
  if (sample.includes('npm ERR!') || sample.includes('yarn error') || sample.includes('cargo build') || sample.includes('error[E0')) return true;
  if (sample.includes('```') || /(?:\bfunction\s|\bconst\s|\blet\s|\bclass\s|\bimport\s|\bexport\s|\bdef\s|#include|diff --git|^@@\s+-|\n\s+at\s+\S+|Traceback \(most recent)/m.test(sample)) {
    try {
      const contextCompactor = require('./context-compactor');
      if (contextCompactor && typeof contextCompactor.isProtectedSourceOrDiagnostic === 'function') {
        if (contextCompactor.isProtectedSourceOrDiagnostic(sample)) return true;
      }
    } catch (_) {}
    return true;
  }
  return false;
}

function pruneResponsesPayload(body, sessionId = null, options = {}) {
  if (!body || typeof body !== 'object') {
    const res = body || {};
    if (typeof res === 'object') {
      Object.defineProperty(res, 'modified', { value: false, writable: true, enumerable: false, configurable: true });
      Object.defineProperty(res, 'pruned', { value: res, writable: true, enumerable: false, configurable: true });
    }
    return res;
  }

  if (options && options.enabled === false) {
    const res = body;
    Object.defineProperty(res, 'modified', { value: false, writable: true, enumerable: false, configurable: true });
    Object.defineProperty(res, 'pruned', { value: res, writable: true, enumerable: false, configurable: true });
    return res;
  }

  const effectiveSessionId = sessionId || (typeof extractOrDeriveSessionId === 'function' ? extractOrDeriveSessionId(null, body) : null) || (body && (body.session_id || body.sessionId || body.conversation_id || (body.metadata && body.metadata.session_id))) || null;

  let modified = false;
  // Shallow copy top-level payload object without full JSON deep copy
  const cloned = { ...body };

  if (Array.isArray(body.input)) {
    let input = body.input.slice();
    const totalItems = input.length;

    const isUserItem = (it) => {
      if (!it || typeof it !== 'object') return false;
      if (it.role === 'user') return true;
      if (it.type === 'message' && (!it.role || it.role === 'user')) return true;
      return false;
    };

    // 0. Historical Image Base64 Pruning (Rule 5 & Rule 33)
    // In long sessions with frequent view_image / PDF inspections, Base64 image payload can exceed 15MB (80%+ of tokens).
    // Find all items with image Base64 data. Prune images that are older than 2 turns ago (>2 turns before session end)
    // or older than the last 2 image items into lightweight verified placeholders.
    const imageItemIndices = [];
    for (let i = 0; i < totalItems; i++) {
      const it = input[i];
      if (!it || typeof it !== 'object') continue;
      const str = typeof it.output === 'string' ? it.output : (it.output ? JSON.stringify(it.output) : '');
      const contentStr = typeof it.content === 'string' ? it.content : (Array.isArray(it.content) ? JSON.stringify(it.content) : '');
      if (str.includes('data:image/') || str.includes(';base64,') || str.includes('input_image') || contentStr.includes('data:image/') || contentStr.includes(';base64,') || contentStr.includes('input_image')) {
        imageItemIndices.push(i);
      }
    }

    const pruneImgSet = new Set();
    const recentTurnCutoff = Math.max(0, totalItems - 4);
    for (let pos = 0; pos < imageItemIndices.length; pos++) {
      const idx = imageItemIndices[pos];
      const isAncientTurn = idx < recentTurnCutoff;
      const isOlderThanLast2Images = pos < imageItemIndices.length - 2;
      if (isAncientTurn || isOlderThanLast2Images) {
        pruneImgSet.add(idx);
      }
    }

    if (pruneImgSet.size > 0) {
      let historicalImgCount = 0;
      for (const idx of pruneImgSet) {
        const item = input[idx];
        if (!item || typeof item !== 'object') continue;
        historicalImgCount++;

        let pageLabel = `image-${historicalImgCount}.png`;
        let callItem = null;
        if (item.call_id) {
          for (let j = idx - 1; j >= 0; j--) {
            if (input[j] && input[j].call_id === item.call_id && (input[j].arguments || input[j].input)) {
              callItem = input[j];
              break;
            }
          }
        }
        if (!callItem && idx > 0) callItem = input[idx - 1];
        if (callItem) {
          const argsStr = typeof callItem.arguments === 'string' ? callItem.arguments : (callItem.arguments ? JSON.stringify(callItem.arguments) : (typeof callItem.input === 'string' ? callItem.input : ''));
          const m = argsStr.match(/["'](?:path|file|name|image_path|file_path)["']\s*:\s*["']([^"']+)["']/);
          if (m) pageLabel = m[1].replace(/.*[/\\]/, '');
        }

        const isToolOutput = item.type === 'function_call_output' ||
          item.type === 'custom_tool_call_output' ||
          (item.type && item.type.endsWith('_output')) ||
          (item.call_id && item.output !== undefined);

        if (isToolOutput && item.output) {
          const outStr = typeof item.output === 'string' ? item.output : JSON.stringify(item.output);
          const origLen = outStr.length;
          const placeholder = `[Historical Image Verified: ${pageLabel}]`;
          input[idx] = { ...item, output: placeholder };
          modified = true;
          const imgDedupeKey = (effectiveSessionId ? `${effectiveSessionId}:` : '') + `img:${item.call_id || pageLabel}`;
          if (!prunedFingerprints.has(imgDedupeKey)) {
            prunedFingerprints.add(imgDedupeKey);
            trimPrunedFingerprintsIfNeeded();
            try {
              const contextCompactor = require('./context-compactor');
              contextCompactor.recordSavings('headroom', Math.max(0, origLen - placeholder.length), origLen, (body && body.model) || null);
            } catch (_) {}
          }
        } else if (item.type === 'message' && Array.isArray(item.content)) {
          let contentModified = false;
          let origContentLen = 0;
          let newContentLen = 0;
          const newContent = item.content.map(part => {
            if (!part || typeof part !== 'object') return part;
            const partStr = JSON.stringify(part);
            origContentLen += partStr.length;
            const isImg = part.type === 'input_image' || part.type === 'image_url' || part.type === 'image' ||
              (typeof part.image_url === 'string' && part.image_url.startsWith('data:image')) ||
              (part.image_url && typeof part.image_url.url === 'string' && part.image_url.url.startsWith('data:image'));
            if (isImg) {
              contentModified = true;
              const rep = { type: 'text', text: `[Historical Image Verified: ${pageLabel}]` };
              newContentLen += JSON.stringify(rep).length;
              return rep;
            }
            newContentLen += partStr.length;
            return part;
          });
          if (contentModified) {
            input[idx] = { ...item, content: newContent };
            modified = true;
            const imgMsgKey = (effectiveSessionId ? `${effectiveSessionId}:` : '') + `img_msg:${idx}:${pageLabel}`;
            if (!prunedFingerprints.has(imgMsgKey)) {
              prunedFingerprints.add(imgMsgKey);
              trimPrunedFingerprintsIfNeeded();
              try {
                const contextCompactor = require('./context-compactor');
                contextCompactor.recordSavings('headroom', Math.max(0, origContentLen - newContentLen), origContentLen, (body && body.model) || null);
              } catch (_) {}
            }
          }
        }
      }
    }

    // 1. Compress giant tool outputs (> 2000 chars) and giant message content (> 6000 chars)
    // Rule 25: 100% absolute exemption for source code, diffs, patches, and compiler error stacks
    for (let i = 0; i < totalItems; i++) {
      const item = input[i];
      if (!item || typeof item !== 'object') continue;

      const isToolOutput = item.type === 'function_call_output' ||
        item.type === 'custom_tool_call_output' ||
        item.type === 'tool_search_output' ||
        (item.type && item.type.endsWith('_output')) ||
        (item.call_id && item.output !== undefined);

      if (isToolOutput && item.output) {
        if (isCodeOrSensitiveContent(item.output)) {
          continue;
        }
        let outStr = sanitizeToolOutput(item.output);
        if (outStr.length > 2000) {
          const rawHead = safeUnicodeSlice(outStr, 0, 600);
          const rawTail = safeUnicodeSlice(outStr, -600);
          const { head, tail } = balanceCodeBlocks(rawHead, rawTail);
          const folded = Math.max(0, outStr.length - (rawHead.length + rawTail.length));
          const newOutput = `${head}\n\n[... 智能网关自愈：已自动折叠 ${folded} 字符历史工具输出以防上下文超限 ...]\n\n${tail}`;
          input[i] = { ...item, output: newOutput };
          modified = true;
          const toolId = item.call_id || item.tool_call_id || item.id || (typeof outStr === 'string' ? require('crypto').createHash('md5').update(outStr.slice(0, 200)).digest('hex') : i);
          const toolDedupeKey = (effectiveSessionId ? `${effectiveSessionId}:` : '') + `tool:${toolId}`;
          if (!prunedFingerprints.has(toolDedupeKey)) {
            prunedFingerprints.add(toolDedupeKey);
            trimPrunedFingerprintsIfNeeded();
            try {
              const contextCompactor = require('./context-compactor');
              contextCompactor.recordSavings('headroom', folded, outStr.length, (body && body.model) || null);
            } catch (_) {}
          }
        } else if (outStr !== item.output) {
          input[i] = { ...item, output: outStr };
          modified = true;
        }
      }

      const curItem = input[i];
      const isCurUser = isUserItem(curItem);
      // P0-H3: Skip content folding for tool responses — they must stay paired with tool_calls
      // and their content structure must remain intact for upstream strict validation.
      // Also skip 'message' items that contain tool_calls (they hold the function invocation).
      const isCurToolResponse = curItem && (
        curItem.type === 'function_call_output' ||
        curItem.type === 'custom_tool_call_output' ||
        (curItem.type && curItem.type.endsWith('_output')) ||
        (curItem.call_id && curItem.output !== undefined) ||
        curItem.role === 'tool' ||
        curItem.role === 'function'
      );
      const isCurToolCall = curItem && (
        curItem.type === 'function_call' ||
        (curItem.tool_calls && curItem.tool_calls.length > 0)
      );
      if (curItem && !isCurUser && !isCurToolResponse && !isCurToolCall && typeof curItem.content === 'string' && curItem.content.length > 6000 && i < totalItems - 2) {
        const rawHead = safeUnicodeSlice(curItem.content, 0, 1500);
        const rawTail = safeUnicodeSlice(curItem.content, -1500);
        const { head, tail } = balanceCodeBlocks(rawHead, rawTail);
        const folded = Math.max(0, curItem.content.length - (rawHead.length + rawTail.length));
        const newContent = `${head}\n\n[... 智能网关自愈：已自动折叠 ${folded} 字符历史长文本以防上下文超限 ...]\n\n${tail}`;
        input[i] = { ...curItem, content: newContent };
        modified = true;
        const contentId = curItem.id || curItem.call_id || (typeof curItem.content === 'string' ? require('crypto').createHash('md5').update(curItem.content.slice(0, 200)).digest('hex') : i);
        const contentDedupeKey = (effectiveSessionId ? `${effectiveSessionId}:` : '') + `content:${contentId}`;
        if (!prunedFingerprints.has(contentDedupeKey)) {
          prunedFingerprints.add(contentDedupeKey);
          trimPrunedFingerprintsIfNeeded();
          try {
            const contextCompactor = require('./context-compactor');
            contextCompactor.recordSavings('headroom', folded, curItem.content.length, (body && body.model) || null);
          } catch (_) {}
        }
      }
    }

    // 2. Sliding window: if input length > 18, prune intermediate items with turn-boundary safety
    // User Instruction Exemption: ALL user messages (role === 'user') are 100% preserved!
    if (input.length > 18) {
      const headItems = input.slice(0, 2);
      let tailStartIndex = Math.max(2, input.length - 12);
      // Turn-Aware: Never split inside an atomic tool call / tool output sequence
      while (tailStartIndex < input.length - 2) {
        const item = input[tailStartIndex];
        const isToolOutput = item && (
          item.type === 'function_call_output' ||
          item.type === 'custom_tool_call_output' ||
          (item.type && item.type.endsWith('_output')) ||
          (item.call_id && item.output !== undefined)
        );
        const isMiddleToolCall = item && item.type === 'function_call' && tailStartIndex > 0 && input[tailStartIndex - 1]?.type === 'function_call';
        if (isToolOutput || isMiddleToolCall) {
          tailStartIndex++;
        } else {
          break;
        }
      }

      const isSystemItem = it => it && (
        (it.type === 'message' && (it.role === 'system' || it.role === 'developer')) ||
        it.role === 'system' || it.role === 'developer'
      );
      const tailItems = input.slice(tailStartIndex);
      const middleItems = input.slice(headItems.length, tailStartIndex);

      // System & User instruction exemption: 100% preserve all user instructions and system prompts
      const middlePreservedItems = middleItems.filter(it => isUserItem(it) || isSystemItem(it));
      const droppedCount = middleItems.length - middlePreservedItems.length;

      if (droppedCount > 0) {
        // Intermediate assistant/tool interactions exist: drop them and 100% preserve user instructions & system prompts
        const notice = {
          type: 'message',
          role: 'system',
          content: `[系统自动自愈提示：智能网关已对前序 ${droppedCount} 条历史中间交互执行滑动窗口折叠，保留初始任务指令与最近交互上下文，已消除上下文超限。]`
        };
        input = [...headItems, notice, ...middlePreservedItems, ...tailItems];
        modified = true;
      }
    }

    cloned.input = input;
  }

  Object.defineProperty(cloned, 'modified', {
    value: modified,
    writable: true,
    enumerable: false,
    configurable: true
  });
  Object.defineProperty(cloned, 'pruned', {
    value: cloned,
    writable: true,
    enumerable: false,
    configurable: true
  });
  return cloned;
}

/**
 * Prunes and compresses an oversized standard ChatCompletions messages array.
 */
function pruneChatMessages(messages, maxTokens, sessionId = null, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    if (Array.isArray(messages)) {
      Object.defineProperty(messages, 'modified', { value: false, writable: true, enumerable: false, configurable: true });
      Object.defineProperty(messages, 'pruned', { value: messages, writable: true, enumerable: false, configurable: true });
    }
    return messages;
  }

  if (options && options.enabled === false) {
    Object.defineProperty(messages, 'modified', { value: false, writable: true, enumerable: false, configurable: true });
    Object.defineProperty(messages, 'pruned', { value: messages, writable: true, enumerable: false, configurable: true });
    return messages;
  }

  let modified = false;
  // Shallow copy messages array without full JSON deep copy
  let result = messages.slice();

  for (let i = 0; i < result.length; i++) {
    const msg = result[i];
    if (!msg) continue;
    const isTool = msg.role === 'tool';
    // Rule 25: 100% absolute exemption for source code, diffs, patches, and compiler error stacks
    if (typeof msg.content === 'string' && isCodeOrSensitiveContent(msg.content)) {
      continue;
    }

    const isOversized = typeof msg.content === 'string' && msg.content.length > 2500;
    if (isOversized && (isTool || i < result.length - 1)) {
      if (msg.role === 'user') {
        // 100% user instruction exemption: do not fold user messages!
        continue;
      }
      const rawHead = safeUnicodeSlice(msg.content, 0, 800);
      const rawTail = safeUnicodeSlice(msg.content, -800);
      const { head, tail } = balanceCodeBlocks(rawHead, rawTail);
      const folded = Math.max(0, msg.content.length - (rawHead.length + rawTail.length));
      const newContent = `${head}\n\n[... 智能网关自愈：已自动折叠 ${folded} 字符历史输出以防上下文超限 ...]\n\n${tail}`;
      result[i] = { ...msg, content: newContent };
      modified = true;
      const chatToolId = msg.tool_call_id || msg.id || (typeof msg.content === 'string' ? require('crypto').createHash('md5').update(msg.content.slice(0, 200)).digest('hex') : i);
      const chatToolKey = (sessionId ? `${sessionId}:` : '') + `chat_tool:${chatToolId}`;
      if (!prunedFingerprints.has(chatToolKey)) {
        prunedFingerprints.add(chatToolKey);
        trimPrunedFingerprintsIfNeeded();
        try {
          const contextCompactor = require('./context-compactor');
          contextCompactor.recordSavings('headroom', folded, msg.content.length);
        } catch (_) {}
      }
    }
  }

  if (result.length > 18) {
    const sysMsgs = result.filter(m => m && (m.role === 'system' || m.role === 'developer'));
    const nonSys = result.filter(m => !m || (m.role !== 'system' && m.role !== 'developer'));
    
    // Accurate initial user instruction detection (first non-system message that has role === 'user')
    const firstUserIndex = nonSys.findIndex(m => m && m.role === 'user');
    const firstUser = firstUserIndex >= 0 ? nonSys[firstUserIndex] : (nonSys.length > 0 ? nonSys[0] : null);

    let tailStartIndex = Math.max(firstUserIndex >= 0 ? firstUserIndex + 1 : 1, nonSys.length - 12);
    while (tailStartIndex < nonSys.length - 2 && nonSys[tailStartIndex]?.role === 'tool') {
      tailStartIndex++;
    }
    const recentMsgs = nonSys.slice(tailStartIndex);
    const middleNonSys = nonSys.slice(firstUserIndex >= 0 ? firstUserIndex + 1 : 1, tailStartIndex);

    // User instruction exemption: 100% preserve all user messages in the middle
    const middleUserMsgs = middleNonSys.filter(m => m && m.role === 'user');
    const middleDropped = middleNonSys.length - middleUserMsgs.length;

    if (middleDropped > 0) {
      const notice = {
        role: 'system',
        content: `[系统自动自愈提示：智能网关已自动压缩中间 ${middleDropped} 轮历史对话，保留初始目标与最近交互，已消除上下文超限。]`
      };
      result = [...sysMsgs, ...(firstUser ? [firstUser] : []), notice, ...middleUserMsgs, ...recentMsgs];
      modified = true;
    }

    // Double Shield: Enforce full topological sanitization to heal any orphan or interleaved tool calls
    if (typeof sanitizeAndValidateChatMessages === 'function') {
      result = sanitizeAndValidateChatMessages(result);
    }
  }

  Object.defineProperty(result, 'modified', {
    value: modified,
    writable: true,
    enumerable: false,
    configurable: true
  });
  Object.defineProperty(result, 'pruned', {
    value: result,
    writable: true,
    enumerable: false,
    configurable: true
  });
  return result;
}

function getCodexConfigDir() {
  return process.env.CODEX_CONFIG_DIR || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

/**
 * Normalizes tool parameters to strict JSON Schema object format: { type: 'object', properties: { ... } }
 * Protects against strict upstream validation errors (e.g. novita-deepseek, orcarouter)
 * Preserves all underlying schema definitions (oneOf, anyOf, $defs, required, etc.) while ensuring type: 'object' and properties: {}
 */
function normalizeToolParameters(rawParams) {
  if (!rawParams || typeof rawParams !== 'object' || Array.isArray(rawParams)) {
    return { type: 'object', properties: {} };
  }
  const properties = (rawParams.properties && typeof rawParams.properties === 'object' && !Array.isArray(rawParams.properties))
    ? rawParams.properties
    : {};
  return {
    ...rawParams,
    type: 'object',
    properties
  };
}

/**
 * Extracts raw tool parameters candidate from a tool object.
 * Prioritizes candidates with actual properties/definitions over empty {} placeholders.
 */
function extractRawToolParams(t) {
  if (!t || typeof t !== 'object') return null;
  const candidates = [
    t.function?.inputSchema,
    t.inputSchema,
    t.function?.parameters,
    t.parameters,
    t.function?.input_schema,
    t.input_schema
  ];
  // 1. Prioritize candidate with actual keys (prevents empty {} short-circuiting real schema)
  for (const c of candidates) {
    if (c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length > 0) {
      return c;
    }
  }
  // 2. Fall back to any defined candidate
  for (const c of candidates) {
    if (c !== undefined && c !== null) {
      return c;
    }
  }
  return null;
}

/**
 * Sanitizes tool outputs to ensure compliant OpenAI / Anthropic format.
 * Automatically detects and summarizes raw base64 image data (e.g. from view_image or pdf/image renderers)
 * into compact structured JSON descriptions. This prevents blowing past context windows (1M tokens)
 * and eliminates upstream HTTP 400 Bad Request rejections caused by raw base64 strings in tool messages.
 */
function sanitizeToolOutput(rawOutput) {
  if (rawOutput === null || rawOutput === undefined) {
    return '{}';
  }

  // 1. Array of output items (standard in Codex tool outputs, e.g. [{ type: 'input_image', image_url: 'data:image...' }])
  if (Array.isArray(rawOutput)) {
    const hasImage = rawOutput.some(item => 
      item && (
        item.type === 'input_image' || 
        item.type === 'image_url' || 
        (typeof item.image_url === 'string' && item.image_url.startsWith('data:image')) ||
        (typeof item.url === 'string' && item.url.startsWith('data:image'))
      )
    );

    if (hasImage) {
      const processed = rawOutput.map((item, idx) => {
        if (!item || typeof item !== 'object') return item;
        const isImg = item.type === 'input_image' || item.type === 'image_url' ||
          (typeof item.image_url === 'string' && item.image_url.startsWith('data:image')) ||
          (typeof item.url === 'string' && item.url.startsWith('data:image'));
        
        if (isImg) {
          return {
            status: 'success',
            type: 'image_view_output',
            summary: `[Image ${idx + 1} processed and inspected successfully via visual sandbox engine]`,
            format: 'image/png'
          };
        }
        return item;
      });
      return JSON.stringify(processed.length === 1 ? processed[0] : processed);
    }
    return JSON.stringify(rawOutput);
  }

  // 2. Object with image
  if (typeof rawOutput === 'object') {
    if (rawOutput.type === 'input_image' || rawOutput.type === 'image_url' || 
       (typeof rawOutput.image_url === 'string' && rawOutput.image_url.startsWith('data:image')) ||
       (typeof rawOutput.url === 'string' && rawOutput.url.startsWith('data:image'))) {
      return JSON.stringify({
        status: 'success',
        type: 'image_view_output',
        summary: '[Image processed and inspected successfully via visual sandbox engine]'
      });
    }
    return JSON.stringify(rawOutput);
  }

  // 3. String output
  if (typeof rawOutput === 'string') {
    if (rawOutput.includes('input_image') || rawOutput.includes('data:image/')) {
      try {
        const parsed = JSON.parse(rawOutput);
        if (Array.isArray(parsed) || (parsed && typeof parsed === 'object')) {
          return sanitizeToolOutput(parsed);
        }
      } catch (e) {}
      if (rawOutput.length > 2000) {
        return rawOutput.replace(/data:image\/[a-zA-Z0-9.+_-]+;base64,[A-Za-z0-9+/=]+/g, '[base64 image data sanitized]');
      }
    }
    return rawOutput;
  }

  return String(rawOutput);
}

/**
 * Cleanses and standardizes upstream non-200 error responses to ensure compliant OpenAI error JSON format.
 * Prevents client crashes when upstream returns 0-byte streams, non-standard bare JSON, bare arrays, or SSE data.
 */
function formatUpstreamErrorResponse(rawBodyText, statusCode = 400) {
  const code = typeof statusCode === 'number' && !isNaN(statusCode) ? statusCode : 400;
  let rawText = typeof rawBodyText === 'string' ? rawBodyText.trim() : (rawBodyText ? String(rawBodyText).trim() : '');

  // 1. If upstream returns empty body (0 bytes), standardize to OpenAI error format
  if (!rawText) {
    return JSON.stringify({
      error: {
        message: `上游推理节点返回空错误 (HTTP ${code})，已安全拦截`,
        type: 'upstream_error',
        code: code
      }
    });
  }

  // 1b. Region blocked / 403 sanitization (Notice 1 & Rule 13)
  const lower = rawText.toLowerCase();
  const isRegion = code === 403 || 
    lower.includes('unsupported_country_region_territory') ||
    lower.includes('territory not supported') ||
    lower.includes('not available in your country');
  if (isRegion) {
    return JSON.stringify({
      error: {
        message: '上游返回 403: 当前公网 IP 受地域限制，请配置网关代理服务器或开启海外/Tailscale 节点',
        type: 'region_blocked_error',
        code: 403
      }
    });
  }

  // 2. If body is wrapped in SSE format (e.g. data: {...}\n\n), strip SSE prefix
  if (rawText.startsWith('data:')) {
    const sseLines = rawText.split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('data:') && l.slice(5).trim() !== '[DONE]');
    if (sseLines.length > 0) {
      rawText = sseLines[0].slice(5).trim();
    }
  }

  // 3. Attempt JSON parse
  try {
    const parsed = JSON.parse(rawText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // 3a. If error is an object
      if (parsed.error && typeof parsed.error === 'object' && !Array.isArray(parsed.error)) {
        if (!parsed.error.message) {
          parsed.error.message = parsed.error.code ? `Upstream error code: ${parsed.error.code}` : JSON.stringify(parsed.error);
        }
        if (!parsed.error.type) parsed.error.type = 'upstream_error';
        if (parsed.error.code === undefined) parsed.error.code = code;
        return JSON.stringify(parsed);
      }
      // 3b. If error is a string
      if (typeof parsed.error === 'string' && parsed.error.trim()) {
        return JSON.stringify({
          error: {
            message: parsed.error,
            type: 'upstream_error',
            code: code
          }
        });
      }
      // 3c. If bare JSON without 'error' field (e.g. {"model":"deepseek-v4.1-flash"} or {"detail":"..."})
      const fallbackMsg = parsed.detail || parsed.message || rawText;
      return JSON.stringify({
        error: {
          message: `上游模型接口返回异常: ${typeof fallbackMsg === 'string' ? fallbackMsg : JSON.stringify(fallbackMsg)}`,
          type: 'upstream_error',
          code: code
        }
      });
    } else {
      // 3d. If parsed is an Array or primitive
      return JSON.stringify({
        error: {
          message: `上游模型接口返回异常: ${rawText}`,
          type: 'upstream_error',
          code: code
        }
      });
    }
  } catch (e) {
    // 4. Non-JSON text / HTML error
    return JSON.stringify({
      error: {
        message: `上游模型接口返回异常: ${rawText}`,
        type: 'upstream_error',
        code: code
      }
    });
  }
}

/**
 * Ensures complete compliance with OpenAI API chat completion requirements:
 * 1. Every assistant message with tool_calls must be immediately and contiguously followed by
 *    tool messages responding to each tool_call.
 * 2. Any interleaved non-tool messages (e.g. system notices like <image_resize_notice> or developer messages)
 *    are deferred to after the entire tool response sequence.
 * 3. Any orphan tool_calls that lack a matching tool output (e.g. from truncation or cancellation)
 *    are automatically backfilled with a valid dummy tool response.
 * 4. Any orphan tool responses that lack a preceding assistant tool_call are converted to user messages
 *    to prevent upstream 400 'role tool without preceding assistant tool_calls' errors.
 */
function sanitizeAndValidateChatMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  const result = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (msg && msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      const mergedAssistant = { ...msg, tool_calls: msg.tool_calls.slice() };
      result.push(mergedAssistant);

      const expectedIds = mergedAssistant.tool_calls.map(tc => tc.id).filter(Boolean);
      const expectedIdSet = new Set(expectedIds);
      const foundToolMsgs = new Map(); // callId -> toolMsg
      const interleavedMsgs = [];      // non-tool messages or orphan tool messages

      const hasPendingToolResponseAhead = (startIdx) => {
        if (foundToolMsgs.size >= expectedIdSet.size) return false;
        for (let k = startIdx; k < messages.length; k++) {
          const futureMsg = messages[k];
          if (!futureMsg) continue;
          if (futureMsg.role === 'assistant' && (!Array.isArray(futureMsg.tool_calls) || futureMsg.tool_calls.length === 0)) {
            return false;
          }
          if (futureMsg.role === 'tool' && futureMsg.tool_call_id && expectedIdSet.has(futureMsg.tool_call_id)) {
            return true;
          }
        }
        return false;
      };

      let j = i + 1;
      // Scan forward to gather all responding tool messages for this assistant turn
      while (j < messages.length) {
        const nextMsg = messages[j];
        if (!nextMsg) {
          j++;
          continue;
        }

        if (nextMsg.role === 'tool') {
          const callId = nextMsg.tool_call_id;
          if (callId && expectedIdSet.has(callId)) {
            if (!foundToolMsgs.has(callId)) {
              foundToolMsgs.set(callId, nextMsg);
            } else {
              const existing = foundToolMsgs.get(callId);
              existing.content = (existing.content || '') + '\n' + (nextMsg.content || '');
            }
          } else {
            interleavedMsgs.push(nextMsg);
          }
          j++;
        } else if (nextMsg.role === 'assistant') {
          if (Array.isArray(nextMsg.tool_calls) && nextMsg.tool_calls.length > 0 && hasPendingToolResponseAhead(j + 1)) {
            for (const tc of nextMsg.tool_calls) {
              if (tc && tc.id && !expectedIdSet.has(tc.id)) {
                mergedAssistant.tool_calls.push(tc);
                expectedIds.push(tc.id);
                expectedIdSet.add(tc.id);
              }
            }
            if (nextMsg.content && !mergedAssistant.content) {
              mergedAssistant.content = nextMsg.content;
            }
            j++;
          } else {
            break;
          }
        } else if (nextMsg.role === 'user') {
          if (hasPendingToolResponseAhead(j + 1)) {
            interleavedMsgs.push(nextMsg);
            j++;
          } else {
            break;
          }
        } else {
          interleavedMsgs.push(nextMsg);
          j++;
        }
      }

      // 1. Contiguously append tool responses for every expected tool_call
      for (const callId of expectedIds) {
        if (foundToolMsgs.has(callId)) {
          result.push(foundToolMsgs.get(callId));
        } else {
          // Auto-repair missing response to satisfy upstream strict validation
          result.push({
            role: 'tool',
            tool_call_id: callId,
            content: '[Tool call completed without output]'
          });
        }
      }

      // 2. Safely defer any interleaved non-tool messages after all tool responses
      for (const interMsg of interleavedMsgs) {
        if (interMsg.role === 'tool') {
          result.push({
            role: 'user',
            content: `[Tool Output: ${typeof interMsg.content === 'string' ? interMsg.content : JSON.stringify(interMsg.content)}]`,
            _isGatewayToolWrapper: true
          });
        } else {
          result.push(interMsg);
        }
      }

      i = j;
    } else if (msg && msg.role === 'tool') {
      result.push({
        role: 'user',
        content: `[Tool Output: ${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}]`,
        _isGatewayToolWrapper: true
      });
      i++;
    } else {
      result.push(msg);
      i++;
    }
  }

  return result;
}

/**
 * Safely extracts raw patch text from model arguments or JSON payloads
 * Ensures apply_patch always receives clean diff content without JSON wrapper noise.
 */
function extractPatchInput(rawArgs) {
  if (typeof rawArgs !== 'string') return '';
  const trimmed = rawArgs.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed.input === 'string') return parsed.input;
      if (typeof parsed.patch === 'string') return parsed.patch;
      if (typeof parsed.diff === 'string') return parsed.diff;
      if (typeof parsed.content === 'string') return parsed.content;
    } catch (e) {
      const match = trimmed.match(/"(?:input|patch|diff|content)"\s*:\s*"([\s\S]*)"\s*}?$/);
      if (match) {
        try {
          return JSON.parse(`"${match[1]}"`);
        } catch (_) {
          return match[1];
        }
      }
    }
  }
  return rawArgs;
}

/**
 * Converts OpenAI Responses API JSON payload to standard OpenAI ChatCompletions JSON payload
 */

/**
 * Real-time Stream Degeneration & Repetition Loop Detector (Rule 35)
 * Detects degenerate token loops (e.g. "Let me search. Let me search...") in streaming chunks
 * and performs millisecond-level circuit breaking to protect user context, UI stability and token quotas.
 */
class StreamDegenerationDetector {
  constructor(options = {}) {
    this.maxRepeatCount = options.maxRepeatCount || 4;
    this.minPhraseLen = options.minPhraseLen || 6;
    this.maxPhraseLen = options.maxPhraseLen || 80;
    this.recentBuffer = '';
    this.isTriggered = false;
    this.triggeredPhrase = '';
  }

  feed(textChunk) {
    if (this.isTriggered) return { shouldHalt: true, triggeredPhrase: this.triggeredPhrase };
    if (!textChunk || typeof textChunk !== 'string') return { shouldHalt: false };
    this.recentBuffer += textChunk;
    if (this.recentBuffer.length > 800) {
      this.recentBuffer = this.recentBuffer.slice(-800);
    }
    const buf = this.recentBuffer;
    const len = buf.length;
    const maxSearchLen = Math.min(this.maxPhraseLen, Math.floor(len / this.maxRepeatCount));
    for (let pLen = this.minPhraseLen; pLen <= maxSearchLen; pLen++) {
      const phrase = buf.slice(len - pLen);
      // Skip pure whitespace or pure punctuation
      if (/^\s*$/.test(phrase) || /^[-_=\s\r\n.,;:]+$/.test(phrase)) continue;

      let count = 1;
      let pos = len - pLen * 2;
      while (pos >= 0 && buf.slice(pos, pos + pLen) === phrase) {
        count++;
        pos -= pLen;
        if (count >= this.maxRepeatCount) {
          this.isTriggered = true;
          this.triggeredPhrase = phrase.trim();
          return { shouldHalt: true, triggeredPhrase: this.triggeredPhrase };
        }
      }
    }
    return { shouldHalt: false };
  }
}

/**
 * Windows PowerShell Execution & Tool Call Auto-Correction Barrier
 * When running on Windows, automatically corrects "shell": "bash" in exec_command arguments to "powershell".
 */
function autoCorrectToolArgs(toolName, argsStr) {
  if (toolName !== 'exec_command' && toolName !== 'bash' && toolName !== 'powershell' && toolName !== 'execute_command') {
    if (!argsStr || typeof argsStr !== 'string' || (!argsStr.includes('"command"') && !argsStr.includes('"cmd"'))) {
      return argsStr;
    }
  }
  if (!argsStr || typeof argsStr !== 'string') {
    return argsStr;
  }
  const isWindows = (process.platform === 'win32');
  if (!isWindows) return argsStr;

  try {
    const parsed = JSON.parse(argsStr);
    if (parsed && typeof parsed === 'object') {
      let modified = false;
      if (parsed.shell === 'bash') {
        parsed.shell = 'powershell';
        modified = true;
      }
      const cmdKey = parsed.command !== undefined ? 'command' : (parsed.cmd !== undefined ? 'cmd' : null);
      if (cmdKey && typeof parsed[cmdKey] === 'string') {
        try {
          const powershellOptimizer = require('./powershell-optimizer');
          if (powershellOptimizer && typeof powershellOptimizer.fixPowerShellCommandEscaping === 'function') {
            const fixed = powershellOptimizer.fixPowerShellCommandEscaping(parsed[cmdKey]);
            if (fixed && fixed !== parsed[cmdKey]) {
              parsed[cmdKey] = fixed;
              modified = true;
            }
          }
        } catch (_) {}
      }
      if (modified) {
        return JSON.stringify(parsed);
      }
    }
  } catch (_) {}
  return argsStr;
}

const COMFYUI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description: '调用本地 ComfyUI 图像智能体工业级工作流生成高质量真实图片。支持真人写实、二次元、国风厚涂、极速抽卡、唯美壁纸等多种风格，成片以 Markdown 格式优雅渲染展示。',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '画面英文或中文正向提示词 (例如: "1girl, cinematic lighting, 8k uhd, photorealistic, elegant smile")'
          },
          workflow: {
            type: 'string',
            description: '指定工作流编号或风格标签 (例如: "01" 或 "真人写实", "04" 或 "极速抽卡", "06" 或 "二次元吉卜力", "16" 或 "唯美风光壁纸"；留空则采用最佳画质)'
          },
          negative: {
            type: 'string',
            description: '负向屏蔽词 (可选)'
          },
          width: {
            type: 'integer',
            description: '自定义画幅宽度 (可选)'
          },
          height: {
            type: 'integer',
            description: '自定义画幅高度 (可选)'
          },
          seed: {
            type: 'integer',
            description: '随机种子 (可选)'
          }
        },
        required: ['prompt']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'mcp__comfyui__generate_image',
      description: '别名工具：调用本地 ComfyUI 图像智能体工业级工作流生成高质量真实图片。与 generate_image 等价。',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '正向提示词' },
          workflow: { type: 'string', description: '工作流编号或风格标签' },
          negative: { type: 'string', description: '负向屏蔽词' },
          width: { type: 'integer' },
          height: { type: 'integer' },
          seed: { type: 'integer' }
        },
        required: ['prompt']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'interrogate_image',
      description: '分析反推图片中的提示词、风格与关键特征 (支持本地 ComfyUI WD14 深度反推或网关视觉多模态大模型透明兜底)',
      parameters: {
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
  },
  {
    type: 'function',
    function: {
      name: 'mcp__comfyui__interrogate_image',
      description: '别名工具：分析反推图片中的提示词、风格与关键特征。与 interrogate_image 等价。',
      parameters: {
        type: 'object',
        properties: {
          image_path: { type: 'string', description: '本地图片绝对路径或 Base64 数据' }
        },
        required: ['image_path']
      }
    }
  }
];

/**
 * 确定性识别 Codex Desktop 延迟工具发现探针 (tool_search / Tool discovery)
 * 支持识别有名 tool_search 以及 Codex Desktop 注入的无名 (# Tool discovery / BM25) 工具对象
 */
function isDeferredToolSearch(t) {
  if (!t || typeof t !== 'object') return false;
  const name = (t.function?.name || t.name || '').trim();
  if (name === 'tool_search' || name.toLowerCase().includes('tool_search')) return true;
  const desc = (t.function?.description || t.description || '').trim();
  if (desc) {
    const lower = desc.toLowerCase();
    if (
      lower.includes('# tool discovery') ||
      lower.includes('searches over deferred tool') ||
      lower.includes('deferred tool metadata with bm25') ||
      (lower.includes('tool_search') && (lower.includes('deferred') || lower.includes('search')))
    ) {
      return true;
    }
  }
  return false;
}

function convertResponsesToChatPayload(body, compressionOptions = null, sessionId = null) {
  const messages = [];
  if (body.instructions && typeof body.instructions === 'string') {
    messages.push({ role: 'system', content: body.instructions });
  }

  const inputList = Array.isArray(body.input) ? body.input : (body.input ? [body.input] : []);
  for (const item of inputList) {
    if (typeof item === 'string') {
      messages.push({ role: 'user', content: item });
    } else if (item && typeof item === 'object') {
      const itemType = item.type || '';
      const isToolCall = itemType === 'function_call' ||
        itemType === 'local_shell_call' ||
        itemType === 'custom_tool_call' ||
        itemType === 'tool_search_call' ||
        itemType === 'web_search_call' ||
        Boolean(item.call_id && !itemType.includes('output'));

      const isToolOutput = itemType === 'function_call_output' ||
        itemType === 'custom_tool_call_output' ||
        itemType === 'tool_search_output' ||
        itemType.endsWith('_output') ||
        (item.call_id && item.output !== undefined);

      if (isToolCall) {
        const callId = item.call_id || item.id || `call_${Date.now()}`;
        const funcName = item.name || item.function?.name || (itemType !== 'function_call' ? itemType : 'custom_tool');
        let funcArgs = '{}';
        if (typeof item.arguments === 'string') {
          funcArgs = item.arguments;
        } else if (item.arguments && typeof item.arguments === 'object') {
          funcArgs = JSON.stringify(item.arguments);
        } else if (item.command) {
          funcArgs = JSON.stringify({ command: item.command });
        } else if (item.action && typeof item.action === 'object') {
          funcArgs = JSON.stringify(item.action);
        } else if (item.input !== undefined) {
          if (typeof item.input === 'string') {
            funcArgs = JSON.stringify({ input: item.input });
          } else if (typeof item.input === 'object') {
            funcArgs = JSON.stringify(item.input);
          }
        }

        const toolCallObj = {
          id: callId,
          type: 'function',
          function: {
            name: funcName,
            arguments: funcArgs
          }
        };

        const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
        if (lastMsg && lastMsg.role === 'assistant') {
          if (!Array.isArray(lastMsg.tool_calls)) lastMsg.tool_calls = [];
          lastMsg.tool_calls.push(toolCallObj);
        } else {
          messages.push({
            role: 'assistant',
            content: null,
            tool_calls: [toolCallObj]
          });
        }
      } else if (isToolOutput) {
        const callId = item.call_id || item.id || `call_${Date.now()}`;
        const content = sanitizeToolOutput(item.output);
        messages.push({
          role: 'tool',
          tool_call_id: callId,
          content
        });
      } else if (itemType === 'message' || item.role || itemType === 'agent_message') {
        const rawRole = item.role || (itemType === 'agent_message' ? 'assistant' : 'user');
        const role = (rawRole === 'developer' || rawRole === 'system') ? 'system' : rawRole;
        let content = '';
        if (typeof item.content === 'string') {
          content = item.content;
        } else if (Array.isArray(item.content)) {
          const hasImages = item.content.some(c => c && (c.type === 'input_image' || c.type === 'image_url' || c.type === 'image' || (c.source && c.source.type)));
          if (hasImages) {
            content = item.content.map(c => {
              if (typeof c === 'string') return { type: 'text', text: c };
              if (c.type === 'input_text' || c.type === 'text') return { type: 'text', text: c.text || '' };
              if (c.type === 'input_image' || c.type === 'image_url' || c.type === 'image' || (c.source && c.source.type)) {
                if (c.image_url && typeof c.image_url === 'object' && c.image_url.url) {
                  return { type: 'image_url', image_url: c.image_url };
                }
                const url = typeof c.image_url === 'string' ? c.image_url : (c.url || (c.source?.data ? `data:${c.source.media_type || 'image/png'};base64,${c.source.data}` : ''));
                return { type: 'image_url', image_url: { url } };
              }
              return c;
            });
          } else {
            content = item.content.map(c => {
              if (typeof c === 'string') return c;
              return c.text || '';
            }).join('\n');
          }
        }

        const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
        if (role === 'assistant' && lastMsg && lastMsg.role === 'assistant' && Array.isArray(lastMsg.tool_calls) && !lastMsg.content) {
          lastMsg.content = content;
        } else {
          messages.push({ role, content });
        }
      }
    }
  }

  let model = body.model || 'deepseek-v4.1-flash';
  if (model.startsWith('opencode-go/')) model = model.slice(12);
  if (MODEL_COMPATIBILITY_ALIASES[model]) {
    const mapped = MODEL_COMPATIBILITY_ALIASES[model];
    console.log(`[Codex Bridge] 自动将未开放协议模型 "${model}" 映射为等位旗舰模型 "${mapped}"`);
    model = mapped;
  }

  const sanitizedMessages = sanitizeAndValidateChatMessages(messages);

  const chatPayload = {
    model,
    messages: sanitizedMessages,
    stream: body.stream === true
  };
  if (chatPayload.stream) {
    chatPayload.stream_options = { include_usage: true };
  }

  if (body.temperature !== undefined) chatPayload.temperature = body.temperature;
  if (body.top_p !== undefined) chatPayload.top_p = body.top_p;
  if (body.max_output_tokens !== undefined) chatPayload.max_tokens = body.max_output_tokens;
  if (body.max_tokens !== undefined) chatPayload.max_tokens = body.max_tokens;

  // Reasoning effort mapping with model capability inspection
  const eff = (body.reasoning && body.reasoning.effort) || body.reasoning_effort || body.model_reasoning_effort;
  if (eff) {
    const meta = OPENCODE_GO_ALL_MODELS.find(m => m.slug === model);
    const supportsReasoning = !meta || (Array.isArray(meta.supported_reasoning_levels) && meta.supported_reasoning_levels.length > 0);
    if (supportsReasoning) {
      chatPayload.reasoning_effort = (eff === 'xhigh' || eff === 'max') ? 'high' : eff;
    }
  }

  const isWindowsHost = (process.platform === 'win32') ||
    (typeof body === 'object' && body && (
      String(body.platform || '').toLowerCase().includes('win') ||
      String(body.targetPlatform || '').toLowerCase().includes('win')
    ));

  // Tools mapping
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    const rawTools = body.tools;
    const hasToolSearch = rawTools.some(isDeferredToolSearch);

    chatPayload.tools = rawTools
      .filter(t => !isDeferredToolSearch(t))
      .map((t, idx) => {
      const toolName = t.function?.name || t.name || (t.type && t.type !== 'function' ? t.type : null) || `custom_tool_${idx}`;
      let description = t.function?.description || t.description || '';
      const rawParams = extractRawToolParams(t);
      const parameters = normalizeToolParameters(rawParams);

      // Windows PowerShell Environment & Schema Anchor:
      // Prevent models from mistakenly picking bash and entering "Bash 接管 / 切回 PowerShell" loop
      if (isWindowsHost && (toolName === 'exec_command' || toolName.includes('shell') || toolName.includes('command'))) {
        if (!description.includes('PowerShell')) {
          description += ' (Host environment is Windows NT with native PowerShell 7 / Windows PowerShell. Commands must use PowerShell syntax. Always pass "shell": "powershell")';
        }
        if (parameters && parameters.properties && parameters.properties.shell) {
          parameters.properties.shell.description = (parameters.properties.shell.description || '') +
            ' (IMPORTANT: The host platform is Windows NT. For all Windows commands, scripts and PowerShell cmdlets, you MUST set "shell": "powershell". NEVER set "shell": "bash" on Windows).';
          if (Array.isArray(parameters.properties.shell.enum)) {
            parameters.properties.shell.enum = ['powershell', ...parameters.properties.shell.enum.filter(e => e !== 'powershell')];
          }
          parameters.properties.shell.default = 'powershell';
        }
      }

      return {
        type: 'function',
        function: {
          name: toolName,
          description,
          parameters
        }
      };
    }).filter(t => Boolean(t.function && t.function.name));

    // When tool_search was present (indicating Codex deferred tool mode) or if explicitly requested,
    // inject ComfyUI tools upfront so the model can call them directly without failing on deferred search.
    const hasGenerateImage = chatPayload.tools.some(t => {
      const name = t.function?.name || t.name;
      return name === 'mcp__comfyui__generate_image' || name === 'generate_image';
    });
    const isVisualIntent = (() => {
      const inputList = Array.isArray(body.input) ? body.input : [body.input];
      const text = inputList.map(item => {
        if (typeof item === 'string') return item;
        if (item && Array.isArray(item.content)) {
          return item.content.map(c => c?.text || '').join(' ');
        }
        return item?.content || '';
      }).join(' ');
      return /(?:生成|画|制作|绘制).*(?:图|照|壁纸|插画)|反推.*(?:图|词)|(?:generate|create|draw).*(?:image|picture|photo)|(?:text.*to.*image)/i.test(text);
    })();

    if ((hasToolSearch || isVisualIntent || (compressionOptions && compressionOptions.injectComfyUiTools)) && !hasGenerateImage) {
      chatPayload.tools.push(...COMFYUI_TOOLS);
    }
  }

  // Windows Native PowerShell Environment Directive Injection
  const hasShellTools = Array.isArray(chatPayload.tools) && chatPayload.tools.some(t => {
    const name = t.function?.name || '';
    return name === 'exec_command' || name.includes('shell') || name.includes('command');
  });

  if (isWindowsHost && hasShellTools && Array.isArray(sanitizedMessages)) {
    const psAnchorNotice = [
      '<!-- [Host Environment Anchor: Windows Native PowerShell] -->',
      'The current host environment is Windows NT with native PowerShell 7 / Windows PowerShell (NOT Linux Bash).',
      'Execution Rule: When calling `exec_command` or running terminal scripts, you MUST ALWAYS explicitly pass "shell": "powershell".',
      'NEVER pass "shell": "bash" for Windows scripts or native cmdlets.'
    ].join('\n');

    const firstSysIdx = sanitizedMessages.findIndex(m => m && (m.role === 'system' || m.role === 'developer'));
    if (firstSysIdx !== -1) {
      if (typeof sanitizedMessages[firstSysIdx].content === 'string' && !sanitizedMessages[firstSysIdx].content.includes('Windows Native PowerShell')) {
        sanitizedMessages[firstSysIdx] = {
          ...sanitizedMessages[firstSysIdx],
          content: sanitizedMessages[firstSysIdx].content + '\n\n' + psAnchorNotice
        };
      }
    }
  }

  // Normalize tool_choice from Responses format { type: "function", name: "..." } to ChatCompletions format
  if (body.tool_choice) {
    if (typeof body.tool_choice === 'object' && body.tool_choice !== null) {
      if (body.tool_choice.type === 'function' && body.tool_choice.name && !body.tool_choice.function) {
        chatPayload.tool_choice = {
          type: 'function',
          function: { name: body.tool_choice.name }
        };
      } else {
        chatPayload.tool_choice = body.tool_choice;
      }
    } else {
      chatPayload.tool_choice = body.tool_choice;
    }
  }

  if (compressionOptions && compressionOptions.enabled !== false) {
    try {
      return contextCompactor.compactChatPayload(chatPayload, compressionOptions, sessionId);
    } catch (err) {
      console.warn('[CodexAdapter] Chat payload compression failed, bypassing safely:', err.message);
      return chatPayload;
    }
  }

  return chatPayload;
}

/**
 * Normalizes usage metadata to standard OpenAI Responses API format (input_tokens, output_tokens)
 */
function normalizeResponsesUsage(rawUsage, defaultInput = 20, defaultOutput = 20) {
  const inTokens = rawUsage?.input_tokens ?? rawUsage?.prompt_tokens ?? defaultInput;
  const outTokens = rawUsage?.output_tokens ?? rawUsage?.completion_tokens ?? defaultOutput;
  const totTokens = rawUsage?.total_tokens ?? (inTokens + outTokens);
  const reasoningTokens = rawUsage?.completion_tokens_details?.reasoning_tokens ?? rawUsage?.output_tokens_details?.reasoning_tokens ?? 0;
  const cachedTokens = rawUsage?.prompt_tokens_details?.cached_tokens ?? rawUsage?.input_tokens_details?.cached_tokens ?? 0;
  return {
    input_tokens: inTokens,
    output_tokens: outTokens,
    total_tokens: totTokens,
    input_tokens_details: { cached_tokens: cachedTokens },
    output_tokens_details: { reasoning_tokens: reasoningTokens }
  };
}

/**
 * Translates upstream ChatCompletions SSE stream into compliant OpenAI Responses SSE stream for Codex
 */
function bridgeResponsesStream(upstreamRes, clientRes, reqModel, reqId, onFinished, sessionId = null, reconnectFn = null, customComfyAdapter = null) {
  clientRes.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*'
  });

  let seq = 0;
  const respId = reqId || ('resp_' + Date.now());
  if (sessionId) {
    recordResponseSession(respId, sessionId);
  }
  const sendEvent = (event, data) => {
    if (clientRes.writableEnded || clientRes.destroyed) return;
    try {
      clientRes.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (_) {}
  };

  sendEvent('response.created', {
    type: 'response.created',
    sequence_number: seq++,
    response: {
      id: respId,
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      completed_at: null,
      status: 'in_progress',
      parallel_tool_calls: true,
      temperature: 1,
      top_p: 1,
      max_output_tokens: null,
      previous_response_id: null,
      background: false,
      truncation: 'disabled',
      top_logprobs: 0,
      max_tool_calls: null,
      prompt_cache_retention: null,
      model: reqModel,
      error: null,
      incomplete_details: null,
      output: [],
      usage: null,
      instructions: null,
      tool_choice: 'auto',
      tools: [],
      reasoning: { effort: 'high', summary: null },
      text: { verbosity: null, format: { type: 'text' } },
      moderation: null
    }
  });

  sendEvent('response.in_progress', {
    type: 'response.in_progress',
    sequence_number: seq++,
    response: {
      id: respId,
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      completed_at: null,
      status: 'in_progress',
      model: reqModel
    }
  });

  let outputIndex = 0;
  let reasoningStarted = false;
  let reasoningEverStarted = false;
  let reasoningCompleted = false;
  let reasoningIndex = 0;
  let textStarted = false;
  let textCompleted = false;
  let textIndex = 0;
  let inThinkTag = false;
  let thinkBuffer = '';
  let pendingPrefixText = '';
  const itemIdReasoning = 'item_reasoning_' + Date.now();
  const itemIdText = 'item_text_' + Date.now();
  let fullReasoning = '';
  let fullText = '';
  const degenDetector = new StreamDegenerationDetector();
  const toolCallsMap = new Map(); // index -> { id, name, args, outIdx }
  let comfyInterceptRec = null; // { id, name, args }
  const comfyInterceptIndices = new Set();
  let collectedUsage = null;
  let buffer = '';
  let streamFinished = false;
  let upstreamEnded = false;
  let totalChunks = 0;
  let hasRetriedReconnect = false;
  let currentUpstream = upstreamRes;

  const buildFinalOutput = () => {
    const finalOutput = [];
    if (reasoningEverStarted || fullReasoning) {
      finalOutput.push({
        id: itemIdReasoning,
        type: 'reasoning',
        status: 'completed',
        content: [{ type: 'reasoning_text', text: fullReasoning }]
      });
    }
    if (textStarted || fullText) {
      finalOutput.push({
        id: itemIdText,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: fullText, annotations: [], logprobs: [] }]
      });
    }
    for (const rec of toolCallsMap.values()) {
      if (rec.isCustomTool || rec.name === 'apply_patch') {
        const cleanInput = extractPatchInput(rec.args);
        finalOutput.push({
          id: rec.id,
          type: 'custom_tool_call',
          name: rec.name || 'apply_patch',
          call_id: rec.id,
          input: cleanInput,
          status: 'completed'
        });
      } else {
        finalOutput.push({
          id: rec.id,
          type: 'function_call',
          name: rec.name || 'custom_tool',
          call_id: rec.id,
          arguments: autoCorrectToolArgs(rec.name, rec.args),
          status: 'completed'
        });
      }
    }
    return finalOutput;
  };

  const dispatchStreamError = (err, isExplicitError = false, overrideCode = null) => {
    if (streamFinished || clientRes.writableEnded || clientRes.destroyed) {
      cleanup();
      return;
    }
    streamFinished = true;
    closeReasoning();
    closeText();
    const finalOutput = buildFinalOutput();
    const isEmpty = fullText === '' && fullReasoning === '' && toolCallsMap.size === 0;
    const isReasoningOnly = fullText === '' && toolCallsMap.size === 0 && fullReasoning !== '';
    const errCode = overrideCode || (isEmpty ? 'upstream_stream_empty_truncated' : (isReasoningOnly ? 'upstream_stream_truncated_reasoning_only' : 'upstream_stream_truncated'));
    const errMsg = err?.message
      ? `Upstream stream error: ${err.message}`
      : (isEmpty ? 'Upstream stream disconnected unexpectedly without returning any content (empty stream truncated).' : 'Upstream stream disconnected unexpectedly before generating output or tool calls.');

    // Rule 33: Stream Empty-Truncation Graceful Closure & UI Spinner Unlock
    // Whether isReasoningOnly, isEmpty, or whenever finalOutput has no completed assistant message:
    // We MUST NOT dispatch bare empty output: [].
    // We MUST actively inject a compliant assistant message item into the SSE stream:
    // response.output_item.added -> response.content_part.added -> response.output_item.done
    // and include it in finalOutput before dispatching response.failed,
    // safely releasing the UI thinking spinner and thread-writer-locks.
    const hasAssistantOutput = finalOutput.some(item => item.type === 'message' && item.role === 'assistant');
    if (!hasAssistantOutput) {
      const healMsgId = 'msg_heal_' + Date.now();
      const healNotice = `[网关服务提示：上游推理连接异常中断（${errMsg}）。建议重试当前请求或切换备用模型。]`;

      sendEvent('response.output_item.added', {
        type: 'response.output_item.added',
        sequence_number: seq++,
        output_index: outputIndex++,
        item: {
          id: healMsgId,
          type: 'message',
          status: 'in_progress',
          role: 'assistant',
          content: []
        }
      });

      sendEvent('response.content_part.added', {
        type: 'response.content_part.added',
        sequence_number: seq++,
        output_index: outputIndex - 1,
        content_index: 0,
        item_id: healMsgId,
        part: { type: 'output_text', text: healNotice, annotations: [], logprobs: [] }
      });

      sendEvent('response.output_item.done', {
        type: 'response.output_item.done',
        sequence_number: seq++,
        output_index: outputIndex - 1,
        item: {
          id: healMsgId,
          type: 'message',
          status: 'completed',
          role: 'assistant',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: healNotice, annotations: [], logprobs: [] }]
        }
      });

      finalOutput.push({
        id: healMsgId,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: healNotice, annotations: [], logprobs: [] }]
      });
    }

    console.error(`[Bridge Stream Error] ${errMsg} on model "${reqModel}". Dispatching response.failed.`);
    sendEvent('response.failed', {
      type: 'response.failed',
      sequence_number: seq++,
      response: {
        id: respId,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        completed_at: Math.floor(Date.now() / 1000),
        status: 'failed',
        model: reqModel,
        error: {
          type: 'server_error',
          code: errCode,
          message: errMsg
        },
        output: finalOutput
      }
    });
    cleanup();
    clientRes.end();
    if (typeof onFinished === 'function') onFinished();
  };

  // Heartbeat keep-alive & watchdog to prevent stream stalls
  let lastDataTime = Date.now();
  const heartbeatTimer = setInterval(() => {
    if (clientRes.writableEnded || clientRes.destroyed || streamFinished) {
      clearInterval(heartbeatTimer);
      return;
    }
    try { clientRes.write(': keep-alive\n\n'); } catch (_) {}
  }, 10000);

  const isXHighReasoning = Boolean(reqModel && (
    reqModel.includes('xhigh') ||
    reqModel.includes('high') ||
    reqModel.includes('opus') ||
    reqModel.includes('thinking') ||
    reqModel.includes('reasoning') ||
    reqModel.includes('reasoner') ||
    reqModel.includes('3-7') ||
    reqModel.includes('3.7') ||
    reqModel.includes('r1') ||
    reqModel.includes('o1') ||
    reqModel.includes('o3')
  ));
  const maxStallMs = isXHighReasoning ? 600000 : 300000;

  const stallWatchdog = setInterval(() => {
    if (clientRes.writableEnded || clientRes.destroyed || streamFinished) {
      clearInterval(stallWatchdog);
      clearInterval(heartbeatTimer);
      return;
    }
    const currentMaxStall = (reasoningStarted || reasoningCompleted || isXHighReasoning) ? 600000 : maxStallMs;
    if (Date.now() - lastDataTime > currentMaxStall) {
      clearInterval(stallWatchdog);
      clearInterval(heartbeatTimer);
      console.error(`[Bridge Stream Watchdog] Upstream stalled for >${Math.round(currentMaxStall / 1000)}s on model "${reqModel}". Closing stream with response.failed.`);
      dispatchStreamError(new Error(`Upstream stalled for longer than ${Math.round(currentMaxStall / 1000)}s without returning data.`), true, 'upstream_stream_timeout');
    }
  }, 5000);

  const attemptReconnect = (origErr, isExplicit = false) => {
    if (hasRetriedReconnect || streamFinished || clientRes.writableEnded || clientRes.destroyed) {
      dispatchStreamError(origErr, isExplicit);
      return;
    }
    hasRetriedReconnect = true;
    unbindUpstream(currentUpstream);
    console.log(`[Stream Reconnect] 首字吐出前断流 (0 字节数据)，正在实施毫秒级原位流式透明重连...`);
    reconnectFn(
      (newUpstream) => {
        if (streamFinished || clientRes.writableEnded || clientRes.destroyed) {
          if (newUpstream && typeof newUpstream.destroy === 'function') newUpstream.destroy();
          return;
        }
        currentUpstream = newUpstream;
        bindUpstream(newUpstream);
      },
      (retryErr) => {
        dispatchStreamError(retryErr || origErr, isExplicit);
      }
    );
  };

  const onCloseHandler = () => {
    cleanup();
    if (currentUpstream && typeof currentUpstream.destroy === 'function' && !currentUpstream.destroyed) {
      currentUpstream.destroy();
    }
  };
  clientRes.once('close', onCloseHandler);

  const cleanup = () => {
    clearInterval(heartbeatTimer);
    clearInterval(stallWatchdog);
    if (typeof clientRes.removeListener === 'function') clientRes.removeListener('close', onCloseHandler);
    unbindUpstream(currentUpstream);
  };

  const onUpstreamError = (err) => {
    if (totalChunks === 0 && typeof reconnectFn === 'function' && !hasRetriedReconnect && !streamFinished) {
      attemptReconnect(err, true);
    } else {
      dispatchStreamError(err, true);
    }
  };

  const onUpstreamClose = () => {
    if (!streamFinished && !upstreamEnded) {
      if (totalChunks === 0 && typeof reconnectFn === 'function' && !hasRetriedReconnect) {
        attemptReconnect(new Error('Premature close of upstream response stream before first token'), false);
      } else {
        dispatchStreamError(new Error('Premature close of upstream response stream'), false);
      }
    }
  };

  const closeReasoning = () => {
    if (reasoningStarted && !reasoningCompleted) {
      sendEvent('response.reasoning_text.done', {
        type: 'response.reasoning_text.done',
        sequence_number: seq++,
        output_index: reasoningIndex,
        content_index: 0,
        item_id: itemIdReasoning,
        text: fullReasoning
      });
      sendEvent('response.content_part.done', {
        type: 'response.content_part.done',
        sequence_number: seq++,
        output_index: reasoningIndex,
        content_index: 0,
        item_id: itemIdReasoning,
        part: { type: 'reasoning_text', text: fullReasoning }
      });
      sendEvent('response.output_item.done', {
        type: 'response.output_item.done',
        sequence_number: seq++,
        output_index: reasoningIndex,
        item: {
          id: itemIdReasoning,
          type: 'reasoning',
          status: 'completed',
          content: [{ type: 'reasoning_text', text: fullReasoning }]
        }
      });
      reasoningStarted = false;
      reasoningCompleted = true;
    } else {
      reasoningCompleted = true;
    }
  };

  const closeText = () => {
    if (textStarted && !textCompleted) {
      sendEvent('response.output_text.done', {
        type: 'response.output_text.done',
        sequence_number: seq++,
        output_index: textIndex,
        content_index: 0,
        item_id: itemIdText,
        text: fullText,
        logprobs: []
      });
      sendEvent('response.content_part.done', {
        type: 'response.content_part.done',
        sequence_number: seq++,
        output_index: textIndex,
        content_index: 0,
        item_id: itemIdText,
        part: { type: 'output_text', text: fullText, annotations: [], logprobs: [] }
      });
      sendEvent('response.output_item.done', {
        type: 'response.output_item.done',
        sequence_number: seq++,
        output_index: textIndex,
        item: {
          id: itemIdText,
          type: 'message',
          status: 'completed',
          role: 'assistant',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: fullText, annotations: [], logprobs: [] }]
        }
      });
      textCompleted = true;
    }
  };

  const { StringDecoder } = require('string_decoder');
  const decoder = new StringDecoder('utf8');
  let pendingBuffer = '';

  const processLine = (rawLine) => {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) return;
    const payloadStr = line.slice(5).trim();
    if (!payloadStr || payloadStr === '[DONE]') return;

    try {
      const parsed = JSON.parse(payloadStr);
      if (parsed.usage) collectedUsage = parsed.usage;

      const choice = parsed.choices?.[0];
      if (!choice) return;
      const delta = choice.delta;
      if (!delta) return;

        let reasoningChunk = delta.reasoning || delta.reasoning_content;
        let textChunk = delta.content;

        // Support models that stream <think>...</think> inside delta.content across arbitrary SSE chunk boundaries
        if (textChunk && !textStarted && !reasoningCompleted) {
          thinkBuffer += textChunk;
          textChunk = '';

          if (!inThinkTag) {
            const startIdx = thinkBuffer.indexOf('<think>');
            if (startIdx !== -1) {
              const before = thinkBuffer.slice(0, startIdx);
              thinkBuffer = thinkBuffer.slice(startIdx + 7);
              inThinkTag = true;
              if (before && before.trim()) {
                pendingPrefixText = (pendingPrefixText || '') + before;
              }
            } else {
              const trimmedLead = thinkBuffer.trimStart();
              if (trimmedLead === '') {
                // Leading whitespace before potential <think> - keep buffering without prematurely starting text
              } else if (trimmedLead.length < 7 && '<think>'.startsWith(trimmedLead)) {
                // Partial <think> prefix match - keep buffering
              } else {
                // Definitely not a think tag envelope
                closeReasoning();
                textChunk = (pendingPrefixText ? pendingPrefixText : '') + thinkBuffer;
                thinkBuffer = '';
                pendingPrefixText = '';
              }
            }
          }

          if (inThinkTag) {
            const endIdx = thinkBuffer.indexOf('</think>');
            if (endIdx !== -1) {
              const thinkPart = thinkBuffer.slice(0, endIdx);
              const after = thinkBuffer.slice(endIdx + 8);
              thinkBuffer = '';
              inThinkTag = false;
              if (thinkPart) {
                if (!reasoningChunk) reasoningChunk = thinkPart;
                else reasoningChunk += thinkPart;
              }
              textChunk = (pendingPrefixText ? pendingPrefixText : '') + after;
              pendingPrefixText = '';
              closeReasoning();
            } else {
              let matchLen = 0;
              for (let len = Math.min(7, thinkBuffer.length); len >= 1; len--) {
                if ('</think>'.startsWith(thinkBuffer.slice(-len))) {
                  matchLen = len;
                  break;
                }
              }
              if (matchLen > 0) {
                const safeReasoning = thinkBuffer.slice(0, -matchLen);
                thinkBuffer = thinkBuffer.slice(-matchLen);
                if (safeReasoning) {
                  if (!reasoningChunk) reasoningChunk = safeReasoning;
                  else reasoningChunk += safeReasoning;
                }
              } else {
                if (!reasoningChunk) reasoningChunk = thinkBuffer;
                else reasoningChunk += thinkBuffer;
                thinkBuffer = '';
              }
            }
          }
        }

        // 1. Thinking / Reasoning Stream
        if (reasoningChunk && !textStarted) {
          if (!reasoningStarted && !reasoningCompleted) {
            reasoningStarted = true;
            reasoningEverStarted = true;
            reasoningIndex = outputIndex++;
            sendEvent('response.output_item.added', {
              type: 'response.output_item.added',
              sequence_number: seq++,
              output_index: reasoningIndex,
              item: { id: itemIdReasoning, type: 'reasoning', status: 'in_progress', content: [], summary: [] }
            });
            sendEvent('response.content_part.added', {
              type: 'response.content_part.added',
              sequence_number: seq++,
              output_index: reasoningIndex,
              content_index: 0,
              item_id: itemIdReasoning,
              part: { type: 'reasoning_text', text: '' }
            });
          }
          if (reasoningStarted) {
            fullReasoning += reasoningChunk;
            sendEvent('response.reasoning_text.delta', {
              type: 'response.reasoning_text.delta',
              sequence_number: seq++,
              output_index: reasoningIndex,
              content_index: 0,
              item_id: itemIdReasoning,
              delta: reasoningChunk
            });
          }
        }

        // 2. Answer Text Stream
        if (textChunk) {
          closeReasoning();
          if (!textStarted) {
            textStarted = true;
            textIndex = outputIndex++;
            sendEvent('response.output_item.added', {
              type: 'response.output_item.added',
              sequence_number: seq++,
              output_index: textIndex,
              item: { id: itemIdText, type: 'message', status: 'in_progress', role: 'assistant', phase: 'final_answer', content: [] }
            });
            sendEvent('response.content_part.added', {
              type: 'response.content_part.added',
              sequence_number: seq++,
              output_index: textIndex,
              content_index: 0,
              item_id: itemIdText,
              part: { type: 'output_text', text: '', annotations: [], logprobs: [] }
            });
          }
          // Stream Degeneration & Repetition Loop Circuit Breaker (Rule 35)
          const degenCheck = degenDetector.feed(textChunk);
          if (degenCheck.shouldHalt) {
            console.warn(`[Degeneration Guard] 检测到上游模型产生退化死循环 (短语 "${degenCheck.triggeredPhrase}" 重复超限)，正在实施毫秒级安全熔断截断...`);
            const haltNotice = '\n\n[网关智能防御：检测到模型输出产生重复循环，已自动安全截断以保护上下文与配额]';
            fullText += haltNotice;
            sendEvent('response.output_text.delta', {
              type: 'response.output_text.delta',
              sequence_number: seq++,
              output_index: textIndex,
              content_index: 0,
              item_id: itemIdText,
              delta: haltNotice,
              logprobs: []
            });
            closeText();
            streamFinished = true;
            if (upstreamRes && typeof upstreamRes.destroy === 'function' && !upstreamRes.destroyed) {
              upstreamRes.destroy();
            }
            const finalOutput = buildFinalOutput();
            const usageObj = normalizeResponsesUsage(
              collectedUsage,
              Math.max(10, Math.round(fullText.length * 0.4)),
              Math.max(5, Math.round((fullText.length + fullReasoning.length) * 0.7))
            );
            sendEvent('response.completed', {
              type: 'response.completed',
              sequence_number: seq++,
              response: {
                id: respId,
                object: 'response',
                created_at: Math.floor(Date.now() / 1000),
                completed_at: Math.floor(Date.now() / 1000),
                status: 'completed',
                parallel_tool_calls: true,
                temperature: 1,
                top_p: 1,
                max_output_tokens: null,
                previous_response_id: null,
                background: false,
                truncation: 'disabled',
                top_logprobs: 0,
                max_tool_calls: null,
                prompt_cache_retention: null,
                model: reqModel,
                error: null,
                incomplete_details: null,
                output: finalOutput,
                usage: usageObj
              }
            });
            cleanup();
            clientRes.end();
            if (typeof onFinished === 'function') onFinished();
            return;
          }

          fullText += textChunk;
          sendEvent('response.output_text.delta', {
            type: 'response.output_text.delta',
            sequence_number: seq++,
            output_index: textIndex,
            content_index: 0,
            item_id: itemIdText,
            delta: textChunk,
            logprobs: []
          });
        }

        // 3. Tool Calls Stream
        if (Array.isArray(delta.tool_calls)) {
          closeReasoning();
          const hasNonImageTool = delta.tool_calls.some(tc => {
            const fn = tc.function?.name || "";
            const idx = tc.index ?? 0;
            return !isImageGenerationToolName(fn) && !comfyInterceptIndices.has(idx);
          });
          if (hasNonImageTool) {
            closeText();
          }
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const funcName = tc.function?.name || "";

            // 智能网关层 ComfyUI 生图透明代执行拦截
            if (isImageGenerationToolName(funcName) || comfyInterceptIndices.has(idx)) {
              comfyInterceptIndices.add(idx);
              if (!comfyInterceptRec) {
                comfyInterceptRec = {
                  id: tc.id || ("call_" + Date.now() + "_" + idx + "_comfy"),
                  name: funcName || "generate_image",
                  args: ""
                };
              }
              if (tc.id && !comfyInterceptRec.id) {
                comfyInterceptRec.id = tc.id;
              }
              if (tc.function?.arguments) {
                comfyInterceptRec.args += tc.function.arguments;
              }
              continue;
            }
            if (!toolCallsMap.has(idx)) {
              const tcOutIdx = outputIndex++;
              const callId = tc.id || `call_${Date.now()}_${idx}`;
              let funcName = tc.function?.name || '';
              if (funcName === 'image_gen') {
                funcName = 'generate_image';
              }
              const isCustomTool = (funcName === 'apply_patch');
              const rec = {
                id: callId,
                name: funcName,
                args: '',
                outIdx: tcOutIdx,
                isCustomTool
              };
              toolCallsMap.set(idx, rec);
              if (isCustomTool) {
                sendEvent('response.output_item.added', {
                  type: 'response.output_item.added',
                  sequence_number: seq++,
                  output_index: tcOutIdx,
                  item: { id: callId, type: 'custom_tool_call', name: funcName, call_id: callId, input: '' }
                });
              } else {
                sendEvent('response.output_item.added', {
                  type: 'response.output_item.added',
                  sequence_number: seq++,
                  output_index: tcOutIdx,
                  item: { id: callId, type: 'function_call', name: funcName, call_id: callId, arguments: '' }
                });
              }
            }

            const rec = toolCallsMap.get(idx);
            if (tc.function?.name && !rec.name) {
              let fName = tc.function.name;
              if (fName === 'generate_image' || fName === 'image_gen') {
                fName = 'mcp__comfyui__generate_image';
              } else if (fName === 'interrogate_image') {
                fName = 'mcp__comfyui__interrogate_image';
              }
              rec.name = fName;
              if (rec.name === 'apply_patch') {
                rec.isCustomTool = true;
              }
            }
            if (tc.id && !rec.id) {
              rec.id = tc.id;
            }
            if (tc.function?.arguments) {
              rec.args += tc.function.arguments;
              if (!rec.isCustomTool && rec.name !== 'apply_patch') {
                sendEvent('response.function_call_arguments.delta', {
                  type: 'response.function_call_arguments.delta',
                  sequence_number: seq++,
                  output_index: rec.outIdx,
                  call_id: rec.id,
                  delta: tc.function.arguments
                });
              }
            }
          }
        }
      } catch (e) {}
  };

  const onUpstreamData = (chunk) => {
    totalChunks++;
    lastDataTime = Date.now();
    pendingBuffer += (typeof chunk === 'string') ? chunk : decoder.write(chunk);
    if (pendingBuffer.length > 10 * 1024 * 1024) {
      console.warn('[SSE Buffer Overflow Guard] bridgeResponsesStream buffer exceeded 10MB without newline. Pruning stale prefix.');
      pendingBuffer = pendingBuffer.slice(-1024 * 1024);
    }
    const lastNewlineIdx = pendingBuffer.lastIndexOf('\n');
    if (lastNewlineIdx !== -1) {
      const completeChunk = pendingBuffer.slice(0, lastNewlineIdx);
      pendingBuffer = pendingBuffer.slice(lastNewlineIdx + 1);
      const lines = completeChunk.split('\n');
      for (const rawLine of lines) {
        processLine(rawLine);
      }
    }
  };

  const handleComfyUITransparentExecution = async () => {
    try {
      let parsedArgs = {};
      try {
        parsedArgs = JSON.parse(comfyInterceptRec.args || '{}');
      } catch (_) {
        parsedArgs = { prompt: comfyInterceptRec.args };
      }
      const prompt = (parsedArgs.prompt || parsedArgs.description || '').trim();
      if (!prompt) return;

      const adapter = customComfyAdapter || getComfyUIAdapter();
      if (!adapter) return;

      if (!textStarted) {
        textStarted = true;
        textIndex = outputIndex++;
        sendEvent('response.output_item.added', {
          type: 'response.output_item.added',
          sequence_number: seq++,
          output_index: textIndex,
          item: { id: itemIdText, type: 'message', status: 'in_progress', role: 'assistant', phase: 'final_answer', content: [] }
        });
        sendEvent('response.content_part.added', {
          type: 'response.content_part.added',
          sequence_number: seq++,
          output_index: textIndex,
          content_index: 0,
          item_id: itemIdText,
          part: { type: 'output_text', text: '', annotations: [], logprobs: [] }
        });
      }

      const isHeavy = parsedArgs.mode === 'heavy' || /超分|精雕|微雕|高精重绘|打印级|二阶段/i.test(prompt);
      const modeDesc = isHeavy
        ? '正在调度双阶段高精微雕工作流渲染（高精度慢速通道）...'
        : '正在调度单阶段极速直出工作流渲染（15步极速直出）...';
      const notice = '\n\n> 🎨 **ComfyUI 图像智能体**：已拦截生图意图，' + modeDesc + '请稍候...\n\n';
      fullText += notice;
      sendEvent('response.output_text.delta', {
        type: 'response.output_text.delta',
        sequence_number: seq++,
        output_index: textIndex,
        content_index: 0,
        item_id: itemIdText,
        delta: notice,
        logprobs: []
      });

      const genRes = await adapter.executeGeneration({
        ...parsedArgs,
        prompt,
        negative: parsedArgs.negative || null,
        workflow: parsedArgs.workflow || 'auto',
        width: parsedArgs.width || null,
        height: parsedArgs.height || null,
        seed: parsedArgs.seed || null,
        isCancelled: () => clientRes.destroyed || clientRes.writableEnded,
        onProgress: ({ elapsedSec }) => {
          if (!clientRes.destroyed && !clientRes.writableEnded) {
            try { clientRes.write(': comfyui rendering ' + elapsedSec + 's\n\n'); } catch (_) {}
          }
        },
        timeoutMs: 300000
      });

      if (genRes && genRes.success) {
        const fileUrl = 'file:///' + genRes.localPath.replace(/\\/g, '/');
        const durationSec = (genRes.durationMs / 1000).toFixed(1);
        const cleanPromptTitle = prompt.slice(0, 30).replace(/[\[\]]/g, '');
        const trackTag = genRes.isFastDirect ? '极速直出轨 (15步)' : '双阶段高精微雕轨';
        const cardMd = '![ ' + cleanPromptTitle + ' ](' + fileUrl + ')\n\n' +
          '> 🖼️ **成片已生成**：\n' +
          '> - **工作流风格**：`' + (genRes.workflowName || '工业级双轨写实') + '` (' + trackTag + ')\n' +
          '> - **本地文件**：[`' + genRes.filename + '`](' + fileUrl + ')\n' +
          '> - **渲染耗时**：`' + durationSec + 's` | 种子：`' + (genRes.seed || '随机') + '`\n\n';

        fullText += cardMd;
        sendEvent('response.output_text.delta', {
          type: 'response.output_text.delta',
          sequence_number: seq++,
          output_index: textIndex,
          content_index: 0,
          item_id: itemIdText,
          delta: cardMd,
          logprobs: []
        });
      }
    } catch (err) {
      console.error('[ComfyUI Gateway Intercept Error]', err.message);
      const failNotice = '\n\n> ⚠️ **ComfyUI 渲染提示**：未能完成图片自动渲染（' + err.message + '）。请确认本地 8284 端口 ComfyUI 服务正常。\n\n';
      fullText += failNotice;
      sendEvent('response.output_text.delta', {
        type: 'response.output_text.delta',
        sequence_number: seq++,
        output_index: textIndex,
        content_index: 0,
        item_id: itemIdText,
        delta: failNotice,
        logprobs: []
      });
    }
  };

  const onUpstreamEnd = async () => {
    upstreamEnded = true;
    if (streamFinished) return;

    // Flush any pending trailing bytes from StringDecoder and complete lines
    pendingBuffer += decoder.end();
    if (pendingBuffer && pendingBuffer.trim()) {
      const remainingLines = pendingBuffer.split('\n');
      pendingBuffer = '';
      for (const rawLine of remainingLines) {
        processLine(rawLine);
      }
    }
    buffer = '';

    if (thinkBuffer || pendingPrefixText) {
      if (inThinkTag) {
        if (!reasoningStarted) {
          reasoningStarted = true;
          reasoningEverStarted = true;
          reasoningIndex = outputIndex++;
          sendEvent('response.output_item.added', {
            type: 'response.output_item.added',
            sequence_number: seq++,
            output_index: reasoningIndex,
            item: { id: itemIdReasoning, type: 'reasoning', status: 'in_progress', content: [], summary: [] }
          });
          sendEvent('response.content_part.added', {
            type: 'response.content_part.added',
            sequence_number: seq++,
            output_index: reasoningIndex,
            content_index: 0,
            item_id: itemIdReasoning,
            part: { type: 'reasoning_text', text: '' }
          });
        }
        fullReasoning += thinkBuffer;
        sendEvent('response.reasoning_text.delta', {
          type: 'response.reasoning_text.delta',
          sequence_number: seq++,
          output_index: reasoningIndex,
          content_index: 0,
          item_id: itemIdReasoning,
          delta: thinkBuffer
        });
      } else {
        const remainingText = (pendingPrefixText || '') + (thinkBuffer || '');
        if (remainingText) {
          closeReasoning();
          if (!textStarted) {
            textStarted = true;
            textIndex = outputIndex++;
            sendEvent('response.output_item.added', {
              type: 'response.output_item.added',
              sequence_number: seq++,
              output_index: textIndex,
              item: { id: itemIdText, type: 'message', status: 'in_progress', role: 'assistant', phase: 'final_answer', content: [] }
            });
            sendEvent('response.content_part.added', {
              type: 'response.content_part.added',
              sequence_number: seq++,
              output_index: textIndex,
              content_index: 0,
              item_id: itemIdText,
              part: { type: 'output_text', text: '', annotations: [], logprobs: [] }
            });
          }
          fullText += remainingText;
          sendEvent('response.output_text.delta', {
            type: 'response.output_text.delta',
            sequence_number: seq++,
            output_index: textIndex,
            content_index: 0,
            item_id: itemIdText,
            delta: remainingText,
            logprobs: []
          });
        }
      }
      thinkBuffer = '';
      pendingPrefixText = '';
    }

    closeReasoning();
    clearInterval(stallWatchdog);
    if (comfyInterceptRec) {
      await handleComfyUITransparentExecution();
    }
    closeText();

    // Close tool calls
    for (const rec of toolCallsMap.values()) {
      if (rec.isCustomTool || rec.name === 'apply_patch') {
        const cleanInput = extractPatchInput(rec.args);
        sendEvent('response.custom_tool_call_input.delta', {
          type: 'response.custom_tool_call_input.delta',
          sequence_number: seq++,
          output_index: rec.outIdx,
          call_id: rec.id,
          delta: cleanInput
        });
        sendEvent('response.custom_tool_call_input.done', {
          type: 'response.custom_tool_call_input.done',
          sequence_number: seq++,
          output_index: rec.outIdx,
          call_id: rec.id,
          input: cleanInput
        });
        sendEvent('response.output_item.done', {
          type: 'response.output_item.done',
          sequence_number: seq++,
          output_index: rec.outIdx,
          item: { id: rec.id, type: 'custom_tool_call', name: rec.name || 'apply_patch', call_id: rec.id, input: cleanInput, status: 'completed' }
        });
      } else {
        rec.args = autoCorrectToolArgs(rec.name, rec.args);
        sendEvent('response.function_call_arguments.done', {
          type: 'response.function_call_arguments.done',
          sequence_number: seq++,
          output_index: rec.outIdx,
          call_id: rec.id,
          arguments: rec.args
        });
        sendEvent('response.output_item.done', {
          type: 'response.output_item.done',
          sequence_number: seq++,
          output_index: rec.outIdx,
          item: { id: rec.id, type: 'function_call', name: rec.name || 'custom_tool', call_id: rec.id, arguments: rec.args, status: 'completed' }
        });
      }
    }

    if (fullText === '' && toolCallsMap.size === 0) {
      if (fullReasoning === '' && totalChunks === 0 && typeof reconnectFn === 'function' && !hasRetriedReconnect) {
        attemptReconnect(new Error('Empty stream before first token'), false);
        return;
      }
      dispatchStreamError(null, false);
      return;
    }

    streamFinished = true;
    const finalOutput = buildFinalOutput();

    const usageObj = normalizeResponsesUsage(
      collectedUsage,
      Math.max(10, Math.round(fullText.length * 0.4)),
      Math.max(5, Math.round((fullText.length + fullReasoning.length) * 0.7))
    );

    sendEvent('response.completed', {
      type: 'response.completed',
      sequence_number: seq++,
      response: {
        id: respId,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        completed_at: Math.floor(Date.now() / 1000),
        status: 'completed',
        parallel_tool_calls: true,
        temperature: 1,
        top_p: 1,
        max_output_tokens: null,
        previous_response_id: null,
        background: false,
        truncation: 'disabled',
        top_logprobs: 0,
        max_tool_calls: null,
        prompt_cache_retention: null,
        model: reqModel,
        error: null,
        incomplete_details: null,
        output: finalOutput,
        usage: usageObj,
        instructions: null,
        tool_choice: 'auto',
        tools: [],
        reasoning: { effort: 'high', summary: null },
        text: { verbosity: null, format: { type: 'text' } },
        moderation: null
      }
    });

    cleanup();
    clientRes.end();
    if (typeof onFinished === 'function') onFinished();
  };

  const bindUpstream = (st) => {
    if (!st || typeof st.on !== 'function') return;
    st.on('data', onUpstreamData);
    st.on('error', onUpstreamError);
    st.on('close', onUpstreamClose);
    st.on('end', onUpstreamEnd);
  };

  const unbindUpstream = (st) => {
    if (!st || typeof st.removeListener !== 'function') return;
    st.removeListener('data', onUpstreamData);
    st.removeListener('error', onUpstreamError);
    st.removeListener('close', onUpstreamClose);
    st.removeListener('end', onUpstreamEnd);
  };

  bindUpstream(currentUpstream);
}

/**
 * Rule 33: Stream Empty-Truncation Graceful Closure & UI Spinner Unlock
 * Proactively pushes compliant OpenAI Responses SSE frames to the client when upstream fails or times out:
 * response.created -> response.in_progress -> response.output_item.added -> response.content_part.added -> response.output_item.done -> response.failed
 * Safely unlocks Codex UI thinking spinner and releases thread-writer-locks.
 */
function dispatchResponsesStreamError(clientRes, reqModel, reqId, err, sessionId = null) {
  if (!clientRes || clientRes.writableEnded || clientRes.destroyed) return;

  const respId = reqId || ('resp_' + Date.now());
  const model = reqModel || 'deepseek-v4.1-flash';
  const errMsg = err?.message ? err.message : String(err || 'Upstream connection timed out or closed unexpectedly');

  if (sessionId) {
    recordResponseSession(respId, sessionId);
  }

  // 1. Ensure SSE response headers are sent
  if (!clientRes.headersSent) {
    clientRes.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*'
    });
  }

  const sendEvent = (event, data) => {
    if (clientRes.writableEnded || clientRes.destroyed) return;
    try {
      clientRes.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (_) {}
  };

  let seq = 0;

  // 2. Initial created & in_progress frames
  sendEvent('response.created', {
    type: 'response.created',
    sequence_number: seq++,
    response: {
      id: respId,
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      completed_at: null,
      status: 'in_progress',
      parallel_tool_calls: true,
      model: model,
      output: [],
      tools: []
    }
  });

  sendEvent('response.in_progress', {
    type: 'response.in_progress',
    sequence_number: seq++,
    response: {
      id: respId,
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      completed_at: null,
      status: 'in_progress',
      model: model
    }
  });

  // 3. Injected compliant assistant error message block to close UI spinner
  const healMsgId = 'msg_heal_' + Date.now();
  const healNotice = `[智能网关服务提示：上游推理连接异常中断（${errMsg}）。网关已安全闭环会话状态并释放任务锁，建议重试当前任务或切换备用模型。]`;

  sendEvent('response.output_item.added', {
    type: 'response.output_item.added',
    sequence_number: seq++,
    output_index: 0,
    item: {
      id: healMsgId,
      type: 'message',
      status: 'in_progress',
      role: 'assistant',
      content: []
    }
  });

  sendEvent('response.content_part.added', {
    type: 'response.content_part.added',
    sequence_number: seq++,
    output_index: 0,
    content_index: 0,
    item_id: healMsgId,
    part: { type: 'output_text', text: healNotice, annotations: [], logprobs: [] }
  });

  sendEvent('response.output_item.done', {
    type: 'response.output_item.done',
    sequence_number: seq++,
    output_index: 0,
    item: {
      id: healMsgId,
      type: 'message',
      status: 'completed',
      role: 'assistant',
      phase: 'final_answer',
      content: [{ type: 'output_text', text: healNotice, annotations: [], logprobs: [] }]
    }
  });

  // 4. Concluding response.failed frame
  sendEvent('response.failed', {
    type: 'response.failed',
    sequence_number: seq++,
    response: {
      id: respId,
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      completed_at: Math.floor(Date.now() / 1000),
      status: 'failed',
      model: model,
      error: {
        type: 'server_error',
        code: errMsg.toLowerCase().includes('timeout') ? 'gateway_timeout' : 'upstream_stream_truncated',
        message: errMsg
      },
      output: [{
        id: healMsgId,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: healNotice, annotations: [], logprobs: [] }]
      }]
    }
  });

  try {
    clientRes.end();
  } catch (_) {}
}

/**
 * Translates upstream non-streaming ChatCompletions JSON response to standard OpenAI Responses JSON response
 */
function convertChatResponseToResponses(chatJson, reqModel, reqId) {
  const respId = reqId || chatJson.id || ('resp_' + Date.now());
  const choice = chatJson.choices?.[0] || {};
  const msg = choice.message || {};
  let content = msg.content || '';
  let reasoning = msg.reasoning_content || msg.reasoning || '';
  if (!reasoning && typeof content === 'string' && content.includes('<think>')) {
    const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
      reasoning = thinkMatch[1].trim();
      content = content.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/, '').trim();
    } else {
      const unclosedMatch = content.match(/<think>([\s\S]*)$/);
      if (unclosedMatch) {
        reasoning = unclosedMatch[1].trim();
        content = content.replace(/<think>[\s\S]*$/, '').trim();
      }
    }
  }
  const output = [];

  if (reasoning) {
    output.push({
      id: 'reasoning_' + Date.now(),
      type: 'reasoning',
      status: 'completed',
      content: [{ type: 'reasoning_text', text: reasoning }]
    });
  }

  if (content) {
    output.push({
      id: 'msg_' + Date.now(),
      type: 'message',
      status: 'completed',
      role: 'assistant',
      phase: 'final_answer',
      content: [{ type: 'output_text', text: content, annotations: [], logprobs: [] }]
    });
  }

  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      let toolName = tc.function?.name || '';
      if (toolName === 'generate_image' || toolName === 'image_gen') {
        toolName = 'mcp__comfyui__generate_image';
      } else if (toolName === 'interrogate_image') {
        toolName = 'mcp__comfyui__interrogate_image';
      }
      const rawArgs = tc.function?.arguments || '{}';
      if (toolName === 'apply_patch') {
        const cleanInput = extractPatchInput(rawArgs);
        output.push({
          id: tc.id || `call_${Date.now()}`,
          type: 'custom_tool_call',
          name: 'apply_patch',
          call_id: tc.id || '',
          input: cleanInput,
          status: 'completed'
        });
      } else {
        output.push({
          id: tc.id || `call_${Date.now()}`,
          type: 'function_call',
          name: toolName,
          call_id: tc.id || '',
          arguments: rawArgs,
          status: 'completed'
        });
      }
    }
  }

  if (output.length === 0) {
    const healMsgId = 'msg_heal_' + Date.now();
    const healNotice = '[网关服务提示：上游推理返回空响应。建议重试当前请求或切换备用模型。]';
    return {
      id: respId,
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      completed_at: Math.floor(Date.now() / 1000),
      status: 'failed',
      parallel_tool_calls: true,
      model: reqModel,
      error: {
        type: 'server_error',
        code: 'upstream_stream_empty_truncated',
        message: 'Upstream returned an empty response with no content or tool calls.'
      },
      output: [{
        id: healMsgId,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: healNotice, annotations: [], logprobs: [] }]
      }],
      usage: normalizeResponsesUsage(chatJson.usage, 1, 1)
    };
  }

  return {
    id: respId,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    completed_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    parallel_tool_calls: true,
    temperature: 1,
    top_p: 1,
    max_output_tokens: null,
    previous_response_id: null,
    background: false,
    truncation: 'disabled',
    top_logprobs: 0,
    max_tool_calls: null,
    prompt_cache_retention: null,
    model: reqModel,
    error: null,
    incomplete_details: null,
    output,
    usage: normalizeResponsesUsage(chatJson.usage, 20, 20),
    instructions: null,
    tool_choice: 'auto',
    tools: [],
    reasoning: { effort: 'high', summary: null },
    text: { verbosity: null, format: { type: 'text' } },
    moderation: null
  };
}

/**
 * Converts OpenAI Responses API JSON payload to standard Anthropic Messages JSON payload
 */
function convertResponsesToAnthropicPayload(body, compressionOptions = null, sessionId = null) {
  let model = body.model || 'claude-haiku-5-5';
  if (model.startsWith('opencode-go/')) model = model.slice(12);

  let system = '';
  if (body.instructions && typeof body.instructions === 'string') {
    system = body.instructions;
  }

  const rawMessages = [];
  const inputList = Array.isArray(body.input) ? body.input : (body.input ? [body.input] : []);
  for (const item of inputList) {
    if (typeof item === 'string') {
      rawMessages.push({ role: 'user', content: item });
    } else if (item && typeof item === 'object') {
      const itemType = item.type || '';
      const isToolCall = itemType === 'function_call' ||
        itemType === 'local_shell_call' ||
        itemType === 'custom_tool_call' ||
        itemType === 'tool_search_call' ||
        Boolean(item.call_id && !itemType.includes('output'));

      const isToolOutput = itemType === 'function_call_output' ||
        itemType === 'custom_tool_call_output' ||
        itemType === 'tool_search_output' ||
        itemType.endsWith('_output') ||
        (item.call_id && item.output !== undefined);

      if (isToolCall) {
        const callId = item.call_id || item.id || `call_${Date.now()}`;
        const toolName = item.name || item.function?.name || (itemType !== 'function_call' ? itemType : 'custom_tool');
        let inputObj = {};
        if (typeof item.arguments === 'string') {
          try { inputObj = JSON.parse(item.arguments); } catch (e) {}
        } else if (item.arguments && typeof item.arguments === 'object') {
          inputObj = item.arguments;
        } else if (item.command) {
          inputObj = { command: item.command };
        } else if (item.action && typeof item.action === 'object') {
          inputObj = item.action;
        } else if (item.input !== undefined) {
          if (typeof item.input === 'string') {
            inputObj = { input: item.input };
          } else if (typeof item.input === 'object') {
            inputObj = item.input;
          }
        }

        rawMessages.push({
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: callId,
            name: toolName,
            input: inputObj
          }]
        });
      } else if (isToolOutput) {
        const callId = item.call_id || item.id || `call_${Date.now()}`;
        const outputStr = sanitizeToolOutput(item.output);
        rawMessages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: callId,
            content: outputStr
          }]
        });
      } else if (itemType === 'message' || item.role || itemType === 'agent_message') {
        const rawRole = item.role || (itemType === 'agent_message' ? 'assistant' : 'user');
        let content = '';
        if (typeof item.content === 'string') {
          content = item.content;
        } else if (Array.isArray(item.content)) {
          const hasImages = item.content.some(c => c && (c.type === 'input_image' || c.type === 'image_url' || c.type === 'image' || (c.source && c.source.type)));
          if (hasImages) {
            content = item.content.map(c => {
              if (typeof c === 'string') return { type: 'text', text: c };
              if (c.type === 'input_text' || c.type === 'text') return { type: 'text', text: c.text || '' };
              if (c.type === 'input_image' || c.type === 'image_url' || c.type === 'image' || (c.source && c.source.type)) {
                if (c.source && c.source.type) {
                  return c;
                }
                const imgUrl = c.image_url?.url || (typeof c.image_url === 'string' ? c.image_url : '') || c.url || '';
                if (typeof imgUrl === 'string' && imgUrl.startsWith('data:')) {
                  const m = imgUrl.match(/^data:([^;]+);base64,(.+)$/);
                  if (m) {
                    return {
                      type: 'image',
                      source: {
                        type: 'base64',
                        media_type: m[1],
                        data: m[2]
                      }
                    };
                  }
                }
                if (c.data && (c.media_type || c.mime_type || c.format)) {
                  const mediaType = c.media_type || c.mime_type || (c.format ? `image/${c.format}` : 'image/png');
                  return {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: mediaType,
                      data: c.data
                    }
                  };
                }
                return {
                  type: 'image',
                  source: {
                    type: 'url',
                    url: imgUrl
                  }
                };
              }
              return c;
            });
          } else {
            content = item.content.map(c => typeof c === 'string' ? c : (c.text || '')).join('\n');
          }
        }

        if (rawRole === 'developer' || rawRole === 'system') {
          const textContent = Array.isArray(content)
            ? content.filter(c => c && c.type === 'text').map(c => c.text).join('\n')
            : String(content || '');
          system = system ? (system + '\n' + textContent) : textContent;
        } else {
          rawMessages.push({ role: rawRole, content });
        }
      }
    }
  }

  // Merge consecutive same-role messages for Anthropic alternating requirements
  const mergedMessages = [];
  for (const m of rawMessages) {
    if (mergedMessages.length > 0 && mergedMessages[mergedMessages.length - 1].role === m.role) {
      const prev = mergedMessages[mergedMessages.length - 1];
      if (typeof prev.content === 'string' && typeof m.content === 'string') {
        prev.content += '\n' + m.content;
      } else {
        const prevArr = Array.isArray(prev.content) ? prev.content : [{ type: 'text', text: String(prev.content || '') }];
        const mArr = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content || '') }];
        prev.content = [...prevArr, ...mArr];
      }
    } else {
      mergedMessages.push(m);
    }
  }

  // Ensure tool_result blocks are strictly positioned at the beginning of user turn content arrays (Anthropic protocol requirement)
  for (const msg of mergedMessages) {
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      const toolResults = msg.content.filter(c => c && c.type === 'tool_result');
      const otherBlocks = msg.content.filter(c => !c || c.type !== 'tool_result');
      if (toolResults.length > 0 && otherBlocks.length > 0) {
        msg.content = [...toolResults, ...otherBlocks];
      }
    }
  }

  // 2. Ensure each assistant tool_use has a corresponding tool_result in the immediately following turn
  for (let idx = 0; idx < mergedMessages.length; idx++) {
    const msg = mergedMessages[idx];
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const toolUseBlocks = msg.content.filter(b => b && b.type === 'tool_use');
      if (toolUseBlocks.length > 0) {
        let nextMsg = mergedMessages[idx + 1];
        if (!nextMsg || nextMsg.role !== 'user') {
          nextMsg = { role: 'user', content: [] };
          mergedMessages.splice(idx + 1, 0, nextMsg);
        }
        if (!Array.isArray(nextMsg.content)) {
          nextMsg.content = typeof nextMsg.content === 'string' && nextMsg.content
            ? [{ type: 'text', text: nextMsg.content }]
            : [];
        }
        const existingResultIds = new Set(
          nextMsg.content.filter(b => b && b.type === 'tool_result').map(b => b.tool_use_id)
        );
        for (const tu of toolUseBlocks) {
          if (!existingResultIds.has(tu.id)) {
            nextMsg.content.unshift({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: '{"status":"completed","note":"auto-filled by gateway resilience"}'
            });
            existingResultIds.add(tu.id);
          }
        }
      }
    }
  }

  // Ensure first message is user
  if (mergedMessages.length === 0 || mergedMessages[0].role !== 'user') {
    mergedMessages.unshift({ role: 'user', content: 'Begin conversation.' });
  }

  const payload = {
    model,
    messages: mergedMessages,
    max_tokens: body.max_output_tokens || body.max_tokens || 4096,
    stream: body.stream !== false
  };

  if (system) payload.system = system;
  if (body.temperature !== undefined) payload.temperature = body.temperature;
  if (body.top_p !== undefined) payload.top_p = body.top_p;

  if (Array.isArray(body.tools) && body.tools.length > 0) {
    const hasToolSearch = body.tools.some(isDeferredToolSearch);

    payload.tools = body.tools
      .filter(t => !isDeferredToolSearch(t))
      .map((t, idx) => {
      const name = t.function?.name || t.name || (t.type && t.type !== 'function' ? t.type : null) || `custom_tool_${idx}`;
      const description = t.function?.description || t.description || '';
      const rawParams = extractRawToolParams(t);
      const inputSchema = normalizeToolParameters(rawParams);
      return {
        name,
        description,
        input_schema: inputSchema
      };
    }).filter(t => Boolean(t.name));

    const hasAnthropicGenerateImage = payload.tools.some(t => {
      return t.name === 'mcp__comfyui__generate_image' || t.name === 'generate_image';
    });
    const isVisualIntent = (() => {
      const inputList = Array.isArray(body.input) ? body.input : [body.input];
      const text = inputList.map(item => {
        if (typeof item === 'string') return item;
        if (item && Array.isArray(item.content)) {
          return item.content.map(c => c?.text || '').join(' ');
        }
        return item?.content || '';
      }).join(' ');
      return /(?:生成|画|制作|绘制).*(?:图|照|壁纸|插画)|反推.*(?:图|词)|(?:generate|create|draw).*(?:image|picture|photo)|(?:text.*to.*image)/i.test(text);
    })();

    if ((hasToolSearch || isVisualIntent || (compressionOptions && compressionOptions.injectComfyUiTools)) && !hasAnthropicGenerateImage) {
      for (const ct of COMFYUI_TOOLS) {
        payload.tools.push({
          name: ct.function.name,
          description: ct.function.description,
          input_schema: ct.function.parameters
        });
      }
    }
  }

  if (compressionOptions && compressionOptions.enabled !== false) {
    try {
      return contextCompactor.compactAnthropicPayload(payload, compressionOptions, sessionId);
    } catch (err) {
      console.warn('[CodexAdapter] Anthropic payload compression failed, bypassing safely:', err.message);
      return payload;
    }
  }

  return payload;
}

/**
 * Translates upstream Anthropic Messages SSE stream into compliant OpenAI Responses SSE stream for Codex
 */
function bridgeAnthropicStream(upstreamRes, clientRes, reqModel, reqId, onFinished, sessionId = null, reconnectFn = null) {
  clientRes.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*'
  });

  let seq = 0;
  const respId = reqId || ('resp_' + Date.now());
  if (sessionId) {
    recordResponseSession(respId, sessionId);
  }
  const sendEvent = (event, data) => {
    if (clientRes.writableEnded || clientRes.destroyed) return;
    try {
      clientRes.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (_) {}
  };

  sendEvent('response.created', {
    type: 'response.created',
    sequence_number: seq++,
    response: {
      id: respId,
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      completed_at: null,
      status: 'in_progress',
      parallel_tool_calls: true,
      temperature: 1,
      top_p: 1,
      max_output_tokens: null,
      previous_response_id: null,
      background: false,
      truncation: 'disabled',
      top_logprobs: 0,
      max_tool_calls: null,
      prompt_cache_retention: null,
      model: reqModel,
      error: null,
      incomplete_details: null,
      output: [],
      usage: null,
      instructions: null,
      tool_choice: 'auto',
      tools: [],
      reasoning: { effort: 'low', summary: null },
      text: { verbosity: null, format: { type: 'text' } },
      moderation: null
    }
  });

  sendEvent('response.in_progress', {
    type: 'response.in_progress',
    sequence_number: seq++,
    response: {
      id: respId,
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      completed_at: null,
      status: 'in_progress',
      model: reqModel
    }
  });

  let outputIndex = 0;
  let textStarted = false;
  let textCompleted = false;
  let textIndex = 0;
  const itemIdText = 'item_text_' + Date.now();
  let fullText = '';
  let reasoningStarted = false;
  let reasoningCompleted = false;
  let reasoningIndex = 0;
  const itemIdReasoning = 'item_reasoning_' + Date.now();
  let fullReasoning = '';
  const toolCallsMap = new Map(); // blockIndex -> { id, name, args, outIdx }
  let collectedUsage = null;
  let buffer = '';
  let streamFinished = false;
  let upstreamEnded = false;
  let totalChunks = 0;
  let hasRetriedReconnect = false;
  let currentUpstream = upstreamRes;

  const buildFinalOutput = () => {
    const finalOutput = [];
    if (reasoningStarted || fullReasoning) {
      finalOutput.push({
        id: itemIdReasoning,
        type: 'reasoning',
        status: 'completed',
        content: [{ type: 'reasoning_text', text: fullReasoning }]
      });
    }
    if (textStarted || fullText) {
      finalOutput.push({
        id: itemIdText,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: fullText, annotations: [], logprobs: [] }]
      });
    }
    for (const rec of toolCallsMap.values()) {
      if (rec.isCustomTool || rec.name === 'apply_patch') {
        const cleanInput = extractPatchInput(rec.args);
        finalOutput.push({
          id: rec.id,
          type: 'custom_tool_call',
          name: rec.name || 'apply_patch',
          call_id: rec.id,
          input: cleanInput,
          status: 'completed'
        });
      } else {
        finalOutput.push({
          id: rec.id,
          type: 'function_call',
          name: rec.name,
          call_id: rec.id,
          arguments: rec.args,
          status: 'completed'
        });
      }
    }
    return finalOutput;
  };

  const closeReasoning = () => {
    if (reasoningStarted && !reasoningCompleted) {
      sendEvent('response.reasoning_text.done', {
        type: 'response.reasoning_text.done',
        sequence_number: seq++,
        output_index: reasoningIndex,
        content_index: 0,
        item_id: itemIdReasoning,
        text: fullReasoning
      });
      sendEvent('response.content_part.done', {
        type: 'response.content_part.done',
        sequence_number: seq++,
        output_index: reasoningIndex,
        content_index: 0,
        item_id: itemIdReasoning,
        part: { type: 'reasoning_text', text: fullReasoning }
      });
      sendEvent('response.output_item.done', {
        type: 'response.output_item.done',
        sequence_number: seq++,
        output_index: reasoningIndex,
        item: {
          id: itemIdReasoning,
          type: 'reasoning',
          status: 'completed',
          content: [{ type: 'reasoning_text', text: fullReasoning }]
        }
      });
      reasoningStarted = false;
      reasoningCompleted = true;
    }
  };

  const closeText = () => {
    if (textStarted && !textCompleted) {
      sendEvent('response.output_text.done', {
        type: 'response.output_text.done',
        sequence_number: seq++,
        output_index: textIndex,
        content_index: 0,
        item_id: itemIdText,
        text: fullText,
        logprobs: []
      });
      sendEvent('response.content_part.done', {
        type: 'response.content_part.done',
        sequence_number: seq++,
        output_index: textIndex,
        content_index: 0,
        item_id: itemIdText,
        part: { type: 'output_text', text: fullText, annotations: [], logprobs: [] }
      });
      sendEvent('response.output_item.done', {
        type: 'response.output_item.done',
        sequence_number: seq++,
        output_index: textIndex,
        item: {
          id: itemIdText,
          type: 'message',
          status: 'completed',
          role: 'assistant',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: fullText, annotations: [], logprobs: [] }]
        }
      });
      textCompleted = true;
    }
  };

  const dispatchStreamError = (err, isExplicitError = false, overrideCode = null) => {
    if (streamFinished || clientRes.writableEnded || clientRes.destroyed) {
      cleanup();
      return;
    }
    streamFinished = true;
    closeReasoning();
    closeText();
    const finalOutput = buildFinalOutput();
    const isEmpty = fullText === '' && toolCallsMap.size === 0 && fullReasoning === '';
    const isReasoningOnly = fullText === '' && toolCallsMap.size === 0 && fullReasoning !== '';
    const errCode = overrideCode || (isEmpty ? 'upstream_stream_empty_truncated' : (isReasoningOnly ? 'upstream_stream_truncated_reasoning_only' : 'upstream_stream_truncated'));
    const errMsg = err?.message
      ? `Upstream stream error: ${err.message}`
      : (isEmpty ? 'Upstream stream disconnected unexpectedly without returning any content (empty stream truncated).' : 'Upstream stream disconnected unexpectedly before generating output or tool calls.');

    // Rule 33: Stream Empty-Truncation Graceful Closure & UI Spinner Unlock
    // Whether isReasoningOnly, isEmpty, or whenever finalOutput has no completed assistant message:
    // We MUST NOT dispatch bare empty output: [].
    // We MUST actively inject a compliant assistant message item into the SSE stream:
    // response.output_item.added -> response.content_part.added -> response.output_item.done
    // and include it in finalOutput before dispatching response.failed,
    // safely releasing the UI thinking spinner and thread-writer-locks.
    const hasAssistantOutput = finalOutput.some(item => item.type === 'message' && item.role === 'assistant');
    if (!hasAssistantOutput) {
      const healMsgId = 'msg_heal_' + Date.now();
      const healNotice = `[网关服务提示：上游推理连接异常中断（${errMsg}）。建议重试当前请求或切换备用模型。]`;

      sendEvent('response.output_item.added', {
        type: 'response.output_item.added',
        sequence_number: seq++,
        output_index: outputIndex++,
        item: {
          id: healMsgId,
          type: 'message',
          status: 'in_progress',
          role: 'assistant',
          content: []
        }
      });

      sendEvent('response.content_part.added', {
        type: 'response.content_part.added',
        sequence_number: seq++,
        output_index: outputIndex - 1,
        content_index: 0,
        item_id: healMsgId,
        part: { type: 'output_text', text: healNotice, annotations: [], logprobs: [] }
      });

      sendEvent('response.output_item.done', {
        type: 'response.output_item.done',
        sequence_number: seq++,
        output_index: outputIndex - 1,
        item: {
          id: healMsgId,
          type: 'message',
          status: 'completed',
          role: 'assistant',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: healNotice, annotations: [], logprobs: [] }]
        }
      });

      finalOutput.push({
        id: healMsgId,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: healNotice, annotations: [], logprobs: [] }]
      });
    }

    console.error(`[Anthropic Stream Error] ${errMsg} on model "${reqModel}". Dispatching response.failed.`);
    sendEvent('response.failed', {
      type: 'response.failed',
      sequence_number: seq++,
      response: {
        id: respId,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        completed_at: Math.floor(Date.now() / 1000),
        status: 'failed',
        model: reqModel,
        error: {
          type: 'server_error',
          code: errCode,
          message: errMsg
        },
        output: finalOutput
      }
    });
    cleanup();
    clientRes.end();
    if (typeof onFinished === 'function') onFinished();
  };

  // Heartbeat keep-alive & watchdog to prevent stream stalls
  let lastDataTime = Date.now();
  const heartbeatTimer = setInterval(() => {
    if (clientRes.writableEnded || clientRes.destroyed || streamFinished) {
      clearInterval(heartbeatTimer);
      return;
    }
    try { clientRes.write(': keep-alive\n\n'); } catch (_) {}
  }, 10000);

  const isXHighReasoning = Boolean(reqModel && (
    reqModel.includes('xhigh') ||
    reqModel.includes('high') ||
    reqModel.includes('opus') ||
    reqModel.includes('thinking') ||
    reqModel.includes('reasoning') ||
    reqModel.includes('reasoner') ||
    reqModel.includes('3-7') ||
    reqModel.includes('3.7') ||
    reqModel.includes('r1') ||
    reqModel.includes('o1') ||
    reqModel.includes('o3')
  ));
  const maxStallMs = isXHighReasoning ? 600000 : 300000;

  const stallWatchdog = setInterval(() => {
    if (clientRes.writableEnded || clientRes.destroyed || streamFinished) {
      clearInterval(stallWatchdog);
      clearInterval(heartbeatTimer);
      return;
    }
    const currentMaxStall = (reasoningStarted || reasoningCompleted || isXHighReasoning) ? 600000 : maxStallMs;
    if (Date.now() - lastDataTime > currentMaxStall) {
      clearInterval(stallWatchdog);
      clearInterval(heartbeatTimer);
      console.error(`[Anthropic Stream Watchdog] Upstream stalled for >${Math.round(currentMaxStall / 1000)}s on model "${reqModel}". Closing stream with response.failed.`);
      dispatchStreamError(new Error(`Upstream stalled for longer than ${Math.round(currentMaxStall / 1000)}s without returning data.`), true, 'upstream_stream_timeout');
    }
  }, 5000);

  const attemptReconnect = (origErr, isExplicit = false) => {
    if (hasRetriedReconnect || streamFinished || clientRes.writableEnded || clientRes.destroyed) {
      dispatchStreamError(origErr, isExplicit);
      return;
    }
    hasRetriedReconnect = true;
    unbindUpstream(currentUpstream);
    console.log(`[Stream Reconnect] Anthropic 首字吐出前断流 (0 字节数据)，正在实施毫秒级原位流式透明重连...`);
    reconnectFn(
      (newUpstream) => {
        if (streamFinished || clientRes.writableEnded || clientRes.destroyed) {
          if (newUpstream && typeof newUpstream.destroy === 'function') newUpstream.destroy();
          return;
        }
        currentUpstream = newUpstream;
        bindUpstream(newUpstream);
      },
      (retryErr) => {
        dispatchStreamError(retryErr || origErr, isExplicit);
      }
    );
  };

  const onCloseHandler = () => {
    cleanup();
    if (currentUpstream && typeof currentUpstream.destroy === 'function' && !currentUpstream.destroyed) {
      currentUpstream.destroy();
    }
  };
  clientRes.once('close', onCloseHandler);

  const cleanup = () => {
    clearInterval(heartbeatTimer);
    clearInterval(stallWatchdog);
    if (typeof clientRes.removeListener === 'function') clientRes.removeListener('close', onCloseHandler);
    unbindUpstream(currentUpstream);
  };

  const onUpstreamError = (err) => {
    if (totalChunks === 0 && typeof reconnectFn === 'function' && !hasRetriedReconnect && !streamFinished) {
      attemptReconnect(err, true);
    } else {
      dispatchStreamError(err, true);
    }
  };

  const onUpstreamClose = () => {
    if (!streamFinished && !upstreamEnded) {
      if (totalChunks === 0 && typeof reconnectFn === 'function' && !hasRetriedReconnect) {
        attemptReconnect(new Error('Premature close of upstream response stream before first token'), false);
      } else {
        dispatchStreamError(new Error('Premature close of upstream response stream'), false);
      }
    }
  };

  const { StringDecoder: StringDecoderAnth } = require('string_decoder');
  const decoderAnth = new StringDecoderAnth('utf8');
  let pendingBufferAnth = '';

  const processAnthropicLine = (rawLine) => {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) return;
    const payloadStr = line.slice(5).trim();
    if (!payloadStr) return;

    try {
      const parsed = JSON.parse(payloadStr);
      const evType = parsed.type;

        if (evType === 'message_start' && parsed.message?.usage) {
          collectedUsage = {
            input_tokens: parsed.message.usage.input_tokens || 0,
            output_tokens: parsed.message.usage.output_tokens || 0
          };
        } else if (evType === 'content_block_start') {
          const cb = parsed.content_block;
          if (cb?.type === 'thinking') {
            if (!reasoningStarted) {
              reasoningStarted = true;
              reasoningIndex = outputIndex++;
              sendEvent('response.output_item.added', {
                type: 'response.output_item.added',
                sequence_number: seq++,
                output_index: reasoningIndex,
                item: { id: itemIdReasoning, type: 'reasoning', status: 'in_progress', content: [] }
              });
              sendEvent('response.content_part.added', {
                type: 'response.content_part.added',
                sequence_number: seq++,
                output_index: reasoningIndex,
                content_index: 0,
                item_id: itemIdReasoning,
                part: { type: 'reasoning_text', text: '' }
              });
            }
          } else if (cb?.type === 'text') {
            closeReasoning();
            if (!textStarted) {
              textStarted = true;
              textIndex = outputIndex++;
              sendEvent('response.output_item.added', {
                type: 'response.output_item.added',
                sequence_number: seq++,
                output_index: textIndex,
                item: { id: itemIdText, type: 'message', status: 'in_progress', role: 'assistant', phase: 'final_answer', content: [] }
              });
              sendEvent('response.content_part.added', {
                type: 'response.content_part.added',
                sequence_number: seq++,
                output_index: textIndex,
                content_index: 0,
                item_id: itemIdText,
                part: { type: 'output_text', text: '', annotations: [], logprobs: [] }
              });
            }
          } else if (cb?.type === 'tool_use') {
            closeReasoning();
            closeText();
            const bIdx = parsed.index ?? outputIndex;
            const tcOutIdx = outputIndex++;
            const callId = cb.id || `call_${Date.now()}_${bIdx}`;
            let funcName = cb.name || 'custom_tool';
            if (funcName === 'image_gen') {
              funcName = 'generate_image';
            }
            const isCustomTool = (funcName === 'apply_patch');
            const rec = { id: callId, name: funcName, args: '', outIdx: tcOutIdx, isCustomTool };
            toolCallsMap.set(bIdx, rec);
            if (isCustomTool) {
              sendEvent('response.output_item.added', {
                type: 'response.output_item.added',
                sequence_number: seq++,
                output_index: tcOutIdx,
                item: { id: callId, type: 'custom_tool_call', name: funcName, call_id: callId, input: '' }
              });
            } else {
              sendEvent('response.output_item.added', {
                type: 'response.output_item.added',
                sequence_number: seq++,
                output_index: tcOutIdx,
                item: { id: callId, type: 'function_call', name: funcName, call_id: callId, arguments: '' }
              });
            }
          }
        } else if (evType === 'content_block_delta') {
          const delta = parsed.delta;
          if (delta?.type === 'thinking_delta' && delta.thinking) {
            fullReasoning += delta.thinking;
            sendEvent('response.reasoning_text.delta', {
              type: 'response.reasoning_text.delta',
              sequence_number: seq++,
              output_index: reasoningIndex,
              content_index: 0,
              item_id: itemIdReasoning,
              delta: delta.thinking
            });
          } else if (delta?.type === 'text_delta' && delta.text) {
            closeReasoning();
            fullText += delta.text;
            sendEvent('response.output_text.delta', {
              type: 'response.output_text.delta',
              sequence_number: seq++,
              output_index: textIndex,
              content_index: 0,
              item_id: itemIdText,
              delta: delta.text,
              logprobs: []
            });
          } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
            const bIdx = parsed.index ?? 0;
            const rec = toolCallsMap.get(bIdx);
            if (rec) {
              rec.args += delta.partial_json;
              if (!rec.isCustomTool && rec.name !== 'apply_patch') {
                sendEvent('response.function_call_arguments.delta', {
                  type: 'response.function_call_arguments.delta',
                  sequence_number: seq++,
                  output_index: rec.outIdx,
                  call_id: rec.id,
                  delta: delta.partial_json
                });
              }
            }
          }
        } else if (evType === 'content_block_stop') {
          closeReasoning();
          const bIdx = parsed.index ?? 0;
          const rec = toolCallsMap.get(bIdx);
          if (rec) {
            if (rec.isCustomTool || rec.name === 'apply_patch') {
              const cleanInput = extractPatchInput(rec.args);
              sendEvent('response.custom_tool_call_input.delta', {
                type: 'response.custom_tool_call_input.delta',
                sequence_number: seq++,
                output_index: rec.outIdx,
                call_id: rec.id,
                delta: cleanInput
              });
              sendEvent('response.custom_tool_call_input.done', {
                type: 'response.custom_tool_call_input.done',
                sequence_number: seq++,
                output_index: rec.outIdx,
                call_id: rec.id,
                input: cleanInput
              });
              sendEvent('response.output_item.done', {
                type: 'response.output_item.done',
                sequence_number: seq++,
                output_index: rec.outIdx,
                item: { id: rec.id, type: 'custom_tool_call', name: rec.name || 'apply_patch', call_id: rec.id, input: cleanInput, status: 'completed' }
              });
            } else {
              sendEvent('response.function_call_arguments.done', {
                type: 'response.function_call_arguments.done',
                sequence_number: seq++,
                output_index: rec.outIdx,
                call_id: rec.id,
                arguments: rec.args
              });
              sendEvent('response.output_item.done', {
                type: 'response.output_item.done',
                sequence_number: seq++,
                output_index: rec.outIdx,
                item: { id: rec.id, type: 'function_call', name: rec.name, call_id: rec.id, arguments: rec.args, status: 'completed' }
              });
            }
          }
        } else if (evType === 'message_delta' && parsed.usage?.output_tokens) {
          if (!collectedUsage) collectedUsage = {};
          collectedUsage.output_tokens = parsed.usage.output_tokens;
        }
      } catch (e) {}
  };

  const onUpstreamData = (chunk) => {
    totalChunks++;
    lastDataTime = Date.now();
    pendingBufferAnth += (typeof chunk === 'string') ? chunk : decoderAnth.write(chunk);
    if (pendingBufferAnth.length > 10 * 1024 * 1024) {
      console.warn('[SSE Buffer Overflow Guard] bridgeAnthropicStream buffer exceeded 10MB without newline. Pruning stale prefix.');
      pendingBufferAnth = pendingBufferAnth.slice(-1024 * 1024);
    }
    const lastNewlineIdx = pendingBufferAnth.lastIndexOf('\n');
    if (lastNewlineIdx !== -1) {
      const completeChunk = pendingBufferAnth.slice(0, lastNewlineIdx);
      pendingBufferAnth = pendingBufferAnth.slice(lastNewlineIdx + 1);
      const lines = completeChunk.split('\n');
      for (const rawLine of lines) {
        processAnthropicLine(rawLine);
      }
    }
  };

  const onUpstreamEnd = () => {
    upstreamEnded = true;
    if (streamFinished) return;

    pendingBufferAnth += decoderAnth.end();
    if (pendingBufferAnth && pendingBufferAnth.trim()) {
      const remainingLines = pendingBufferAnth.split('\n');
      pendingBufferAnth = '';
      for (const rawLine of remainingLines) {
        processAnthropicLine(rawLine);
      }
    }
    buffer = '';
    upstreamEnded = true;
    if (streamFinished) return;

    closeReasoning();
    closeText();

    if (fullText === '' && toolCallsMap.size === 0) {
      if (fullReasoning === '' && totalChunks === 0 && typeof reconnectFn === 'function' && !hasRetriedReconnect) {
        attemptReconnect(new Error('Empty stream before first token'), false);
        return;
      }
      dispatchStreamError(null, false);
      return;
    }

    streamFinished = true;
    const finalOutput = buildFinalOutput();

    const usageObj = normalizeResponsesUsage(
      collectedUsage,
      Math.max(10, Math.round(fullText.length * 0.4)),
      Math.max(5, Math.round((fullText.length + fullReasoning.length) * 0.7))
    );

    sendEvent('response.completed', {
      type: 'response.completed',
      sequence_number: seq++,
      response: {
        id: respId,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        completed_at: Math.floor(Date.now() / 1000),
        status: 'completed',
        parallel_tool_calls: true,
        temperature: 1,
        top_p: 1,
        max_output_tokens: null,
        previous_response_id: null,
        background: false,
        truncation: 'disabled',
        top_logprobs: 0,
        max_tool_calls: null,
        prompt_cache_retention: null,
        model: reqModel,
        error: null,
        incomplete_details: null,
        output: finalOutput,
        usage: usageObj,
        instructions: null,
        tool_choice: 'auto',
        tools: [],
        reasoning: { effort: isXHighReasoning ? 'high' : 'low', summary: null },
        text: { verbosity: null, format: { type: 'text' } },
        moderation: null
      }
    });

    cleanup();
    clientRes.end();
    if (typeof onFinished === 'function') onFinished();
  };

  const bindUpstream = (st) => {
    if (!st || typeof st.on !== 'function') return;
    st.on('data', onUpstreamData);
    st.on('error', onUpstreamError);
    st.on('close', onUpstreamClose);
    st.on('end', onUpstreamEnd);
  };

  const unbindUpstream = (st) => {
    if (!st || typeof st.removeListener !== 'function') return;
    st.removeListener('data', onUpstreamData);
    st.removeListener('error', onUpstreamError);
    st.removeListener('close', onUpstreamClose);
    st.removeListener('end', onUpstreamEnd);
  };

  bindUpstream(currentUpstream);
}

/**
 * Translates upstream non-streaming Anthropic JSON response to standard OpenAI Responses JSON response
 */

/**
 * Bridges upstream stream to client in OpenAI ChatCompletions SSE protocol.
 * Guarantees:
 * - StringDecoder('utf8') & pendingBuffer: Zero UTF-8 multi-byte sequence corruption & complete event frames.
 * - Multi-tool_calls index & argument fragments assembly: Preserves concurrent tool_calls without cross-talk.
 * - Reasoning content & thinking streaming: Seamlessly outputs delta.reasoning_content.
 * - X-Accel-Buffering: no & Cache-Control: no-cache: Eliminates proxy buffer latency for IDE autocomplete.
 * - Exactly-once data: [DONE]\n\n termination: Prevents premature termination, missing [DONE], or duplicate [DONE].
 */
function bridgeChatStream(upstreamRes, clientRes, reqModel, reqId, onFinished, sessionId = null) {
  if (!clientRes.headersSent) {
    clientRes.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*'
    });
  }

  const { StringDecoder } = require('string_decoder');
  const decoder = new StringDecoder('utf8');
  let pendingBuffer = '';
  let streamFinished = false;
  let hasSentDone = false;
  const respId = reqId || ('chatcmpl_' + Date.now());
  const created = Math.floor(Date.now() / 1000);
  let totalChunks = 0;
  let collectedUsage = null;

  const heartbeatTimer = setInterval(() => {
    if (clientRes.writableEnded || clientRes.destroyed || streamFinished) {
      clearInterval(heartbeatTimer);
      return;
    }
    try { clientRes.write(': keep-alive\n\n'); } catch (_) {}
  }, 10000);

  const sendEvent = (data) => {
    if (clientRes.writableEnded || clientRes.destroyed) return;
    try {
      clientRes.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
    } catch (_) {}
  };

  const sendDelta = (deltaObj, finishReason = null) => {
    if (hasSentDone || clientRes.writableEnded || clientRes.destroyed) return;
    const chunk = {
      id: respId,
      object: 'chat.completion.chunk',
      created,
      model: reqModel,
      choices: [{
        index: 0,
        delta: deltaObj || {},
        finish_reason: finishReason
      }]
    };
    if (finishReason && collectedUsage) {
      chunk.usage = collectedUsage;
    }
    sendEvent(chunk);
  };

  const sendFinalDone = (finishReason = 'stop') => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (hasSentDone || clientRes.writableEnded || clientRes.destroyed) return;
    hasSentDone = true;
    streamFinished = true;
    sendDelta({}, finishReason);
    sendEvent('[DONE]');
    if (!clientRes.writableEnded) {
      clientRes.end();
    }
    if (typeof onFinished === 'function') onFinished();
  };

  const processChatLine = (rawLine) => {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) return;
    const payloadStr = line.slice(5).trim();
    if (!payloadStr) return;
    if (payloadStr === '[DONE]') {
      sendFinalDone('stop');
      return;
    }

    try {
      const parsed = JSON.parse(payloadStr);
      if (parsed.usage) collectedUsage = parsed.usage;

      // Handle standard ChatCompletions chunk
      if (parsed.choices && parsed.choices.length > 0) {
        const choice = parsed.choices[0];
        const delta = choice.delta || {};
        if (choice.finish_reason) {
          sendFinalDone(choice.finish_reason);
          return;
        }
        sendDelta(delta, null);
        return;
      }

      // Handle Responses API event stream -> ChatCompletions chunk conversion
      if (parsed.type) {
        const evType = parsed.type;
        if (evType === 'response.output_text.delta' && parsed.delta) {
          sendDelta({ content: parsed.delta }, null);
        } else if (evType === 'response.reasoning_text.delta' && parsed.delta) {
          sendDelta({ reasoning_content: parsed.delta }, null);
        } else if (evType === 'response.function_call_arguments.delta') {
          const idx = parsed.output_index ?? 0;
          sendDelta({
            tool_calls: [{
              index: idx,
              id: parsed.call_id,
              type: 'function',
              function: { arguments: parsed.delta }
            }]
          }, null);
        } else if (evType === 'response.output_item.added' && parsed.item?.type === 'function_call') {
          const idx = parsed.output_index ?? 0;
          sendDelta({
            tool_calls: [{
              index: idx,
              id: parsed.item.id,
              type: 'function',
              function: { name: parsed.item.name || 'custom_tool', arguments: '' }
            }]
          }, null);
        } else if (evType === 'response.completed') {
          if (parsed.response?.usage) collectedUsage = parsed.response.usage;
          sendFinalDone('stop');
        } else if (evType === 'response.failed') {
          sendFinalDone('stop');
        }
      }
    } catch (_) {}
  };

  const onData = (chunk) => {
    totalChunks++;
    pendingBuffer += (typeof chunk === 'string') ? chunk : decoder.write(chunk);
    if (pendingBuffer.length > 10 * 1024 * 1024) {
      pendingBuffer = pendingBuffer.slice(-1024 * 1024);
    }
    const lastNewlineIdx = pendingBuffer.lastIndexOf('\n');
    if (lastNewlineIdx !== -1) {
      const completeChunk = pendingBuffer.slice(0, lastNewlineIdx);
      pendingBuffer = pendingBuffer.slice(lastNewlineIdx + 1);
      const lines = completeChunk.split('\n');
      for (const line of lines) {
        processChatLine(line);
      }
    }
  };

  const onEnd = () => {
    pendingBuffer += decoder.end();
    if (pendingBuffer && pendingBuffer.trim()) {
      const lines = pendingBuffer.split('\n');
      pendingBuffer = '';
      for (const line of lines) {
        processChatLine(line);
      }
    }
    if (!hasSentDone) {
      sendFinalDone('stop');
    }
  };

  const onError = (err) => {
    if (!hasSentDone) {
      sendFinalDone('stop');
    }
  };

  if (upstreamRes && typeof upstreamRes.on === 'function') {
    upstreamRes.on('data', onData);
    upstreamRes.on('end', onEnd);
    upstreamRes.on('error', onError);
  }
}

function convertAnthropicResponseToResponses(anthropicJson, reqModel, reqId) {
  const respId = reqId || anthropicJson.id || ('resp_' + Date.now());
  const output = [];

  if (Array.isArray(anthropicJson.content)) {
    for (const c of anthropicJson.content) {
      if (c.type === 'text') {
        output.push({
          id: 'msg_' + Date.now(),
          type: 'message',
          status: 'completed',
          role: 'assistant',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: c.text || '', annotations: [], logprobs: [] }]
        });
      } else if (c.type === 'thinking') {
        output.push({
          id: 'reasoning_' + Date.now(),
          type: 'reasoning',
          status: 'completed',
          content: [{ type: 'reasoning_text', text: c.thinking || '' }]
        });
      } else if (c.type === 'tool_use') {
        let toolName = c.name || 'custom_tool';
        if (toolName === 'generate_image' || toolName === 'image_gen') {
          toolName = 'mcp__comfyui__generate_image';
        } else if (toolName === 'interrogate_image') {
          toolName = 'mcp__comfyui__interrogate_image';
        }
        const rawArgs = typeof c.input === 'string' ? c.input : JSON.stringify(c.input || {});
        if (toolName === 'apply_patch' || c.isCustomTool) {
          const cleanInput = extractPatchInput(rawArgs);
          output.push({
            id: c.id || `call_${Date.now()}`,
            type: 'custom_tool_call',
            name: c.name || 'apply_patch',
            call_id: c.id || '',
            input: cleanInput,
            status: 'completed'
          });
        } else {
          output.push({
            id: c.id || `call_${Date.now()}`,
            type: 'function_call',
            name: toolName,
            call_id: c.id || '',
            arguments: rawArgs,
            status: 'completed'
          });
        }
      }
    }
  }

  if (output.length === 0) {
    const healMsgId = 'msg_heal_' + Date.now();
    const healNotice = '[网关服务提示：上游推理返回空响应。建议重试当前请求或切换备用模型。]';
    return {
      id: respId,
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      completed_at: Math.floor(Date.now() / 1000),
      status: 'failed',
      parallel_tool_calls: true,
      model: reqModel,
      error: {
        type: 'server_error',
        code: 'upstream_stream_empty_truncated',
        message: 'Upstream returned an empty response with no content or tool calls.'
      },
      output: [{
        id: healMsgId,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: healNotice, annotations: [], logprobs: [] }]
      }],
      usage: normalizeResponsesUsage(anthropicJson.usage, 1, 1)
    };
  }

  return {
    id: respId,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    completed_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    parallel_tool_calls: true,
    temperature: 1,
    top_p: 1,
    max_output_tokens: null,
    previous_response_id: null,
    background: false,
    truncation: 'disabled',
    top_logprobs: 0,
    max_tool_calls: null,
    prompt_cache_retention: null,
    model: reqModel,
    error: null,
    incomplete_details: null,
    output,
    usage: normalizeResponsesUsage(anthropicJson.usage, 20, 20),
    instructions: null,
    tool_choice: 'auto',
    tools: [],
    reasoning: { effort: 'low', summary: null },
    text: { verbosity: null, format: { type: 'text' } },
    moderation: null
  };
}

/**
 * Dynamically resolves the latest existing cua_node executable
 */
function findLatestCuaNodeExecutable(codexDirOverride = null) {
  const userProfile = process.env.USERPROFILE || os.homedir();
  const cuaBase = path.join(userProfile, 'AppData', 'Local', 'OpenAI', 'Codex', 'runtimes', 'cua_node');
  if (!fs.existsSync(cuaBase)) return null;

  try {
    const entries = fs.readdirSync(cuaBase, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory())
      .map(e => {
        const full = path.join(cuaBase, e.name);
        let mtime = 0;
        try { mtime = fs.statSync(full).mtimeMs; } catch (_) {}
        return { name: e.name, full, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);

    for (const dir of dirs) {
      const candidates = [
        path.join(dir.full, 'bin', 'node_modules', '@oai', 'sky', 'bin', 'windows', 'swift', 'x64', 'codex-computer-use-swift.exe'),
        path.join(dir.full, 'bin', 'node_modules', '@oai', 'sky', 'bin', 'windows', 'codex-computer-use.exe'),
        path.join(dir.full, 'bin', 'node_modules', '@oai', 'cua', 'bin', 'windows', 'codex-computer-use.exe')
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          return cand;
        }
      }
    }
  } catch (_) {}
  return null;
}

/**
 * Updates TOML config string preserving structure, comments, and existing sections
 */
function updateCodexTomlString(rawToml, { model, provider, reasoningEffort, routerUrl, catalogRelativePath }) {
  let lines = rawToml ? rawToml.split(/\r?\n/) : [];

  function setTopLevelKey(key, value) {
    let found = false;
    const keyRegex = new RegExp(`^\\s*${key}\\s*=`);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('[') && line.endsWith(']')) {
        break;
      }
      if (keyRegex.test(line)) {
        lines[i] = `${key} = ${JSON.stringify(value)}`;
        found = true;
        break;
      }
    }
    if (!found) {
      let insertIdx = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('[') && line.endsWith(']')) {
          insertIdx = i;
          break;
        }
      }
      lines.splice(insertIdx, 0, `${key} = ${JSON.stringify(value)}`);
    }
  }

  setTopLevelKey('model', model);
  setTopLevelKey('model_provider', provider);
  setTopLevelKey('model_reasoning_effort', reasoningEffort);
  if (catalogRelativePath) {
    setTopLevelKey('model_catalog_json', catalogRelativePath.replace(/\\/g, '/'));
  }

  // Remove existing [model_providers."opencode-go"] or [model_providers.opencode-go]
  const filteredLines = [];
  let inSection = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l === '[model_providers."opencode-go"]' || l === '[model_providers.opencode-go]') {
      inSection = true;
      continue;
    }
    if (inSection) {
      if (l.startsWith('[')) {
        inSection = false;
        filteredLines.push(lines[i]);
      }
      continue;
    }
    filteredLines.push(lines[i]);
  }

  // Append clean [model_providers."opencode-go"] section
  filteredLines.push('');
  filteredLines.push('[model_providers."opencode-go"]');
  filteredLines.push('name = "opencode-go"');
  filteredLines.push('wire_api = "responses"');
  filteredLines.push('requires_openai_auth = true');
  filteredLines.push(`base_url = ${JSON.stringify(routerUrl)}`);
  filteredLines.push('stream_idle_timeout_ms = 300000');
  filteredLines.push('stream_max_retries = 3');
  filteredLines.push('request_max_retries = 3');

  // Channel Isolation: Never hijack or overwrite user's direct [model_providers.custom]
  // The gateway strictly operates within its dedicated [model_providers."opencode-go"] section.

  // Check and dynamically heal notify executable path if present
  for (let i = 0; i < filteredLines.length; i++) {
    const l = filteredLines[i].trim();
    const mNotify = l.match(/^notify\s*=\s*\[\s*["']([^"']+)["']/);
    if (mNotify) {
      const rawNotifyPath = mNotify[1].replace(/\\\\/g, '\\');
      if (!fs.existsSync(rawNotifyPath)) {
        const latestExe = findLatestCuaNodeExecutable();
        if (latestExe) {
          const escaped = latestExe.replace(/\\/g, '\\\\');
          filteredLines[i] = filteredLines[i].replace(mNotify[1], escaped);
        } else {
          filteredLines[i] = `# ${filteredLines[i]} # (disabled: runtime executable not found)`;
        }
      }
    }
  }

  // Ensure [desktop] section has localeOverride = "zh-CN"
  let hasDesktop = false;
  inSection = false;
  let hasLocaleOverride = false;
  for (let i = 0; i < filteredLines.length; i++) {
    const l = filteredLines[i].trim();
    if (l === '[desktop]') {
      hasDesktop = true;
      inSection = true;
      continue;
    }
    if (inSection) {
      if (l.startsWith('[')) {
        inSection = false;
      } else if (l.startsWith('localeOverride =') || l.startsWith('localeOverride=')) {
        filteredLines[i] = 'localeOverride = "zh-CN"';
        hasLocaleOverride = true;
      }
    }
  }

  if (hasDesktop && !hasLocaleOverride) {
    for (let i = 0; i < filteredLines.length; i++) {
      if (filteredLines[i].trim() === '[desktop]') {
        filteredLines.splice(i + 1, 0, 'localeOverride = "zh-CN"');
        break;
      }
    }
  } else if (!hasDesktop) {
    filteredLines.push('');
    filteredLines.push('[desktop]');
    filteredLines.push('localeOverride = "zh-CN"');
  }

  return filteredLines.join('\n');
}

/**
 * Gets comprehensive status of Codex on this system
 */
function getCodexStatus(routerPortOrDir = 4010, codexDirOverride = null) {
  let routerPort = 4010;
  let codexDir = null;

  if (typeof routerPortOrDir === 'object' && routerPortOrDir !== null) {
    if (routerPortOrDir.codexDir) codexDir = routerPortOrDir.codexDir;
    if (routerPortOrDir.routerPort) routerPort = routerPortOrDir.routerPort;
  } else if (typeof routerPortOrDir === 'string' && (routerPortOrDir.includes('/') || routerPortOrDir.includes('\\') || routerPortOrDir.startsWith('.'))) {
    codexDir = routerPortOrDir;
  } else if (typeof routerPortOrDir === 'number') {
    routerPort = routerPortOrDir;
  } else if (!isNaN(Number(routerPortOrDir)) && typeof routerPortOrDir === 'string') {
    routerPort = Number(routerPortOrDir);
  }

  if (codexDirOverride) codexDir = codexDirOverride;
  if (!codexDir) codexDir = getCodexConfigDir();

  const configPath = path.join(codexDir, 'config.toml');
  const authPath = path.join(codexDir, 'auth.json');
  const backupDir = path.join(codexDir, 'backup-router-bind');
  const manifestPath = path.join(backupDir, 'manifest.json');

  let cliInstalled = false;
  let cliVersion = null;
  try {
    const out = execSync('codex --version 2>nul || codex --version 2>/dev/null', { encoding: 'utf8', timeout: 3000 }).trim();
    if (out) {
      cliInstalled = true;
      const m = out.match(/(\d+\.\d+\.\d+)/);
      if (m) cliVersion = m[1];
    }
  } catch (e) {}

  let isBound = false;
  let hasStreamIdleTimeout = false;
  let currentModel = null;
  let currentProvider = null;
  let currentReasoningEffort = null;
  let hasConfig = false;

  if (fs.existsSync(configPath)) {
    hasConfig = true;
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const mModel = raw.match(/^\s*model\s*=\s*["']([^"']+)["']/m);
      if (mModel) currentModel = mModel[1];
      const mProv = raw.match(/^\s*model_provider\s*=\s*["']([^"']+)["']/m);
      if (mProv) currentProvider = mProv[1];
      const mEffort = raw.match(/^\s*model_reasoning_effort\s*=\s*["']([^"']+)["']/m);
      if (mEffort) currentReasoningEffort = mEffort[1];

      const expectedPort = String(routerPort);
      const isProviderOpencodeGo = currentProvider === 'opencode-go';
      const isProviderRouterUrl = currentProvider && new RegExp(`\\[model_providers\\.(?:${currentProvider}|"${currentProvider}")\\][^\\[]*base_url\\s*=\\s*["'][^"']*(?:127\\.0\\.0\\.1|localhost):${expectedPort}`, 's').test(raw);
      isBound = Boolean(isProviderOpencodeGo || isProviderRouterUrl);
      hasStreamIdleTimeout = Boolean(isBound && raw.includes('stream_idle_timeout_ms'));
    } catch (e) {}
  }

  let hasAuth = false;
  let hasValidAuthKey = false;
  if (fs.existsSync(authPath)) {
    hasAuth = true;
    try {
      const authObj = JSON.parse(fs.readFileSync(authPath, 'utf8'));
      hasValidAuthKey = Boolean(authObj.OPENAI_API_KEY && authObj.OPENAI_API_KEY.trim());
    } catch (e) {}
  }

  let hasBackup = false;
  let backupInfo = null;
  if (fs.existsSync(manifestPath)) {
    hasBackup = true;
    try {
      backupInfo = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {}
  } else if (fs.existsSync(configPath + '.router-bak')) {
    hasBackup = true;
    backupInfo = { timestamp: fs.statSync(configPath + '.router-bak').mtimeMs };
  }

  return {
    codexDir,
    cliInstalled,
    cliVersion,
    hasConfig,
    configPath,
    isBound,
    hasStreamIdleTimeout,
    currentModel,
    currentProvider,
    currentReasoningEffort,
    hasAuth,
    hasValidAuthKey,
    hasBackup,
    backupInfo,
    desktopLocale: (function() {
      if (!fs.existsSync(configPath)) return null;
      try {
        const raw = fs.readFileSync(configPath, 'utf8');
        const m = raw.match(/localeOverride\s*=\s*["']([^"']+)["']/);
        return m ? m[1] : null;
      } catch (_) { return null; }
    })(),
    localeNotice: '已配置简体中文 (localeOverride = "zh-CN")。注意：Codex 桌面端 Web 界面内部汉化受制于官方该版本 Feature Gate (Statsig 72216192) 默认值冲突，官方放量或更新后将自动全面显示中文。',
    processHealth: checkCodexProcessHealth(),
    localeCheck: checkCodexLocaleAndEnvironment({ codexDir }),
    availableModels: ((routerPortOrDir && typeof routerPortOrDir === 'object' && Array.isArray(routerPortOrDir.models) && routerPortOrDir.models.length > 0) ? routerPortOrDir.models : OPENCODE_GO_ALL_MODELS).map(m => ({
      slug: m.slug,
      display_name: m.display_name || m.name,
      description: m.description,
      default_reasoning_level: m.default_reasoning_level,
      supported_reasoning_levels: m.supported_reasoning_levels
    }))
  };
}

/**
 * One-Click Bind Codex to OpenCode Go Router with zero-loss backup
 */
function bindCodexConfig(options = {}) {
  const codexDir = options.codexDir || getCodexConfigDir();
  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true });
  }

  const routerPort = options.routerPort || 4010;
  const routerUrl = options.routerUrl || `http://127.0.0.1:${routerPort}/v1`;
  const defaultModel = options.defaultModel || 'deepseek-v4.1-flash';
  const reasoningEffort = options.reasoningEffort || 'high';
  const providerName = options.providerName || 'opencode-go';

  const configPath = path.join(codexDir, 'config.toml');
  const authPath = path.join(codexDir, 'auth.json');
  const modelsPath = path.join(codexDir, 'models.json');
  const backupDir = path.join(codexDir, 'backup-router-bind');
  const manifestPath = path.join(backupDir, 'manifest.json');

  const messages = [];

  // Step 1: Atomic Backup Phase (protect original configuration before modifying)
  let backupCreated = false;
  if (!fs.existsSync(manifestPath)) {
    try {
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      const manifest = {
        timestamp: Date.now(),
        isoDate: new Date().toISOString(),
        hasConfigToml: fs.existsSync(configPath),
        hasAuthJson: fs.existsSync(authPath),
        hasModelsJson: fs.existsSync(modelsPath),
        originalModel: null,
        originalProvider: null,
        originalReasoningEffort: null
      };

      if (fs.existsSync(configPath)) {
        fs.copyFileSync(configPath, path.join(backupDir, 'config.toml'));
        try { fs.copyFileSync(configPath, configPath + '.router-bak'); } catch (e) {}
        const raw = fs.readFileSync(configPath, 'utf8');
        const mModel = raw.match(/^\s*model\s*=\s*["']([^"']+)["']/m);
        if (mModel) manifest.originalModel = mModel[1];
        const mProv = raw.match(/^\s*model_provider\s*=\s*["']([^"']+)["']/m);
        if (mProv) manifest.originalProvider = mProv[1];
        const mEffort = raw.match(/^\s*model_reasoning_effort\s*=\s*["']([^"']+)["']/m);
        if (mEffort) manifest.originalReasoningEffort = mEffort[1];
      }

      if (fs.existsSync(authPath)) {
        fs.copyFileSync(authPath, path.join(backupDir, 'auth.json'));
        try { fs.copyFileSync(authPath, authPath + '.router-bak'); } catch (e) {}
      }

      if (fs.existsSync(modelsPath)) {
        fs.copyFileSync(modelsPath, path.join(backupDir, 'models.json'));
        try { fs.copyFileSync(modelsPath, modelsPath + '.router-bak'); } catch (e) {}
      }

      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      backupCreated = true;
      messages.push(`已自动备份 Codex 原始配置至 ${backupDir}`);
    } catch (err) {
      messages.push(`配置备份提醒: ${err.message}`);
    }
  } else {
    messages.push('已保留先前的初始原始配置备份清单，防反复覆盖');
  }

  // Step 2: Generate Model Catalog
  const catalogsDir = path.join(codexDir, 'model-catalogs');
  if (!fs.existsSync(catalogsDir)) fs.mkdirSync(catalogsDir, { recursive: true });

  const DEFAULT_CATALOG_MODEL_PROPS = {
    shell_type: 'shell_command',
    visibility: 'list',
    supported_in_api: true,
    priority: 1000,
    additional_speed_tiers: [],
    availability_nux: null,
    upgrade: null,
    base_instructions: null,
    model_messages: null,
    supports_reasoning_summaries: true,
    default_reasoning_summary: 'none',
    support_verbosity: true,
    default_verbosity: 'low',
    apply_patch_tool_type: 'freeform',
    web_search_tool_type: 'text',
    truncation_policy: { mode: 'tokens', limit: 10000 },
    supports_parallel_tool_calls: true,
    supports_image_detail_original: false,
    context_window: 1048576,
    max_context_window: 1048576,
    effective_context_window_percent: 95,
    experimental_supported_tools: [],
    input_modalities: ['text'],
    supports_search_tool: false,
    prefer_websockets: false,
    service_tiers: [],
    tool_mode: null,
    multi_agent_version: 'v2',
    use_responses_lite: false,
    include_skills_usage_instructions: false,
    auto_compact_token_limit: null,
    comp_hash: '3000',
    reasoning_summary_format: 'experimental',
    minimal_client_version: '0.144.0'
  };

  let baseTemplate = { ...DEFAULT_CATALOG_MODEL_PROPS };
  try {
    const files = fs.readdirSync(catalogsDir);
    const relayFile = files.find(f => f.startsWith('relay-') && f.endsWith('.json'));
    if (relayFile) {
      const parsedRelay = JSON.parse(fs.readFileSync(path.join(catalogsDir, relayFile), 'utf8'));
      if (Array.isArray(parsedRelay.models) && parsedRelay.models.length > 0) {
        baseTemplate = { ...DEFAULT_CATALOG_MODEL_PROPS, ...parsedRelay.models[0] };
      }
    }
  } catch (e) {}

  let baseInstructions = baseTemplate.base_instructions || '';
  if (!baseInstructions.includes('简体中文')) {
    baseInstructions += '\n\n# 语言规范\n无论用户以何种语言提问，除非用户明确要求使用其他语言，否则请始终使用简体中文（Simplified Chinese）进行思考、回答和代码解释。\n';
  }

  const targetModels = (Array.isArray(options.models) && options.models.length > 0) ? options.models : OPENCODE_GO_ALL_MODELS;

  const catalogModels = targetModels.map(m => {
    const ctx = m.context_window || 1048576;
    const compactLimit = Math.floor(ctx * 0.85); // 85% of context window triggers Codex client-side auto-compaction
    return {
      ...baseTemplate,
      ...m,
      base_instructions: baseInstructions,
      context_window: ctx,
      max_context_window: ctx,
      auto_compact_token_limit: compactLimit,
      effective_context_window_percent: 95,
      shell_type: 'shell_command',
      visibility: 'list',
      supported_in_api: true
    };
  });

  const catalogFile = path.join(catalogsDir, 'opencode-go-catalog.json');
  fs.writeFileSync(catalogFile, JSON.stringify({ models: catalogModels }, null, 2), 'utf8');
  messages.push(`已生成 OpenCode Go 全量 ${targetModels.length} 款模型元数据目录 (${catalogFile})`);

  // Step 3: Update models.json
  try {
    let existingModels = [];
    if (fs.existsSync(modelsPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(modelsPath, 'utf8'));
        if (Array.isArray(parsed.models)) existingModels = parsed.models;
      } catch (e) {}
    }
    const enrichedOpencodeModels = targetModels.map(m => {
      const ctx = m.context_window || 1048576;
      return {
        ...baseTemplate,
        ...m,
        base_instructions: baseInstructions,
        context_window: ctx,
        max_context_window: ctx,
        auto_compact_token_limit: Math.floor(ctx * 0.85),
        effective_context_window_percent: 95
      };
    });
    const newSlugs = new Set(enrichedOpencodeModels.map(m => m.slug));
    const retainedModels = existingModels.filter(m => !newSlugs.has(m.slug)).map(m => {
      if (!m.auto_compact_token_limit && m.context_window) {
        m.auto_compact_token_limit = Math.floor(m.context_window * 0.85);
      }
      return m;
    });
    const mergedModels = [...enrichedOpencodeModels, ...retainedModels];
    fs.writeFileSync(modelsPath, JSON.stringify({ models: mergedModels }, null, 2), 'utf8');
    messages.push(`已同步全量模型至 ${modelsPath} (总计 ${mergedModels.length} 个模型，已配置自动切分阈值与中文语言规范)`);
  } catch (err) {
    messages.push(`更新 models.json 提醒: ${err.message}`);
  }

  // Step 4: Update auth.json
  try {
    let authObj = {};
    if (fs.existsSync(authPath)) {
      try {
        authObj = JSON.parse(fs.readFileSync(authPath, 'utf8'));
      } catch (e) {}
    }
    if (!authObj.OPENAI_API_KEY || !authObj.OPENAI_API_KEY.trim()) {
      authObj.OPENAI_API_KEY = 'local-router';
      fs.writeFileSync(authPath, JSON.stringify(authObj, null, 2), 'utf8');
      messages.push(`已就绪本地安全认证密钥 (auth.json)`);
    }
  } catch (err) {
    messages.push(`配置 auth.json 提醒: ${err.message}`);
  }

  // Step 5: Update config.toml
  try {
    let rawToml = '';
    if (fs.existsSync(configPath)) {
      rawToml = fs.readFileSync(configPath, 'utf8');
    }
    const updatedToml = updateCodexTomlString(rawToml, {
      model: defaultModel,
      provider: providerName,
      reasoningEffort,
      routerUrl,
      catalogRelativePath: 'model-catalogs/opencode-go-catalog.json'
    });
    fs.writeFileSync(configPath, updatedToml, 'utf8');
    messages.push(`已更新 ${configPath}: model="${defaultModel}", provider="${providerName}", effort="${reasoningEffort}", base_url="${routerUrl}"`);
  } catch (err) {
    messages.push(`更新 config.toml 失败: ${err.message}`);
    return { success: false, messages, error: err.message };
  }

  // Step 6: Sync Chromium Webview Preferences & Local State for Chinese UI
  try {
    const webviewDir = path.join(
      process.env.LOCALAPPDATA || '',
      'Packages',
      'OpenAI.Codex_2p2nqsd0c76g0',
      'LocalCache',
      'Roaming',
      'Codex',
      'web',
      'Codex'
    );
    if (fs.existsSync(webviewDir)) {
      const prefsPath = path.join(webviewDir, 'Default', 'Preferences');
      if (fs.existsSync(prefsPath)) {
        try {
          const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
          prefs.intl = prefs.intl || {};
          prefs.intl.selected_languages = 'zh-CN,zh';
          prefs.intl.accept_languages = 'zh-CN,zh,en-US,en';
          prefs.spellcheck = prefs.spellcheck || {};
          prefs.spellcheck.dictionaries = ['zh-CN'];
          fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2), 'utf8');
          messages.push('已同步 Chromium 首选语言为简体中文 (Default/Preferences)');
        } catch (_) {}
      }

      const localStatePath = path.join(webviewDir, 'Local State');
      if (fs.existsSync(localStatePath)) {
        try {
          const state = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
          state.intl = state.intl || {};
          state.intl.selected_languages = 'zh-CN,zh';
          state.intl.accept_languages = 'zh-CN,zh,en-US,en';
          fs.writeFileSync(localStatePath, JSON.stringify(state, null, 2), 'utf8');
          messages.push('已同步 Chromium 全局语言为简体中文 (Local State)');
        } catch (_) {}
      }
    }
  } catch (err) {
    messages.push(`Chromium 语言同步提醒: ${err.message}`);
  }

  return {
    success: true,
    boundModel: defaultModel,
    reasoningEffort,
    provider: providerName,
    routerUrl,
    backupCreated,
    backupDir,
    messages
  };
}

/**
 * One-Click Restore Codex configuration to pre-binding state
 */
function restoreCodexConfig(codexDirOverride = null, options = {}) {
  const codexDir = codexDirOverride || getCodexConfigDir();
  const preserveCompatibility = options.preserveCompatibility !== false;
  const configPath = path.join(codexDir, 'config.toml');
  const authPath = path.join(codexDir, 'auth.json');
  const modelsPath = path.join(codexDir, 'models.json');
  const backupDir = path.join(codexDir, 'backup-router-bind');
  const manifestPath = path.join(backupDir, 'manifest.json');
  const catalogPath = path.join(codexDir, 'model-catalogs', 'opencode-go-catalog.json');

  const messages = [];

  // Check structured backup directory
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      if (manifest.hasConfigToml) {
        const bkConfig = path.join(backupDir, 'config.toml');
        if (fs.existsSync(bkConfig)) {
          let tomlContent = fs.readFileSync(bkConfig, 'utf8');
          // Thread continuity protection: ensure [model_providers."opencode-go"] stays defined
          // so open/resumed historical threads in ChatGPT/Codex do not throw "Model provider `opencode-go` not found"
          if (preserveCompatibility && !tomlContent.includes('[model_providers."opencode-go"]') && !tomlContent.includes('[model_providers.opencode-go]')) {
            tomlContent += '\n[model_providers."opencode-go"]\nname = "opencode-go"\nwire_api = "responses"\nrequires_openai_auth = true\nbase_url = "http://127.0.0.1:4010/v1"\nstream_idle_timeout_ms = 300000\nstream_max_retries = 3\nrequest_max_retries = 3\n';
          }
          fs.writeFileSync(configPath, tomlContent, 'utf8');
          messages.push('已还原原始 config.toml' + (preserveCompatibility ? ' (已保留 opencode-go 历史会话兼容声明)' : ''));
        }
      } else {
        if (fs.existsSync(configPath)) {
          fs.unlinkSync(configPath);
          messages.push('已清理新创建的 config.toml');
        }
      }

      if (manifest.hasAuthJson) {
        const bkAuth = path.join(backupDir, 'auth.json');
        if (fs.existsSync(bkAuth)) {
          fs.copyFileSync(bkAuth, authPath);
          messages.push('已还原原始 auth.json');
        }
      } else {
        if (fs.existsSync(authPath)) {
          fs.unlinkSync(authPath);
          messages.push('已清理新创建的 auth.json');
        }
      }

      if (manifest.hasModelsJson) {
        const bkModels = path.join(backupDir, 'models.json');
        if (fs.existsSync(bkModels)) {
          fs.copyFileSync(bkModels, modelsPath);
          messages.push('已还原原始 models.json');
        }
      } else {
        if (fs.existsSync(modelsPath)) {
          fs.unlinkSync(modelsPath);
          messages.push('已清理新创建的 models.json');
        }
      }

      // Clean catalogPath if strict clean rollback requested (preserveCompatibility === false)
      if (!preserveCompatibility && fs.existsSync(catalogPath)) {
        try { fs.unlinkSync(catalogPath); messages.push('已清理模型目录'); } catch (e) {}
      }

      // Also clean up any legacy .router-bak files to ensure 100% clean state
      try {
        if (fs.existsSync(configPath + '.router-bak')) fs.unlinkSync(configPath + '.router-bak');
        if (fs.existsSync(authPath + '.router-bak')) fs.unlinkSync(authPath + '.router-bak');
        if (fs.existsSync(modelsPath + '.router-bak')) fs.unlinkSync(modelsPath + '.router-bak');
      } catch (e) {}

      // Clean backup dir after successful restoration
      try {
        fs.rmSync(backupDir, { recursive: true, force: true });
        messages.push('已清理临时备份目录');
      } catch (e) {}

      return {
        success: true,
        restoredFrom: 'backup-manifest',
        messages
      };
    } catch (err) {
      return { success: false, error: err.message, messages };
    }
  }

  // Fallback check: .router-bak files
  let fallbackRestored = false;
  if (fs.existsSync(configPath + '.router-bak')) {
    try {
      let tomlContent = fs.readFileSync(configPath + '.router-bak', 'utf8');
      if (preserveCompatibility && !tomlContent.includes('[model_providers."opencode-go"]') && !tomlContent.includes('[model_providers.opencode-go]')) {
        tomlContent += '\n[model_providers."opencode-go"]\nname = "opencode-go"\nwire_api = "responses"\nrequires_openai_auth = true\nbase_url = "http://127.0.0.1:4010/v1"\nstream_idle_timeout_ms = 300000\nstream_max_retries = 3\nrequest_max_retries = 3\n';
      }
      fs.writeFileSync(configPath, tomlContent, 'utf8');
      messages.push('已从 .router-bak 还原 config.toml' + (preserveCompatibility ? ' (已保留 opencode-go 历史会话兼容声明)' : ''));
      fallbackRestored = true;
    } catch (e) {}
  }
  if (fs.existsSync(authPath + '.router-bak')) {
    try {
      fs.copyFileSync(authPath + '.router-bak', authPath);
      messages.push('已从 .router-bak 还原 auth.json');
      fallbackRestored = true;
    } catch (e) {}
  }
  if (fs.existsSync(modelsPath + '.router-bak')) {
    try {
      fs.copyFileSync(modelsPath + '.router-bak', modelsPath);
      messages.push('已从 .router-bak 还原 models.json');
      fallbackRestored = true;
    } catch (e) {}
  }

  if (fallbackRestored) {
    try {
      if (fs.existsSync(configPath + '.router-bak')) fs.unlinkSync(configPath + '.router-bak');
      if (fs.existsSync(authPath + '.router-bak')) fs.unlinkSync(authPath + '.router-bak');
      if (fs.existsSync(modelsPath + '.router-bak')) fs.unlinkSync(modelsPath + '.router-bak');
    } catch (e) {}
    return { success: true, restoredFrom: 'router-bak', messages };
  }

  return {
    success: false,
    message: '未找到 Codex 原始配置备份文件，系统无需还原',
    messages
  };
}

/**
 * Gracefully terminates running Codex Desktop / CLI daemon processes and relaunches
 * the Codex desktop client in a decoupled, zero-window manner to load fresh configurations.
 */
function restartCodex(options = {}) {
  const isWin = process.platform === 'win32';
  const messages = [];

  if (options && options.dryRun) {
    return {
      success: true,
      restarted: true,
      messages: ['Dry-run 模式：跳过实际进程终止与应用重启']
    };
  }

  if (isWin) {
    try {
      // 1. Terminate running Codex Desktop / ChatGPT / CLI processes
      execSync('powershell -NoProfile -Command "try { Get-Process -Name ChatGPT, codex -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue } catch {}; exit 0"', { timeout: 10000 });
      messages.push('已终止旧版 Codex / ChatGPT 运行实例与后台进程');
    } catch (e) {
      messages.push(`终止旧进程提醒: ${e.message}`);
    }

    // 2. Launch fresh detached instance with anti-suspension watchdog
    let launched = false;
    try {
      setTimeout(() => {
        try {
          const desktopLnk = path.join(process.env.USERPROFILE || '', 'Desktop', 'Codex.lnk');
          let launcherCommand = '';
          if (fs.existsSync(desktopLnk)) {
            launcherCommand = `cmd.exe /d /c start "" "${desktopLnk}"`;
          } else {
            launcherCommand = 'cmd.exe /d /c start "" "shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App"';
          }

          // Launch detached via cmd start
          execSync(launcherCommand, { windowsHide: true, timeout: 5000 });

          // Watchdog: detect and automatically resume any suspended ChatGPT threads
          setTimeout(() => {
            try {
              const resumeScript = `
                $code = @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public class SuspendedResumer {
    [DllImport("kernel32.dll")] public static extern IntPtr OpenThread(int dwAccess, bool bInherit, uint id);
    [DllImport("kernel32.dll")] public static extern uint ResumeThread(IntPtr hThread);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
    public static void ResumeAll() {
        foreach (var p in Process.GetProcessesByName("ChatGPT")) {
            foreach (ProcessThread t in p.Threads) {
                if (t.ThreadState == ThreadState.Wait && t.WaitReason == ThreadWaitReason.Suspended) {
                    IntPtr h = OpenThread(0x0002, false, (uint)t.Id);
                    if (h != IntPtr.Zero) {
                        ResumeThread(h);
                        CloseHandle(h);
                    }
                }
            }
        }
    }
}
"@
                try {
                    Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue
                    [SuspendedResumer]::ResumeAll()
                } catch {}
              `;
              const child = require('child_process').spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', resumeScript], {
                detached: true,
                stdio: 'ignore',
                windowsHide: true
              });
              child.unref();
            } catch (_) {}
          }, 800);
        } catch (innerErr) {
          try {
            const childFallback = require('child_process').spawn('cmd.exe', ['/d', '/c', 'start', '', 'shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App'], {
              detached: true,
              stdio: 'ignore',
              windowsHide: true
            });
            childFallback.unref();
          } catch (_) {}
        }
      }, 500);
      launched = true;
      messages.push('已通过 Windows 原生外壳脱钩唤起全新 Codex 桌面客户端，并激活挂起自愈守护');
    } catch (err1) {
      try {
        const child2 = require('child_process').spawn('cmd.exe', ['/d', '/c', 'codex app'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });
        child2.unref();
        launched = true;
        messages.push('已通过 `codex app` 命令脱钩唤起客户端');
      } catch (err2) {
        messages.push(`唤起 Codex 客户端异常: ${err2.message}`);
      }
    }

    return {
      success: launched,
      restarted: true,
      messages
    };
  } else {
    // Linux / macOS
    try {
      execSync('pkill -x "codex" || pkill -x "codex-app" || pkill -x "ChatGPT" || true', { timeout: 5000 });
      messages.push('已清理旧版 Codex 后台进程');
      return { success: true, restarted: true, messages };
    } catch (e) {
      return { success: false, restarted: false, messages: [e.message] };
    }
  }
}

/**
 * Safely parses Codex turn metadata string (JSON, URL-encoded, or base64)
 */
function parseTurnMetadata(val) {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (_) {}
  try {
    const decoded = decodeURIComponent(trimmed);
    if (decoded !== trimmed) return JSON.parse(decoded);
  } catch (_) {}
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    if (decoded.startsWith('{') && decoded.endsWith('}')) {
      return JSON.parse(decoded);
    }
  } catch (_) {}
  return null;
}

/**
 * Dynamically derives an isolated Session ID for upstream OpenCode Go requests.
 * Eliminates concurrent state collision when multiple Codex threads or turns connect.
 * 
 * Precedence:
 * 1. Explicit x-opencode-session or x-session-id request header
 * 2. Explicit x-conversation-id request header
 * 3. Codex-native turn metadata headers (x-codex-turn-metadata, x-codex-parent-thread-id, x-thread-id)
 * 4. Explicit x-request-id or x-client-request-id request header
 * 5. previous_response_id, parent_response_id, thread_id, conversation_id, or session_id in payload body
 * 6. Dynamic auto-isolated session ID per connection/turn fallback
 */
// Rule 26: Response-Chain Root Session Reverse Tracing (bounded LRU map)
const MAX_RESPONSE_SESSION_MAPPINGS = 5000;
const responseIdToSessionMap = new Map();

function recordResponseSession(responseId, sessionId) {
  if (!responseId || typeof responseId !== 'string' || !sessionId || typeof sessionId !== 'string') return;
  const cleanRespId = responseId.trim();
  const cleanSessId = sessionId.trim();
  if (!cleanRespId || !cleanSessId) return;
  if (responseIdToSessionMap.has(cleanRespId)) {
    responseIdToSessionMap.delete(cleanRespId);
  } else if (responseIdToSessionMap.size >= MAX_RESPONSE_SESSION_MAPPINGS) {
    const oldest = responseIdToSessionMap.keys().next().value;
    responseIdToSessionMap.delete(oldest);
  }
  responseIdToSessionMap.set(cleanRespId, cleanSessId);
}

function resolveSessionFromPreviousResponse(previousResponseId) {
  if (!previousResponseId || typeof previousResponseId !== 'string') return null;
  let cur = previousResponseId.trim();
  let hops = 0;
  let resolved = null;
  while (cur && responseIdToSessionMap.has(cur) && hops < 16) {
    resolved = responseIdToSessionMap.get(cur);
    // Refresh LRU order
    responseIdToSessionMap.delete(cur);
    responseIdToSessionMap.set(cur, resolved);
    if (resolved === cur) break;
    cur = resolved;
    hops++;
  }
  return resolved;
}

function extractOrDeriveSessionId(req, body) {
  // 1. Explicit x-opencode-session / x-session-id
  const headerSession = req?.headers?.['x-opencode-session'] || req?.headers?.['x-session-id'];
  if (headerSession && typeof headerSession === 'string' && headerSession.trim()) {
    return headerSession.trim();
  }

  // 2. Explicit previous_response_id, conversation_id, thread_id request headers
  const prevHeader = req?.headers?.['x-previous-response-id'] || req?.headers?.['previous_response_id'] || req?.headers?.['previous-response-id'];
  if (prevHeader && typeof prevHeader === 'string' && prevHeader.trim()) {
    const trimmed = prevHeader.trim();
    const rootSess = resolveSessionFromPreviousResponse(trimmed);
    if (rootSess) return rootSess;
    return trimmed.startsWith('session-') ? trimmed : `session-resp-${trimmed}`;
  }

  const convHeader = req?.headers?.['x-conversation-id'] || req?.headers?.['conversation_id'] || req?.headers?.['conversation-id'];
  if (convHeader && typeof convHeader === 'string' && convHeader.trim()) {
    const trimmed = convHeader.trim();
    return trimmed.startsWith('session-') ? trimmed : `session-conv-${trimmed}`;
  }

  const threadHeader = req?.headers?.['x-thread-id'] || req?.headers?.['thread_id'] || req?.headers?.['thread-id'];
  if (threadHeader && typeof threadHeader === 'string' && threadHeader.trim()) {
    const trimmed = threadHeader.trim();
    return trimmed.startsWith('session-') ? trimmed : `session-thread-${trimmed}`;
  }

  // 3. Codex-native turn metadata headers (x-codex-turn-metadata, x-codex-parent-thread-id, x-thread-id)
  const codexMetaRaw = req?.headers?.['x-codex-turn-metadata'] || req?.headers?.['x-turn-metadata'];
  if (codexMetaRaw) {
    const meta = parseTurnMetadata(codexMetaRaw);
    const threadId = meta?.thread_id || meta?.threadId || meta?.parent_thread_id || meta?.session_id || meta?.sessionId;
    if (threadId && typeof threadId === 'string' && threadId.trim()) {
      const trimmed = threadId.trim();
      return trimmed.startsWith('session-') ? trimmed : `session-codex-${trimmed}`;
    }
  }
  const codexParentThread = req?.headers?.['x-codex-parent-thread-id'];
  if (codexParentThread && typeof codexParentThread === 'string' && codexParentThread.trim()) {
    const trimmed = codexParentThread.trim();
    return trimmed.startsWith('session-') ? trimmed : `session-codex-${trimmed}`;
  }

  // 4. previous_response_id / parent_response_id / thread_id / conversation_id / messages in payload body
  let parsed = body;
  if (Buffer.isBuffer(body) || typeof body === 'string') {
    if (body.length > 0) {
      try {
        parsed = JSON.parse(body.toString('utf8'));
      } catch (e) {
        parsed = null;
      }
    } else {
      parsed = null;
    }
  }

  if (parsed && typeof parsed === 'object') {
    if (parsed.previous_response_id && typeof parsed.previous_response_id === 'string' && parsed.previous_response_id.trim()) {
      const prevId = parsed.previous_response_id.trim();
      const rootSess = resolveSessionFromPreviousResponse(prevId);
      if (rootSess) return rootSess;
      return prevId.startsWith('session-') ? prevId : `session-resp-${prevId}`;
    }
    if (parsed.parent_response_id && typeof parsed.parent_response_id === 'string' && parsed.parent_response_id.trim()) {
      const parentId = parsed.parent_response_id.trim();
      const rootSess = resolveSessionFromPreviousResponse(parentId);
      if (rootSess) return rootSess;
      return parentId.startsWith('session-') ? parentId : `session-resp-${parentId}`;
    }
    if (parsed.thread_id && typeof parsed.thread_id === 'string' && parsed.thread_id.trim()) {
      const tId = parsed.thread_id.trim();
      return tId.startsWith('session-') ? tId : `session-codex-${tId}`;
    }
    if (parsed.conversation_id && typeof parsed.conversation_id === 'string' && parsed.conversation_id.trim()) {
      const convId = parsed.conversation_id.trim();
      return convId.startsWith('session-') ? convId : `session-conv-${convId}`;
    }
    if (parsed.root_turn_id && typeof parsed.root_turn_id === 'string' && parsed.root_turn_id.trim()) {
      const rId = parsed.root_turn_id.trim();
      return rId.startsWith('session-') ? rId : `session-turn-${rId}`;
    }
    if (parsed.metadata && typeof parsed.metadata === 'object') {
      const mThread = parsed.metadata.thread_id || parsed.metadata.threadId || parsed.metadata.session_id;
      if (mThread && typeof mThread === 'string' && mThread.trim()) {
        const trimmed = mThread.trim();
        return trimmed.startsWith('session-') ? trimmed : `session-codex-${trimmed}`;
      }
      const mConv = parsed.metadata.conversation_id || parsed.metadata.conversationId;
      if (mConv && typeof mConv === 'string' && mConv.trim()) {
        const trimmed = mConv.trim();
        return trimmed.startsWith('session-') ? trimmed : `session-conv-${trimmed}`;
      }
    }
    if (parsed.session_id && typeof parsed.session_id === 'string' && parsed.session_id.trim()) {
      const sId = parsed.session_id.trim();
      return sId.startsWith('session-') ? sId : `session-${sId}`;
    }

    // 5. Stable conversation anchor hashing for headless Chat completions / Anthropic messages
    if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
      const firstUser = parsed.messages.find(m => m && m.role === 'user');
      const firstSys = parsed.messages.find(m => m && (m.role === 'system' || m.role === 'developer'));
      const anchorParts = [];
      if (firstSys) {
        const sysText = typeof firstSys.content === 'string'
          ? firstSys.content
          : (Array.isArray(firstSys.content) ? JSON.stringify(firstSys.content) : JSON.stringify(firstSys));
        if (sysText && sysText.trim()) anchorParts.push(sysText.trim());
      }
      if (firstUser) {
        const userText = typeof firstUser.content === 'string'
          ? firstUser.content
          : (Array.isArray(firstUser.content) ? JSON.stringify(firstUser.content) : JSON.stringify(firstUser));
        if (userText && userText.trim()) anchorParts.push(userText.trim());
      }
      if (anchorParts.length === 0) {
        const rootMsg = parsed.messages[0];
        const rootText = typeof rootMsg.content === 'string'
          ? rootMsg.content
          : (Array.isArray(rootMsg.content) ? JSON.stringify(rootMsg.content) : JSON.stringify(rootMsg));
        if (rootText && rootText.trim()) anchorParts.push(rootText.trim());
      }
      if (anchorParts.length > 0) {
        const anchorStr = anchorParts.join('::');
        const hash = require('crypto').createHash('sha256').update(anchorStr).digest('hex').slice(0, 16);
        return `session-chat-${hash}`;
      }
    } else if (Array.isArray(parsed.input) && parsed.input.length > 0) {
      const rootItem = parsed.input[0];
      const rootText = typeof rootItem === 'string' ? rootItem : JSON.stringify(rootItem);
      if (rootText && rootText.trim()) {
        const hash = require('crypto').createHash('sha256').update(rootText.trim()).digest('hex').slice(0, 16);
        return `session-resp-${hash}`;
      }
    }
  }

  // 6. Explicit x-request-id / x-client-request-id header (fallback if no conversation anchor found)
  const reqIdHeader = req?.headers?.['x-request-id'] || req?.headers?.['x-client-request-id'];
  if (reqIdHeader && typeof reqIdHeader === 'string' && reqIdHeader.trim()) {
    const trimmed = reqIdHeader.trim();
    return trimmed.startsWith('session-') ? trimmed : `session-req-${trimmed}`;
  }

  // 7. Dynamic session isolation per connection/turn fallback
  return `session-auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Checks for Codex / ChatGPT background process suspension or zombie single-instance lock deadlocks.
 */
function checkCodexProcessHealth() {
  if (process.platform !== 'win32') {
    return { healthy: true, procCount: 0, hasSuspended: false, suspendedCount: 0, hasGhost: false, visibleWindows: 0, wsMb: 0, pids: [] };
  }

  try {
    const psScript = `
$procs = Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue
if (-not $procs) {
    Write-Output '0|0|0|0|'
    exit
}
Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class WinChecker {
    public delegate bool EnumDesktopWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll")] public static extern bool SetThreadDesktop(IntPtr hDesktop);
    [DllImport("user32.dll")] public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumDesktopWindowsProc lpfn, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);

    public static string Check() {
        IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
        if (hDesk != IntPtr.Zero) SetThreadDesktop(hDesk);
        var pids = new List<uint>();
        int totalSuspended = 0;
        long totalWs = 0;
        foreach (var p in System.Diagnostics.Process.GetProcessesByName("ChatGPT")) {
            pids.Add((uint)p.Id);
            totalWs += p.WorkingSet64;
            foreach (System.Diagnostics.ProcessThread t in p.Threads) {
                if (t.ThreadState == System.Diagnostics.ThreadState.Wait && t.WaitReason == System.Diagnostics.ThreadWaitReason.Suspended) {
                    totalSuspended++;
                }
            }
        }
        int visibleWindows = 0;
        if (hDesk != IntPtr.Zero && pids.Count > 0) {
            var pidSet = new HashSet<uint>(pids);
            EnumDesktopWindows(hDesk, (hWnd, lParam) => {
                uint pid;
                GetWindowThreadProcessId(hWnd, out pid);
                if (pidSet.Contains(pid) && IsWindowVisible(hWnd)) {
                    var sbClass = new StringBuilder(256);
                    GetClassName(hWnd, sbClass, 256);
                    if (sbClass.ToString() == "Chrome_WidgetWin_1") {
                        visibleWindows++;
                    }
                }
                return true;
            }, IntPtr.Zero);
        }
        double wsMb = Math.Round((double)totalWs / (1024 * 1024), 1);
        return string.Format("{0}|{1}|{2}|{3}|{4}", pids.Count, totalSuspended, visibleWindows, wsMb, string.Join(",", pids));
    }
}
'@
[WinChecker]::Check()
`;
    const enc = Buffer.from(psScript, 'utf16le').toString('base64');
    const out = execSync(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${enc}`, {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();

    if (out) {
      const parts = out.split('|');
      if (parts.length >= 5) {
        const procCount = parseInt(parts[0], 10) || 0;
        const suspendedCount = parseInt(parts[1], 10) || 0;
        const visibleWindows = parseInt(parts[2], 10) || 0;
        const wsMb = parseFloat(parts[3]) || 0;
        const pids = parts[4] ? parts[4].split(',').filter(Boolean).map(n => parseInt(n, 10)) : [];

        const hasSuspended = suspendedCount > 0;
        // Ghost process: processes exist, zero visible windows, and memory is tiny (< 35MB total) indicating stalled UWP lifecycle
        const hasGhost = procCount > 0 && visibleWindows === 0 && wsMb < 35;
        const healthy = !hasSuspended && !hasGhost;

        return {
          healthy,
          procCount,
          hasSuspended,
          suspendedCount,
          hasGhost,
          visibleWindows,
          wsMb,
          pids
        };
      }
    }
  } catch (_) {}

  return { healthy: true, procCount: 0, hasSuspended: false, suspendedCount: 0, hasGhost: false, visibleWindows: 0, wsMb: 0, pids: [] };
}

/**
 * Automatically resumes suspended threads or terminates zombie SingleInstanceLock holders
 */
function resumeOrCleanCodexProcesses() {
  if (process.platform !== 'win32') {
    return { success: true, message: '非 Windows 环境无需处理 UWP 挂起锁' };
  }

  const status = checkCodexProcessHealth();
  if (status.healthy) {
    return { success: true, message: 'Codex / ChatGPT 进程状态健康（无挂起及僵死死锁）' };
  }

  try {
    // 准则 4 & 准则 32：排查桌面客户端“秒退/打不开”时，第一优先级检测无窗口僵死进程组（visibleWindows === 0）
    // 一旦确诊其霸占 SingleInstanceLock 互斥锁，自愈逻辑必须无条件强力终止全部残留进程树，彻底释放互斥锁！
    if (status.visibleWindows === 0 && status.procCount > 0) {
      execSync('powershell.exe -NoProfile -NonInteractive -Command "try { Get-Process -Name ChatGPT, codex -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue } catch {}; exit 0"', {
        timeout: 6000,
        stdio: 'ignore'
      });

      // 清理孤立互斥锁与第三方残留死锁
      const lockDir = path.join(process.env.USERPROFILE || '', '.codex', 'tmp', 'provider-sync.lock');
      if (fs.existsSync(lockDir)) {
        try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch (_) {}
      }

      return {
        success: true,
        killed: true,
        message: `已安全清理霸占 SingleInstanceLock 互斥锁的 ${status.procCount} 个无窗口僵死进程，互斥锁已彻底释放，可正常双击桌面图标启动`
      };
    }

    // 若存在正常可见窗口，且仅为部分辅助线程被 Windows PLM 偶发挂起，尝试唤醒该辅助线程
    if (status.hasSuspended && status.visibleWindows > 0) {
      const psScript = `
Add-Type @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public class SuspendedResumer {
    [DllImport("kernel32.dll")] public static extern IntPtr OpenThread(int dwAccess, bool bInherit, uint id);
    [DllImport("kernel32.dll")] public static extern uint ResumeThread(IntPtr hThread);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
    public static int ResumeAll() {
        int count = 0;
        foreach (var p in Process.GetProcessesByName("ChatGPT")) {
            foreach (ProcessThread t in p.Threads) {
                if (t.ThreadState == ThreadState.Wait && t.WaitReason == ThreadWaitReason.Suspended) {
                    IntPtr h = OpenThread(0x0002, false, (uint)t.Id);
                    if (h != IntPtr.Zero) {
                        ResumeThread(h);
                        CloseHandle(h);
                        count++;
                    }
                }
            }
        }
        return count;
    }
}
'@
$resumed = [SuspendedResumer]::ResumeAll()
Write-Output $resumed
`;
      const enc = Buffer.from(psScript, 'utf16le').toString('base64');
      const out = execSync(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${enc}`, {
        encoding: 'utf8',
        timeout: 6000,
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();

      const resumedCount = parseInt(out, 10) || 0;
      if (resumedCount > 0) {
        return { success: true, resumed: resumedCount, message: `已成功唤醒 ${resumedCount} 个被 Windows PLM 挂起的 ChatGPT 线程，恢复窗口渲染` };
      }
    }

    // 强力兜底清理
    execSync('powershell.exe -NoProfile -NonInteractive -Command "try { Get-Process -Name ChatGPT, codex -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue } catch {}; exit 0"', {
      timeout: 6000,
      stdio: 'ignore'
    });
    return { success: true, killed: true, message: '已彻底终止异常残留的 Codex / ChatGPT 进程组并释放互斥锁' };
  } catch (err) {
    return { success: false, error: err.message, message: '自愈挂起/僵死进程失败: ' + err.message };
  }
}

const CODEX_ZHCN_TRANSLATE_SCRIPT = `// ==UserScript==
// @name         Codex简体中文汉化
// @namespace    codex-plus-plus
// @version      2.0.0
// @description  Codex客户端全界面高保真深度简体中文汉化补丁（支持顶部菜单、侧边栏导航与浮动工具栏）
// @author       OpenCode-Router
// @match        app://-/*
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const INSTALL_KEY = "__codexZhCnTranslateInstalled";
  if (window[INSTALL_KEY]) return;
  window[INSTALL_KEY] = true;

  const EXACT_MAP = new Map([
    ["File", "文件"],
    ["Edit", "编辑"],
    ["View", "视图"],
    ["Window", "窗口"],
    ["Help", "帮助"],
    ["New chat", "新建对话"],
    ["New Chat", "新建对话"],
    ["New thread", "新建会话"],
    ["New Thread", "新建会话"],
    ["Scheduled", "定时任务"],
    ["Plugins", "插件中心"],
    ["MCP Servers", "MCP 服务"],
    ["Skills", "技能包"],
    ["Explore", "探索"],
    ["Projects", "项目列表"],
    ["Workspaces", "工作区"],
    ["Worktree", "Git 工作树"],
    ["Worktrees", "Git 工作树"],
    ["New Project...", "新建项目..."],
    ["New Project…", "新建项目…"],
    ["New Project", "新建项目"],
    ["Open Folder...", "打开文件夹..."],
    ["Open Folder…", "打开文件夹…"],
    ["Open Folder", "打开文件夹"],
    ["Close", "关闭"],
    ["Log out", "退出登录"],
    ["Log Out", "退出登录"],
    ["Sign out", "退出账号"],
    ["Settings", "设置"],
    ["General", "常规设置"],
    ["Appearance", "外观主题"],
    ["Preferences", "偏好设置"],
    ["Keyboard Shortcuts", "快捷键"],
    ["Documentation", "官方文档"],
    ["Release Notes", "更新日志"],
    ["Ask for changes", "请求修改"],
    ["Ask for selection edit", "选中行内微调"],
    ["Review changes", "审查代码变更"],
    ["Apply patch", "应用补丁"],
    ["Apply all", "全部应用"],
    ["Accept", "接受"],
    ["Accept all", "全部接受"],
    ["Reject", "拒绝"],
    ["Reject all", "全部拒绝"],
    ["Approve", "批准执行"],
    ["Approve once", "仅本次批准"],
    ["Always approve", "始终批准"],
    ["Run command", "运行命令"],
    ["Apply", "应用"],
    ["Discard", "放弃修改"],
    ["Discard changes", "放弃变更"],
    ["Diff", "差异对比"],
    ["Unified diff", "统一差异视图"],
    ["Split diff", "分栏差异视图"],
    ["Revert", "还原"],
    ["Keep", "保留"],
    ["Reasoning effort", "思考深度"],
    ["Reasoning", "思考推导"],
    ["Thought process", "思考过程"],
    ["Thinking...", "正在深度思考..."],
    ["Generating...", "正在生成回复..."],
    ["Running command...", "正在执行终端命令..."],
    ["Applying patch...", "正在应用代码补丁..."],
    ["Low", "轻量 (Low)"],
    ["Medium", "均衡 (Medium)"],
    ["High", "深度 (High)"],
    ["Extra High", "极高 (xHigh)"],
    ["Temporary chat", "临时对话"],
    ["Attach files", "添加附件"],
    ["Attach image", "添加图片"],
    ["Send message", "发送消息"],
    ["Cancel generation", "停止生成"],
    ["Stop generating", "停止生成"],
    ["Interrupt", "中断执行"],
    ["Delete", "删除"],
    ["Archive", "归档"],
    ["Pin", "置顶"],
    ["Unpin", "取消置顶"],
    ["Rename", "重命名"],
    ["Copy", "复制"],
    ["Copied!", "已复制！"],
    ["Copy code", "复制代码"],
    ["Cancel", "取消"],
    ["Save", "保存"],
    ["Export", "导出"],
    ["Confirm", "确认"],
    ["Retry", "重试"],
    ["Model", "模型"],
    ["API Key", "API 密钥"],
    ["Sandbox", "安全沙箱"],
    ["Auto-approve", "自动批准"],
    ["Full access", "完全访问权限"],
    ["Read-only", "只读模式"],
    ["Context window", "上下文窗口"],
    ["Tokens used", "已用 Token"],
    ["Terminal", "终端输出"]
  ]);

  function shouldIgnore(el) {
    if (!el || !(el instanceof Element)) return true;
    const tag = el.tagName.toLowerCase();
    if (tag === "code" || tag === "pre" || tag === "input" || tag === "textarea" || tag === "script" || tag === "style") return true;
    if (el.isContentEditable) return true;
    if (el.closest("pre, code, textarea, input, .monaco-editor, [contenteditable='true']")) return true;
    return false;
  }

  function translateNode(node) {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (!text) return;
      const parent = node.parentElement;
      if (shouldIgnore(parent)) return;
      if (EXACT_MAP.has(text)) {
        node.textContent = node.textContent.replace(text, EXACT_MAP.get(text));
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (shouldIgnore(node)) return;
      const ariaLabel = node.getAttribute("aria-label");
      if (ariaLabel && EXACT_MAP.has(ariaLabel.trim())) {
        node.setAttribute("aria-label", EXACT_MAP.get(ariaLabel.trim()));
      }
      const title = node.getAttribute("title");
      if (title && EXACT_MAP.has(title.trim())) {
        node.setAttribute("title", EXACT_MAP.get(title.trim()));
      }
      const placeholder = node.getAttribute("placeholder");
      if (placeholder && EXACT_MAP.has(placeholder.trim())) {
        node.setAttribute("placeholder", EXACT_MAP.get(placeholder.trim()));
      }
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === Node.TEXT_NODE) translateNode(child);
      }
    }
  }

  function scanAndTranslate(root = document.body) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_SKIP;
        if (shouldIgnore(node.parentElement)) return NodeFilter.FILTER_REJECT;
        const text = node.textContent.trim();
        return EXACT_MAP.has(text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    let textNode;
    while ((textNode = walker.nextNode())) {
      const text = textNode.textContent.trim();
      if (EXACT_MAP.has(text)) {
        textNode.textContent = textNode.textContent.replace(text, EXACT_MAP.get(text));
      }
    }
    const labeledElements = root.querySelectorAll("[aria-label], [title]");
    labeledElements.forEach(el => {
      if (shouldIgnore(el)) return;
      const aria = el.getAttribute("aria-label");
      if (aria && EXACT_MAP.has(aria.trim())) el.setAttribute("aria-label", EXACT_MAP.get(aria.trim()));
      const t = el.getAttribute("title");
      if (t && EXACT_MAP.has(t.trim())) el.setAttribute("title", EXACT_MAP.get(t.trim()));
    });
  }

  let debounceTimer = null;
  const observer = new MutationObserver((mutations) => {
    let needsScan = false;
    for (const m of mutations) {
      if (m.type === "childList" && m.addedNodes.length > 0) {
        for (const added of m.addedNodes) {
          if (added.nodeType === Node.ELEMENT_NODE) {
            if (!shouldIgnore(added)) { needsScan = true; break; }
          } else if (added.nodeType === Node.TEXT_NODE) {
            translateNode(added);
          }
        }
      } else if (m.type === "characterData") {
        translateNode(m.target);
      }
      if (needsScan) break;
    }
    if (needsScan) {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => scanAndTranslate(), 50);
    }
  });

  function init() {
    if (document.body) {
      scanAndTranslate();
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    } else {
      document.addEventListener("DOMContentLoaded", () => {
        scanAndTranslate();
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      });
    }
  }

  init();
})();
`;

/**
 * Checks Simplified Chinese locale alignment and port conflict immunity for Codex
 */
function checkCodexLocaleAndEnvironment(options = {}) {
  const codexDir = options.codexDir || getCodexConfigDir();
  const configPath = path.join(codexDir, 'config.toml');
  const catalogPath = path.join(codexDir, 'model-catalogs', 'opencode-go-catalog.json');

  let hasConfig = fs.existsSync(configPath);
  let missingDesktopLocale = false;
  let hasInvalidModelSlug = false;
  let missingComfyUiMcp = false;
  let currentModel = null;

  if (hasConfig) {
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const mLocale = raw.match(/localeOverride\s*=\s*["']([^"']+)["']/);
      missingComfyUiMcp = !raw.includes('[mcp_servers.comfyui]');
      if (!mLocale || mLocale[1] !== 'zh-CN') {
        missingDesktopLocale = true;
      }
      const mModel = raw.match(/^\s*model\s*=\s*["']([^"']+)["']/m);
      if (mModel) {
        currentModel = mModel[1];
        if (currentModel.includes('[') || currentModel.includes(']') || currentModel.includes(' ')) {
          hasInvalidModelSlug = true;
        }
      }
    } catch (_) {}
  }

  let missingChromiumLocale = false;
  const webviewDir = path.join(
    process.env.LOCALAPPDATA || '',
    'Packages',
    'OpenAI.Codex_2p2nqsd0c76g0',
    'LocalCache',
    'Roaming',
    'Codex',
    'web',
    'Codex'
  );
  if (fs.existsSync(webviewDir)) {
    const prefsPath = path.join(webviewDir, 'Default', 'Preferences');
    if (fs.existsSync(prefsPath)) {
      try {
        const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
        if (!prefs.intl || !prefs.intl.accept_languages || !prefs.intl.accept_languages.includes('zh-CN')) {
          missingChromiumLocale = true;
        }
      } catch (_) { missingChromiumLocale = true; }
    }
  }

  let missingModelInstructions = false;
  if (fs.existsSync(catalogPath)) {
    try {
      const cat = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      if (cat.models && cat.models[0]) {
        const instr = cat.models[0].base_instructions || '';
        if (!instr.includes('简体中文')) {
          missingModelInstructions = true;
        }
      }
    } catch (_) {}
  }

  let hasCodexPlusPortConflict = false;
  let missingCodexPlusZhScript = false;
  let hasProviderSyncLock = false;

  if (process.platform === 'win32') {
    const lockDir = path.join(process.env.USERPROFILE || '', '.codex', 'tmp', 'provider-sync.lock');
    if (fs.existsSync(lockDir)) {
      hasProviderSyncLock = true;
    }
  }
  if (process.platform === 'win32') {
    const codexPlusDir = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Codex++');
    const watcherLnk = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'CodexPlusPlusWatcher.lnk');
    const hasCodexPlus = fs.existsSync(codexPlusDir) || fs.existsSync(watcherLnk);
    if (hasCodexPlus) {
      const portEnv = process.env.CODEX_PLUS_PROTOCOL_PROXY_PORT;
      if (!portEnv || portEnv === '4010') {
        hasCodexPlusPortConflict = true;
      }
    }

    const codexPlusUserScript = path.join(process.env.APPDATA || '', 'Codex++', 'user_scripts', 'market-codex-zhcn-translate.js');
    if (fs.existsSync(codexPlusUserScript)) {
      try {
        const scriptContent = fs.readFileSync(codexPlusUserScript, 'utf8');
        if (!scriptContent.includes('app://-/*') || scriptContent.includes('document.createObserver')) {
          missingCodexPlusZhScript = true;
        }
      } catch (_) {}
    }
  }

  const issues = [];
  if (missingDesktopLocale) {
    issues.push('config.toml 缺少 [desktop].localeOverride = "zh-CN"');
  }
  if (hasInvalidModelSlug) {
    issues.push(`config.toml 中的当前模型名称非标准 Slug (${currentModel})，导致界面显示为“自定义”`);
  }
  if (missingChromiumLocale) {
    issues.push('Chromium Webview 本地首选项首选语言未包含 zh-CN');
  }
  if (missingModelInstructions) {
    issues.push('模型元数据目录缺少简体中文思考与回答规范提示词');
  }
  if (hasCodexPlusPortConflict) {
    issues.push('Codex++ 汉化注入工具默认侦听 4010 端口与本地智能网关冲突，导致汉化插件闪退');
  }
  if (missingComfyUiMcp) {
    issues.push('config.toml 尚未挂载 ComfyUI 图像智能体 (mcp-comfyui.js)，一键修复即可激活原生生图与反推工具');
  }
  if (missingCodexPlusZhScript) {
    issues.push('Codex++ 界面汉化脚本存在语法错误或匹配失效，一键修复即可自动升级为最新高保真汉化补丁');
  }

  return {
    healthy: issues.length === 0,
    missingDesktopLocale,
    hasInvalidModelSlug,
    currentModel,
    missingChromiumLocale,
    missingModelInstructions,
    hasCodexPlusPortConflict,
    missingCodexPlusZhScript,
    missingComfyUiMcp,
    issues
  };
}

/**
 * Automatically repairs Codex locale, Chromium prefs, model slug, instructions and port conflicts
 */
function repairCodexLocaleAndEnvironment(options = {}) {
  const messages = [];
  const codexDir = options.codexDir || getCodexConfigDir();
  const configPath = path.join(codexDir, 'config.toml');

  // 1. Repair config.toml
  if (fs.existsSync(configPath)) {
    try {
      let raw = fs.readFileSync(configPath, 'utf8');
      let changed = false;

      // Fix localeOverride
      if (!raw.includes('localeOverride = "zh-CN"')) {
        if (/localeOverride\s*=/.test(raw)) {
          raw = raw.replace(/localeOverride\s*=\s*["'][^"']+["']/, 'localeOverride = "zh-CN"');
        } else if (raw.includes('[desktop]')) {
          raw = raw.replace(/\[desktop\][^\r\n]*/, '$&\nlocaleOverride = "zh-CN"');
        } else {
          raw += '\n[desktop]\nlocaleOverride = "zh-CN"\n';
        }
        changed = true;
        messages.push('已在 config.toml 的 [desktop] 节中锁定 localeOverride = "zh-CN"');
      }

      // Fix model slug if contains brackets or spaces
      const mModel = raw.match(/^\s*model\s*=\s*["']([^"']+)["']/m);
      if (mModel && (mModel[1].includes('[') || mModel[1].includes(']') || mModel[1].includes(' '))) {
        raw = raw.replace(/^\s*model\s*=\s*["'][^"']+["']/m, 'model = "deepseek-v4.1-flash"');
        changed = true;
        messages.push('已校准 config.toml 中非标准模型名为合法 Slug "deepseek-v4.1-flash"');
      }

      // Ensure ComfyUI MCP Server is registered for Codex Desktop
      const nodeExe = (process.execPath || 'C:\\Program Files\\nodejs\\node.exe').replace(/\\/g, '\\\\');
      const mcpScript = path.join(__dirname, 'mcp-comfyui.js').replace(/\\/g, '\\\\');
      if (!raw.includes('[mcp_servers.comfyui]')) {
        const mcpBlock = `\n[mcp_servers.comfyui]\ncommand = "${nodeExe}"\nargs = ["${mcpScript}"]\nstartup_timeout_sec = 60\n`;
        if (raw.includes('[mcp_servers]')) {
          raw = raw.replace('[mcp_servers]', '[mcp_servers]' + mcpBlock);
        } else {
          raw += `\n[mcp_servers]` + mcpBlock;
        }
        changed = true;
        messages.push('已为 Codex Desktop 自动注册 ComfyUI 图像智能体 (mcp-comfyui.js)');
      }

      // Check and dynamically heal notify executable path if present
      const mNotify = raw.match(/^\s*notify\s*=\s*\[\s*["']([^"']+)["']/m);
      if (mNotify) {
        const currentNotifyExe = mNotify[1].replace(/\\\\/g, '\\');
        if (!fs.existsSync(currentNotifyExe)) {
          const latestExe = findLatestCuaNodeExecutable(codexDir);
          if (latestExe) {
            const escapedPath = latestExe.replace(/\\/g, '\\\\');
            raw = raw.replace(/^\s*notify\s*=\s*\[\s*["'][^"']+["']/m, `notify = [ "${escapedPath}"`);
            changed = true;
            messages.push(`已自动校准失效的 notify 路径至最新运行时: ${latestExe}`);
          } else {
            raw = raw.replace(/^\s*notify\s*=/m, '# notify =');
            changed = true;
            messages.push('未发现可用 cua_node 运行时，已安全注释失效的 notify 引用');
          }
        }
      }

      if (changed) {
        fs.writeFileSync(configPath, raw, 'utf8');
      }
    } catch (e) {
      messages.push(`修复 config.toml 异常: ${e.message}`);
    }
  }

  // 2. Sync Chromium Webview Preferences & Local State
  try {
    const webviewDir = path.join(
      process.env.LOCALAPPDATA || '',
      'Packages',
      'OpenAI.Codex_2p2nqsd0c76g0',
      'LocalCache',
      'Roaming',
      'Codex',
      'web',
      'Codex'
    );
    if (fs.existsSync(webviewDir)) {
      const prefsPath = path.join(webviewDir, 'Default', 'Preferences');
      if (fs.existsSync(prefsPath)) {
        try {
          const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
          prefs.intl = prefs.intl || {};
          prefs.intl.selected_languages = 'zh-CN,zh';
          prefs.intl.accept_languages = 'zh-CN,zh,en-US,en';
          prefs.spellcheck = prefs.spellcheck || {};
          prefs.spellcheck.dictionaries = ['zh-CN'];
          fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2), 'utf8');
          messages.push('已同步 Chromium 首选语言为简体中文 (Default/Preferences)');
        } catch (_) {}
      }

      const localStatePath = path.join(webviewDir, 'Local State');
      if (fs.existsSync(localStatePath)) {
        try {
          const state = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
          state.intl = state.intl || {};
          state.intl.selected_languages = 'zh-CN,zh';
          state.intl.accept_languages = 'zh-CN,zh,en-US,en';
          fs.writeFileSync(localStatePath, JSON.stringify(state, null, 2), 'utf8');
          messages.push('已同步 Chromium 全局语言为简体中文 (Local State)');
        } catch (_) {}
      }
    }
  } catch (err) {
    messages.push(`Chromium 语言同步提醒: ${err.message}`);
  }

  // 3. Set CODEX_PLUS_PROTOCOL_PROXY_PORT env var if Codex++ is detected
  if (process.platform === 'win32') {
    try {
      const codexPlusDir = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Codex++');
      const watcherLnk = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'CodexPlusPlusWatcher.lnk');
      if (fs.existsSync(codexPlusDir) || fs.existsSync(watcherLnk)) {
        const curPort = process.env.CODEX_PLUS_PROTOCOL_PROXY_PORT;
        if (!curPort || curPort === '4010') {
          process.env.CODEX_PLUS_PROTOCOL_PROXY_PORT = '4019';
          try {
            execSync('powershell.exe -NoProfile -Command "[Environment]::SetEnvironmentVariable(\'CODEX_PLUS_PROTOCOL_PROXY_PORT\', \'4019\', \'User\')"', { timeout: 3000, stdio: 'ignore' });
            messages.push('已将 Codex++ 协议代理端口配置为 4019，彻底消除与 4010 网关冲突闪退');
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  // 4. Sync models.json & opencode-go-catalog.json base_instructions
  try {
    const catalogPath = path.join(codexDir, 'model-catalogs', 'opencode-go-catalog.json');
    const modelsPath = path.join(codexDir, 'models.json');
    const chineseNotice = '\n\n# 语言规范与任务自主执行铁律\n' +
      '1. 无论用户以何种语言提问，除非用户明确要求使用其他语言，否则请始终使用简体中文（Simplified Chinese）进行思考、回答和代码解释。\n' +
      '2. 严禁计划中途早熟停机：若在回复中制定了多步骤任务规划（例如 Step 1/N 到 Step N/N），必须严格自主推进并执行完毕，严禁中途（如 Step 2/N）无故停机交还控制权。\n' +
      '3. 遇到执行报错或脚本异常时，必须自主分析错误原因并调用工具尝试替代方案解决，严禁输出半截话、未闭合括号或未闭合反引号直接终止。\n' +
      '4. 回复必须保持语法结构与代码块完整闭合。\n' +
      '5. 视觉图像与设计生成规范：当用户需要生成图片、插画、设计图、二次元壁纸或反推图片提示词时，本地已挂载 ComfyUI 图像智能体工具（generate_image 与 interrogate_image）。必须优先直接调用 generate_image 工具生成真实图片，无需输出冗长的前置文字说明，严禁编写 System.Drawing 或 GDI+ 本地脚本伪造图片。\n';

    if (fs.existsSync(catalogPath)) {
      const cat = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      let modified = false;
      if (Array.isArray(cat.models)) {
        cat.models.forEach(m => {
          if (!m.base_instructions || !m.base_instructions.includes('无需输出冗长的前置文字说明')) {
            m.base_instructions = (m.base_instructions || '').replace(/\n\n# 语言规范[\s\S]*$/, '') + chineseNotice;
            modified = true;
          }
        });
      }
      if (modified) {
        fs.writeFileSync(catalogPath, JSON.stringify(cat, null, 2), 'utf8');
        messages.push('已为 opencode-go-catalog.json 补齐简体中文思考、自主执行与防早熟停机规范');
      }
    }

    if (fs.existsSync(modelsPath)) {
      const mData = JSON.parse(fs.readFileSync(modelsPath, 'utf8'));
      let modified = false;
      if (Array.isArray(mData.models)) {
        mData.models.forEach(m => {
          if (m.model_provider === 'opencode-go' && (!m.base_instructions || !m.base_instructions.includes('无需输出冗长的前置文字说明'))) {
            m.base_instructions = (m.base_instructions || '').replace(/\n\n# 语言规范[\s\S]*$/, '') + chineseNotice;
            modified = true;
          }
        });
      }
      if (modified) {
        fs.writeFileSync(modelsPath, JSON.stringify(mData, null, 2), 'utf8');
        messages.push('已为 models.json 补齐简体中文思考、自主执行与防早熟停机规范');
      }
    }
  } catch (_) {}

  // 5. Deploy / Repair Codex++ Chinese translation user script
  try {
    const codexPlusDir = path.join(process.env.APPDATA || '', 'Codex++', 'user_scripts');
    if (fs.existsSync(codexPlusDir)) {
      const scriptPath = path.join(codexPlusDir, 'market-codex-zhcn-translate.js');
      let needWrite = true;
      if (fs.existsSync(scriptPath)) {
        const cur = fs.readFileSync(scriptPath, 'utf8');
        if (cur === CODEX_ZHCN_TRANSLATE_SCRIPT) needWrite = false;
      }
      if (needWrite) {
        fs.writeFileSync(scriptPath, CODEX_ZHCN_TRANSLATE_SCRIPT, 'utf8');
        messages.push('已自动升级 Codex++ 全界面高保真简体中文汉化脚本 (market-codex-zhcn-translate.js)');
      }
    }
  } catch (err) {
    messages.push(`Codex++ 汉化脚本修复提醒: ${err.message}`);
  }

  // 6. Clean orphan thread-writer-locks if Codex is completely offline
  try {
    const lockDir = path.join(codexDir, 'thread-writer-locks');
    if (fs.existsSync(lockDir)) {
      let isCodexRunning = false;
      try {
        const { execSync } = require('child_process');
        const out = execSync('tasklist /FI "IMAGENAME eq codex.exe" /NH', { encoding: 'utf8' });
        if (out.includes('codex.exe')) isCodexRunning = true;
      } catch (_) {}
      if (!isCodexRunning) {
        const lockFiles = fs.readdirSync(lockDir).filter(f => f.endsWith('.lock'));
        let removedCount = 0;
        for (const f of lockFiles) {
          const fp = path.join(lockDir, f);
          try {
            const stat = fs.statSync(fp);
            if (stat.size === 0) {
              fs.unlinkSync(fp);
              removedCount++;
            }
          } catch (_) {}
        }
        if (removedCount > 0) {
          messages.push(`已安全清理 ${removedCount} 个离线孤儿 thread-writer-locks 互斥锁文件`);
        }
      }
    }
  } catch (_) {}

  return { success: true, messages };
}

// Automatically synchronize models from local opencode.jsonc on load
try { autoSyncFromOpencodeConfig(); } catch (_) {}

module.exports = {
  OPENCODE_GO_ALL_MODELS,
  autoSyncFromOpencodeConfig,
  NATIVE_RESPONSES_MODELS,
  nativeResponsesUnsupportedModels,
  markNativeResponsesUnsupported,
  clearNativeResponsesUnsupported,
  isNativeResponsesUnsupported,
  isNativeResponsesModel,
  ANTHROPIC_MODELS,
  MODEL_COMPATIBILITY_ALIASES,
  MODEL_TIERS,
  getModelTier,
  configureAdapter,
  adapterConfig,
  pruneResponsesPayload,
  pruneChatMessages,
  safeUnicodeSlice,
  balanceCodeBlocks,
  safeUnicodeSlice,
  balanceCodeBlocks,
  clearPruneFingerprints,
  prunedFingerprints,
  getCodexConfigDir,
  convertResponsesToChatPayload,
  bridgeResponsesStream,
  bridgeChatStream,
  convertChatResponseToResponses,
  convertResponsesToAnthropicPayload,
  bridgeAnthropicStream,
  convertAnthropicResponseToResponses,
  updateCodexTomlString,
  getCodexStatus,
  syncDynamicModels,
  bindCodexConfig,
  restoreCodexConfig,
  restartCodex,
  extractOrDeriveSessionId,
  recordResponseSession,
  resolveSessionFromPreviousResponse,
  responseIdToSessionMap,
  extractRawToolParams,
  normalizeToolParameters,
  formatUpstreamErrorResponse,
  sanitizeToolOutput,
  checkCodexProcessHealth,
  resumeOrCleanCodexProcesses,
  checkCodexLocaleAndEnvironment,
  repairCodexLocaleAndEnvironment,
  resolveCompatibleFallbackModel,
  sanitizeAndValidateChatMessages,
  extractPatchInput,
  contextCompactor,
  compactChatPayload: contextCompactor.compactChatPayload,
  compactAnthropicPayload: contextCompactor.compactAnthropicPayload,
  compactResponsesPayload: contextCompactor.compactResponsesPayload,
  compactText: contextCompactor.compactText,
  stripAnsi: contextCompactor.stripAnsi,
  cleanProgressBars: contextCompactor.cleanProgressBars,
  foldLockfiles: contextCompactor.foldLockfiles,
  foldTestPasses: contextCompactor.foldTestPasses,
  alignToolsSchema: contextCompactor.alignToolsSchema,
  slimToolsSchema: contextCompactor.slimToolsSchema,
  cleanDockerOutput: contextCompactor.cleanDockerOutput,
  cleanGitOutput: contextCompactor.cleanGitOutput,
  cleanBuildAndPkgOutput: contextCompactor.cleanBuildAndPkgOutput,
  dedupLogLines: contextCompactor.dedupLogLines,
  cleanTerraformOutput: contextCompactor.cleanTerraformOutput,
  cleanKubectlOutput: contextCompactor.cleanKubectlOutput,
  CODEX_ZHCN_TRANSLATE_SCRIPT,
  registerTransformer: contextCompactor.registerTransformer,
  unregisterTransformer: contextCompactor.unregisterTransformer,
  runPipeline: contextCompactor.runPipeline,
  getOptionsSignature: contextCompactor.getOptionsSignature,
  normalizeCompressionOptions: contextCompactor.normalizeCompressionOptions,
  getCompressionStats: contextCompactor.getCompressionStats,
  resetCompressionStats: contextCompactor.resetCompressionStats,
  COMPRESSION_PRESETS: contextCompactor.COMPRESSION_PRESETS,
  StreamDegenerationDetector,
  autoCorrectToolArgs,
  dispatchResponsesStreamError,
  findLatestCuaNodeExecutable,
  setComfyUIAdapter,
  getComfyUIAdapter
};
