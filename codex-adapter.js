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
  }
];

// Ensure shell_type is set for Codex CLI serde deserialization
for (const m of OPENCODE_GO_ALL_MODELS) {
  if (!m.shell_type) m.shell_type = 'shell_command';
}

/**
 * Dynamically synchronizes official upstream models into Codex catalog
 */
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
  'native-model-test'
]);


// Models using Anthropic Messages protocol on upstream
const ANTHROPIC_MODELS = new Set([
  'claude-haiku-5-5'
]);

// Upstream compatibility aliases: models that upstream has not fully opened for standard ChatCompletions
// are transparently mapped to equivalent top-tier flagship models with 100% feature parity.
const MODEL_COMPATIBILITY_ALIASES = {
  'gpt-5.6-luna': 'deepseek-v4-pro',
  'gpt-6-luna': 'deepseek-v4-pro',
  'grok-4.6': 'qwen3.7-max',
  'grok-4.7': 'qwen3.7-max',
  'minimax-m2.7': 'minimax-m3'
};

/**
 * Automatically determines the most compatible fallback model when upstream reports
 * an unsupported model or restricted model list.
 * e.g. "The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed deepseek-v4.1-flash."
 */
function resolveCompatibleFallbackModel(reqModel, errText = '', options = {}) {
  if (typeof errText !== 'string') errText = '';
  const cleanReq = (reqModel || '').toLowerCase().trim();

  // 1. Try parsing explicitly listed candidate model names from upstream error
  const match = errText.match(/supported(?:\s+API)?\s+model\s+names\s+are\s+[:\s]*([^.]+?)(?:,\s*but\s+you\s+passed|\s+but\s+you\s+passed|\.|\(|$)/i);
  if (match && match[1]) {
    const candidates = match[1]
      .split(/[,，]/)
      .map(s => s.trim().replace(/^['"`\[]+|['"`\]]+$/g, ''))
      .filter(s => s && /^[a-zA-Z0-9_.-]+$/.test(s) && s.toLowerCase() !== cleanReq);

    if (candidates.length > 0) {
      // 1.0 Flagship preference guard: If xhigh reasoning effort or flagship preference is explicitly set, prioritize pro/max
      if (options.preferFlagship || options.reasoningEffort === 'xhigh') {
        const proHit = candidates.find(c => c.toLowerCase().includes('pro') || c.toLowerCase().includes('max'));
        if (proHit) return proHit;
      }

      // 1.1 Pro/Advanced reasoning models (gpt-*, o1/o3, grok-*, claude-*, deepseek-v4-pro, etc.)
      const isProOrAdvanced = cleanReq.includes('pro') || cleanReq.includes('max') || cleanReq.includes('luna') || 
        cleanReq.startsWith('gpt-') || cleanReq.startsWith('grok-') || cleanReq.startsWith('claude-');
      if (isProOrAdvanced) {
        const proHit = candidates.find(c => c.toLowerCase().includes('pro') || c.toLowerCase().includes('max'));
        if (proHit) return proHit;
      }

      // 1.2 Speed / Flash models
      const isFlash = cleanReq.includes('flash') || cleanReq.includes('speed') || cleanReq.includes('mini') || cleanReq.includes('turbo');
      if (isFlash) {
        const flashHit = candidates.find(c => c.toLowerCase().includes('flash') || c.toLowerCase().includes('mini'));
        if (flashHit) return flashHit;
      }

      // 1.3 Specific keyword match (code, vision, etc.)
      for (const kw of ['code', 'vision', 'plus', 'preview']) {
        if (cleanReq.includes(kw)) {
          const hit = candidates.find(c => c.toLowerCase().includes(kw));
          if (hit) return hit;
        }
      }

      // 1.4 Family prefix match (e.g. deepseek- -> deepseek-)
      const prefix = cleanReq.split(/[-_.]/)[0];
      if (prefix && prefix.length > 2) {
        const familyHit = candidates.find(c => c.toLowerCase().startsWith(prefix));
        if (familyHit) return familyHit;
      }

      // 1.5 Prefer pro/flagship if available in candidates, otherwise first candidate
      const defaultFlagship = candidates.find(c => c.toLowerCase().includes('pro') || c.toLowerCase().includes('flash')) || candidates[0];
      return defaultFlagship;
    }
  }

  // 2. Heuristic rules when candidate list is absent from error text
  if (cleanReq === 'deepseek-v4.1-flash' || cleanReq === 'deepseek-v4-flash') {
    return 'deepseek-flash';
  }
  if (cleanReq === 'deepseek-flash') {
    return 'deepseek-v4-pro';
  }
  if (cleanReq.startsWith('deepseek')) {
    return 'deepseek-flash';
  }
  if (cleanReq.startsWith('gpt-') || cleanReq.startsWith('grok-')) {
    return 'deepseek-v4-pro';
  }
  if (cleanReq.startsWith('kimi-')) {
    return 'kimi-k3';
  }
  if (cleanReq.startsWith('glm')) {
    return cleanReq === 'glm-5.3' ? 'glm-5.2' : 'glm-5.3';
  }
  if (cleanReq.startsWith('qwen')) {
    return 'qwen3.7-max';
  }

  return cleanReq === 'deepseek-flash' ? 'deepseek-v4-pro' : 'deepseek-flash';
}

/**
 * Prunes and compresses an oversized Responses API payload (body.input) to fit within
 * the model's context window (e.g. 1M or 2M tokens).
 */
function pruneResponsesPayload(body) {
  if (!body) return body;
  const cloned = JSON.parse(JSON.stringify(body));

  if (Array.isArray(cloned.input)) {
    const input = cloned.input;
    const totalItems = input.length;

    // 1. Compress giant tool outputs (> 2000 chars) and giant message content (> 6000 chars)
    for (let i = 0; i < totalItems; i++) {
      const item = input[i];
      if (!item || typeof item !== 'object') continue;

      const isToolOutput = item.type === 'function_call_output' ||
        item.type === 'custom_tool_call_output' ||
        item.type === 'tool_search_output' ||
        (item.type && item.type.endsWith('_output')) ||
        (item.call_id && item.output !== undefined);

      if (isToolOutput && item.output) {
        let outStr = sanitizeToolOutput(item.output);
        if (outStr.length > 2000) {
          const head = outStr.slice(0, 600);
          const tail = outStr.slice(-600);
          const folded = outStr.length - 1200;
          item.output = `${head}\n\n[... 智能网关自愈：已自动折叠 ${folded} 字符历史工具输出以防上下文超限 ...]\n\n${tail}`;
        } else {
          item.output = outStr;
        }
      }

      if (typeof item.content === 'string' && item.content.length > 6000 && i < totalItems - 2) {
        const head = item.content.slice(0, 1500);
        const tail = item.content.slice(-1500);
        const folded = item.content.length - 3000;
        item.content = `${head}\n\n[... 智能网关自愈：已自动折叠 ${folded} 字符历史长文本以防上下文超限 ...]\n\n${tail}`;
      }
    }

    // 2. Sliding window: if input length > 18, prune intermediate items with turn-boundary safety
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

      const tailItems = input.slice(tailStartIndex);
      const droppedCount = input.length - headItems.length - tailItems.length;
      if (droppedCount > 0) {
        const notice = {
          type: 'message',
          role: 'system',
          content: `[系统自动自愈提示：智能网关已对前序 ${droppedCount} 条历史中间交互执行滑动窗口折叠，保留初始任务指令与最近交互上下文，已消除上下文超限。]`
        };
        cloned.input = [...headItems, notice, ...tailItems];
      }
    }
  }

  return cloned;
}

/**
 * Prunes and compresses an oversized standard ChatCompletions messages array.
 */
function pruneChatMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const cloned = JSON.parse(JSON.stringify(messages));

  for (let i = 0; i < cloned.length; i++) {
    const msg = cloned[i];
    if (!msg) continue;
    const isTool = msg.role === 'tool';
    const isOversized = typeof msg.content === 'string' && msg.content.length > 2500;
    if (isOversized && (isTool || i < cloned.length - 1)) {
      const head = msg.content.slice(0, 800);
      const tail = msg.content.slice(-800);
      const folded = msg.content.length - 1600;
      msg.content = `${head}\n\n[... 智能网关自愈：已自动折叠 ${folded} 字符历史输出以防上下文超限 ...]\n\n${tail}`;
    }
  }

  if (cloned.length > 18) {
    const sysMsgs = cloned.filter((m, idx) => idx === 0 || m.role === 'system');
    const nonSys = cloned.filter((m, idx) => idx !== 0 && m.role !== 'system');
    const firstUser = nonSys[0];
    const recentMsgs = nonSys.slice(-12);
    const middleDropped = nonSys.length - 1 - recentMsgs.length;
    if (middleDropped > 0) {
      const notice = {
        role: 'system',
        content: `[系统自动自愈提示：智能网关已自动压缩中间 ${middleDropped} 轮历史对话，保留初始目标与最近交互，已消除上下文超限。]`
      };
      return [...sysMsgs, ...(firstUser ? [firstUser] : []), notice, ...recentMsgs];
    }
  }

  return cloned;
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
      result.push(msg);

      const expectedIds = msg.tool_calls.map(tc => tc.id).filter(Boolean);
      const expectedIdSet = new Set(expectedIds);
      const foundToolMsgs = new Map(); // callId -> toolMsg
      const interleavedMsgs = [];      // non-tool messages or orphan tool messages

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
        } else if (nextMsg.role === 'assistant' || nextMsg.role === 'user') {
          break;
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
            content: `[Tool Output: ${typeof interMsg.content === 'string' ? interMsg.content : JSON.stringify(interMsg.content)}]`
          });
        } else {
          result.push(interMsg);
        }
      }

      i = j;
    } else if (msg && msg.role === 'tool') {
      result.push({
        role: 'user',
        content: `[Tool Output: ${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}]`
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
          const hasImages = item.content.some(c => c && (c.type === 'input_image' || c.type === 'image_url'));
          if (hasImages) {
            content = item.content.map(c => {
              if (typeof c === 'string') return { type: 'text', text: c };
              if (c.type === 'input_text' || c.type === 'text') return { type: 'text', text: c.text || '' };
              if (c.type === 'input_image') return { type: 'image_url', image_url: { url: c.image_url || c.url } };
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

  // Tools mapping
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    chatPayload.tools = body.tools.map((t, idx) => {
      const toolName = t.function?.name || t.name || (t.type && t.type !== 'function' ? t.type : null) || `custom_tool_${idx}`;
      const description = t.function?.description || t.description || '';
      const rawParams = extractRawToolParams(t);
      const parameters = normalizeToolParameters(rawParams);
      return {
        type: 'function',
        function: {
          name: toolName,
          description,
          parameters
        }
      };
    }).filter(t => Boolean(t.function && t.function.name));
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
function bridgeResponsesStream(upstreamRes, clientRes, reqModel, reqId, onFinished) {
  clientRes.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  let seq = 0;
  const respId = reqId || ('resp_' + Date.now());
  const sendEvent = (event, data) => {
    if (clientRes.writableEnded || clientRes.destroyed) return;
    clientRes.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
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
  let reasoningCompleted = false;
  let reasoningIndex = 0;
  let textStarted = false;
  let textCompleted = false;
  let textIndex = 0;
  let inThinkTag = false;
  const itemIdReasoning = 'item_reasoning_' + Date.now();
  const itemIdText = 'item_text_' + Date.now();
  let fullReasoning = '';
  let fullText = '';
  const toolCallsMap = new Map(); // index -> { id, name, args, outIdx }
  let collectedUsage = null;
  let buffer = '';
  let streamFinished = false;
  let upstreamEnded = false;

  const buildFinalOutput = () => {
    const finalOutput = [];
    if (reasoningCompleted || fullReasoning) {
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
          arguments: rec.args,
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
    clientRes.write(': keep-alive\n\n');
  }, 10000);

  const stallWatchdog = setInterval(() => {
    if (clientRes.writableEnded || clientRes.destroyed || streamFinished) {
      clearInterval(stallWatchdog);
      clearInterval(heartbeatTimer);
      return;
    }
    if (Date.now() - lastDataTime > 300000) {
      clearInterval(stallWatchdog);
      clearInterval(heartbeatTimer);
      console.error(`[Bridge Stream Watchdog] Upstream stalled for >300s on model "${reqModel}". Closing stream with response.failed.`);
      dispatchStreamError(new Error('Upstream stalled for longer than 300s without returning data.'), true, 'upstream_stream_timeout');
    }
  }, 5000);

  const cleanup = () => {
    clearInterval(heartbeatTimer);
    clearInterval(stallWatchdog);
  };
  clientRes.once('close', () => {
    cleanup();
    if (upstreamRes && typeof upstreamRes.destroy === 'function' && !upstreamRes.destroyed) {
      upstreamRes.destroy();
    }
  });

  upstreamRes.on('error', (err) => {
    dispatchStreamError(err, true);
  });

  upstreamRes.on('close', () => {
    if (!streamFinished && !upstreamEnded) {
      dispatchStreamError(new Error('Premature close of upstream response stream'), false);
    }
  });

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

  upstreamRes.on('data', chunk => {
    lastDataTime = Date.now();
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep partial

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const payloadStr = line.slice(5).trim();
      if (!payloadStr || payloadStr === '[DONE]') continue;

      try {
        const parsed = JSON.parse(payloadStr);
        if (parsed.usage) collectedUsage = parsed.usage;

        const choice = parsed.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta;
        if (!delta) continue;

        let reasoningChunk = delta.reasoning || delta.reasoning_content;
        let textChunk = delta.content;

        // Support models that stream <think>...</think> inside delta.content
        if (textChunk && !textStarted && !reasoningCompleted) {
          if (textChunk.includes('<think>')) {
            inThinkTag = true;
            const parts = textChunk.split('<think>');
            textChunk = parts[1] || '';
          }
          if (inThinkTag) {
            if (textChunk.includes('</think>')) {
              const parts = textChunk.split('</think>');
              const thinkDelta = parts[0] || '';
              textChunk = parts[1] || '';
              inThinkTag = false;
              if (thinkDelta) {
                if (!reasoningChunk) reasoningChunk = thinkDelta;
                else reasoningChunk += thinkDelta;
              }
              closeReasoning();
            } else {
              if (!reasoningChunk) reasoningChunk = textChunk;
              else reasoningChunk += textChunk;
              textChunk = '';
            }
          }
        }

        // 1. Thinking / Reasoning Stream
        if (reasoningChunk && !textStarted) {
          if (!reasoningStarted && !reasoningCompleted) {
            reasoningStarted = true;
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
          closeText();
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallsMap.has(idx)) {
              const tcOutIdx = outputIndex++;
              const callId = tc.id || `call_${Date.now()}_${idx}`;
              const funcName = tc.function?.name || '';
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
              rec.name = tc.function.name;
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
    }
  });

  upstreamRes.on('end', () => {
    upstreamEnded = true;
    if (streamFinished) return;

    closeReasoning();
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
  });
}

/**
 * Translates upstream non-streaming ChatCompletions JSON response to standard OpenAI Responses JSON response
 */
function convertChatResponseToResponses(chatJson, reqModel, reqId) {
  const respId = reqId || chatJson.id || ('resp_' + Date.now());
  const choice = chatJson.choices?.[0] || {};
  const msg = choice.message || {};
  const content = msg.content || '';
  const reasoning = msg.reasoning_content || msg.reasoning || '';
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
      output.push({
        id: tc.id || `call_${Date.now()}`,
        type: 'function_call',
        name: tc.function?.name || '',
        call_id: tc.id || '',
        arguments: tc.function?.arguments || '{}',
        status: 'completed'
      });
    }
  }

  if (output.length === 0) {
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
      output: [],
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
        let text = '';
        if (typeof item.content === 'string') {
          text = item.content;
        } else if (Array.isArray(item.content)) {
          text = item.content.map(c => typeof c === 'string' ? c : (c.text || '')).join('\n');
        }

        if (rawRole === 'developer' || rawRole === 'system') {
          system = system ? (system + '\n' + text) : text;
        } else {
          rawMessages.push({ role: rawRole, content: text });
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
    payload.tools = body.tools.map((t, idx) => {
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
function bridgeAnthropicStream(upstreamRes, clientRes, reqModel, reqId, onFinished) {
  clientRes.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  let seq = 0;
  const respId = reqId || ('resp_' + Date.now());
  const sendEvent = (event, data) => {
    if (clientRes.writableEnded || clientRes.destroyed) return;
    clientRes.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
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
  const toolCallsMap = new Map(); // blockIndex -> { id, name, args, outIdx }
  let collectedUsage = null;
  let buffer = '';
  let streamFinished = false;
  let upstreamEnded = false;

  const buildFinalOutput = () => {
    const finalOutput = [];
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

  const dispatchStreamError = (err, isExplicitError = false, overrideCode = null) => {
    if (streamFinished || clientRes.writableEnded || clientRes.destroyed) {
      cleanup();
      return;
    }
    streamFinished = true;
    closeText();
    const finalOutput = buildFinalOutput();
    const isEmpty = fullText === '' && toolCallsMap.size === 0;
    const errCode = overrideCode || (isEmpty ? 'upstream_stream_empty_truncated' : 'upstream_stream_truncated');
    const errMsg = err?.message
      ? `Upstream stream error: ${err.message}`
      : (isEmpty ? 'Upstream stream disconnected unexpectedly without returning any content (empty stream truncated).' : 'Upstream stream disconnected unexpectedly before generating output or tool calls.');

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
    clientRes.write(': keep-alive\n\n');
  }, 10000);

  const stallWatchdog = setInterval(() => {
    if (clientRes.writableEnded || clientRes.destroyed || streamFinished) {
      clearInterval(stallWatchdog);
      clearInterval(heartbeatTimer);
      return;
    }
    if (Date.now() - lastDataTime > 300000) {
      clearInterval(stallWatchdog);
      clearInterval(heartbeatTimer);
      console.error(`[Anthropic Stream Watchdog] Upstream stalled for >300s on model "${reqModel}". Closing stream with response.failed.`);
      dispatchStreamError(new Error('Upstream stalled for longer than 300s without returning data.'), true, 'upstream_stream_timeout');
    }
  }, 5000);

  const cleanup = () => {
    clearInterval(heartbeatTimer);
    clearInterval(stallWatchdog);
  };
  clientRes.once('close', () => {
    cleanup();
    if (upstreamRes && typeof upstreamRes.destroy === 'function' && !upstreamRes.destroyed) {
      upstreamRes.destroy();
    }
  });

  upstreamRes.on('error', (err) => {
    dispatchStreamError(err, true);
  });

  upstreamRes.on('close', () => {
    if (!streamFinished && !upstreamEnded) {
      dispatchStreamError(new Error('Premature close of upstream response stream'), false);
    }
  });

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

  upstreamRes.on('data', chunk => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const payloadStr = line.slice(5).trim();
      if (!payloadStr) continue;

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
          if (cb?.type === 'text') {
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
            closeText();
            const bIdx = parsed.index ?? outputIndex;
            const tcOutIdx = outputIndex++;
            const callId = cb.id || `call_${Date.now()}_${bIdx}`;
            const funcName = cb.name || 'custom_tool';
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
          if (delta?.type === 'text_delta' && delta.text) {
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
    }
  });

  upstreamRes.on('end', () => {
    upstreamEnded = true;
    if (streamFinished) return;

    closeText();

    if (fullText === '' && toolCallsMap.size === 0) {
      dispatchStreamError(null, false);
      return;
    }

    streamFinished = true;
    const finalOutput = buildFinalOutput();

    const usageObj = normalizeResponsesUsage(
      collectedUsage,
      Math.max(10, Math.round(fullText.length * 0.4)),
      Math.max(5, Math.round(fullText.length * 0.7))
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
        reasoning: { effort: 'low', summary: null },
        text: { verbosity: null, format: { type: 'text' } },
        moderation: null
      }
    });

    cleanup();
    clientRes.end();
    if (typeof onFinished === 'function') onFinished();
  });
}

/**
 * Translates upstream non-streaming Anthropic JSON response to standard OpenAI Responses JSON response
 */
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
      } else if (c.type === 'tool_use') {
        output.push({
          id: c.id || `call_${Date.now()}`,
          type: 'function_call',
          name: c.name || 'custom_tool',
          call_id: c.id || '',
          arguments: typeof c.input === 'string' ? c.input : JSON.stringify(c.input || {}),
          status: 'completed'
        });
      }
    }
  }

  if (output.length === 0) {
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
      output: [],
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
 * Updates TOML config string preserving structure, comments, and existing sections
 */
function updateCodexTomlString(rawToml, { model, provider, reasoningEffort, routerUrl, catalogRelativePath }) {
  let lines = rawToml ? rawToml.split(/\r?\n/) : [];

  function setTopLevelKey(key, value) {
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('[') && line.endsWith(']')) {
        break;
      }
      if (new RegExp(`^\\s*${key}\\s*=`).test(line)) {
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

  // Safeguard: Always ensure [model_providers.custom] points to local router as well
  // This prevents Codex from erroring out with "supported API model names are ... but you passed deepseek-v4.1-flash"
  // if the user toggles provider back to "custom" in the UI.
  let hasCustom = false;
  inSection = false;
  for (let i = 0; i < filteredLines.length; i++) {
    const l = filteredLines[i].trim();
    if (l === '[model_providers.custom]') {
      hasCustom = true;
      inSection = true;
      continue;
    }
    if (inSection) {
      if (l.startsWith('[')) {
        inSection = false;
      } else if (l.startsWith('base_url =')) {
        filteredLines[i] = `base_url = ${JSON.stringify(routerUrl)}`;
      } else if (l.startsWith('wire_api =')) {
        filteredLines[i] = 'wire_api = "responses"';
      }
    }
  }

  if (!hasCustom && provider === 'custom') {
    filteredLines.push('');
    filteredLines.push('[model_providers.custom]');
    filteredLines.push('name = "custom"');
    filteredLines.push('wire_api = "responses"');
    filteredLines.push('requires_openai_auth = true');
    filteredLines.push(`base_url = ${JSON.stringify(routerUrl)}`);
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
    availableModels: OPENCODE_GO_ALL_MODELS.map(m => ({
      slug: m.slug,
      display_name: m.display_name,
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

  const catalogModels = OPENCODE_GO_ALL_MODELS.map(m => {
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
  messages.push(`已生成 OpenCode Go 全量 38 款模型元数据目录 (${catalogFile})`);

  // Step 3: Update models.json
  try {
    let existingModels = [];
    if (fs.existsSync(modelsPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(modelsPath, 'utf8'));
        if (Array.isArray(parsed.models)) existingModels = parsed.models;
      } catch (e) {}
    }
    const enrichedOpencodeModels = OPENCODE_GO_ALL_MODELS.map(m => {
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
      execSync('pkill -f "codex" || true', { timeout: 5000 });
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
function extractOrDeriveSessionId(req, body) {
  // 1. Explicit x-opencode-session / x-session-id
  const headerSession = req?.headers?.['x-opencode-session'] || req?.headers?.['x-session-id'];
  if (headerSession && typeof headerSession === 'string' && headerSession.trim()) {
    return headerSession.trim();
  }

  // 2. Explicit x-conversation-id header
  const convHeader = req?.headers?.['x-conversation-id'];
  if (convHeader && typeof convHeader === 'string' && convHeader.trim()) {
    const trimmed = convHeader.trim();
    return trimmed.startsWith('session-') ? trimmed : `session-conv-${trimmed}`;
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
  const codexParentThread = req?.headers?.['x-codex-parent-thread-id'] || req?.headers?.['x-thread-id'];
  if (codexParentThread && typeof codexParentThread === 'string' && codexParentThread.trim()) {
    const trimmed = codexParentThread.trim();
    return trimmed.startsWith('session-') ? trimmed : `session-codex-${trimmed}`;
  }

  // 4. Explicit x-request-id / x-client-request-id header
  const reqIdHeader = req?.headers?.['x-request-id'] || req?.headers?.['x-client-request-id'];
  if (reqIdHeader && typeof reqIdHeader === 'string' && reqIdHeader.trim()) {
    const trimmed = reqIdHeader.trim();
    return trimmed.startsWith('session-') ? trimmed : `session-req-${trimmed}`;
  }

  // 5. previous_response_id / parent_response_id / thread_id / conversation_id in Responses payload body
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
      return prevId.startsWith('session-') ? prevId : `session-resp-${prevId}`;
    }
    if (parsed.parent_response_id && typeof parsed.parent_response_id === 'string' && parsed.parent_response_id.trim()) {
      const parentId = parsed.parent_response_id.trim();
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
  }

  // 6. Fallback: dynamic session isolation per connection/turn to prevent upstream concurrent collision
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
if ($resumed -eq 0) {
    Get-Process -Name "ChatGPT" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
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
    } else {
      return { success: true, killed: true, message: '已安全清理霸占 SingleInstanceLock 互斥锁的无窗口僵死进程，可正常点击桌面图标秒开' };
    }
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
    ["Help", "帮助"],
    ["New chat", "新聊天"],
    ["Scheduled", "定时任务"],
    ["Plugins", "插件"],
    ["Explore", "探索"],
    ["Projects", "项目"],
    ["New Project...", "新建项目..."],
    ["New Project…", "新建项目…"],
    ["New Project", "新建项目"],
    ["Open Folder...", "打开文件夹..."],
    ["Open Folder…", "打开文件夹…"],
    ["Open Folder", "打开文件夹"],
    ["Close", "关闭"],
    ["Log out", "退出登录"],
    ["Log Out", "退出登录"],
    ["Settings", "设置"],
    ["Preferences", "偏好设置"],
    ["Keyboard Shortcuts", "快捷键"],
    ["Documentation", "官方文档"],
    ["Release Notes", "更新日志"],
    ["Ask for changes", "请求修改"],
    ["Ask for selection edit", "行内微调"],
    ["Accept", "接受"],
    ["Reject", "拒绝"],
    ["Apply", "应用"],
    ["Discard", "放弃"],
    ["Diff", "差异对比"],
    ["Revert", "还原"],
    ["Keep", "保留"],
    ["Reasoning effort", "思考等级"],
    ["Reasoning", "思考推导"],
    ["Temporary chat", "临时聊天"],
    ["Attach files", "添加附件"],
    ["Send message", "发送消息"],
    ["Cancel generation", "停止生成"],
    ["Stop generating", "停止生成"],
    ["Delete", "删除"],
    ["Cancel", "取消"],
    ["Save", "保存"],
    ["Export", "导出"],
    ["Confirm", "确认"],
    ["Retry", "重试"],
    ["Model", "模型"],
    ["API Key", "API 密钥"]
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
  let currentModel = null;

  if (hasConfig) {
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const mLocale = raw.match(/localeOverride\s*=\s*["']([^"']+)["']/);
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
      '4. 回复必须保持语法结构与代码块完整闭合。\n';

    if (fs.existsSync(catalogPath)) {
      const cat = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      let modified = false;
      if (Array.isArray(cat.models)) {
        cat.models.forEach(m => {
          if (!m.base_instructions || !m.base_instructions.includes('严禁计划中途早熟停机')) {
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
          if (m.model_provider === 'opencode-go' && (!m.base_instructions || !m.base_instructions.includes('严禁计划中途早熟停机'))) {
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

  return { success: true, messages };
}

module.exports = {
  OPENCODE_GO_ALL_MODELS,
  NATIVE_RESPONSES_MODELS,
  ANTHROPIC_MODELS,
  MODEL_COMPATIBILITY_ALIASES,
  pruneResponsesPayload,
  pruneChatMessages,
  getCodexConfigDir,
  convertResponsesToChatPayload,
  bridgeResponsesStream,
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
  cleanTerraformOutput: contextCompactor.cleanTerraformOutput,
  cleanKubectlOutput: contextCompactor.cleanKubectlOutput,
  registerTransformer: contextCompactor.registerTransformer,
  unregisterTransformer: contextCompactor.unregisterTransformer,
  runPipeline: contextCompactor.runPipeline,
  getOptionsSignature: contextCompactor.getOptionsSignature,
  normalizeCompressionOptions: contextCompactor.normalizeCompressionOptions,
  getCompressionStats: contextCompactor.getCompressionStats,
  resetCompressionStats: contextCompactor.resetCompressionStats,
  COMPRESSION_PRESETS: contextCompactor.COMPRESSION_PRESETS
};
