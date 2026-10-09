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
      { effort: 'low', description: '极速探索' },
      { effort: 'medium', description: '均衡长文本推理' },
      { effort: 'high', description: '超长上下文深度推导' }
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
      { effort: 'low', description: '快速生成' },
      { effort: 'medium', description: '细致重构' },
      { effort: 'high', description: '深度优化' }
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
    supported_reasoning_levels: [{ effort: 'medium', description: '标准推理' }],
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
      { effort: 'medium', description: '标准深度' },
      { effort: 'high', description: '全维推导' }
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
      { effort: 'low', description: '轻量思考' },
      { effort: 'medium', description: '标准思考' },
      { effort: 'high', description: '深度推演' }
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
      { effort: 'low', description: '超快响应' },
      { effort: 'medium', description: '标准平衡' }
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
    supported_reasoning_levels: [{ effort: 'medium', description: '常规推理' }],
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
      { effort: 'high', description: '深度逻辑链思考' }
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
      { effort: 'medium', description: '常规' }
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
    supported_reasoning_levels: [{ effort: 'medium', description: '常规' }],
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
    supported_reasoning_levels: [{ effort: 'medium', description: '常规' }],
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
      { effort: 'low', description: '快速模式' },
      { effort: 'medium', description: '标准模式' },
      { effort: 'high', description: '深度推演模式' }
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
    supported_reasoning_levels: [{ effort: 'medium', description: '常规' }],
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
      { effort: 'low', description: '轻量思考' },
      { effort: 'high', description: '高深逻辑分析' }
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
    supported_reasoning_levels: [{ effort: 'high', description: '深度思考' }],
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
      { effort: 'low', description: '快速' },
      { effort: 'high', description: '高深推理' }
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
    supported_reasoning_levels: [{ effort: 'high', description: '高深推理' }],
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
    supported_reasoning_levels: [{ effort: 'medium', description: '标准' }],
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
    supported_reasoning_levels: [{ effort: 'medium', description: '标准' }],
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
    supported_reasoning_levels: [{ effort: 'medium', description: '标准' }],
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
    supported_reasoning_levels: [{ effort: 'high', description: '高深推理' }],
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

// Models natively supporting OpenAI Responses API on OpenCode Go upstream
const NATIVE_RESPONSES_MODELS = new Set([
  'deepseek-v4-flash',
  'deepseek-v4-flash-vision-exp',
  'deepseek-flash',
  'deepseek-v4.1-flash',
  'deepseek-v4-pro',
  'grok-4.6',
  'grok-4.7',
  'gpt-5.6-luna'
]);

// Models using Anthropic Messages protocol on upstream
const ANTHROPIC_MODELS = new Set([
  'claude-haiku-5-5'
]);

function getCodexConfigDir() {
  return process.env.CODEX_CONFIG_DIR || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

/**
 * Converts OpenAI Responses API JSON payload to standard OpenAI ChatCompletions JSON payload
 */
function convertResponsesToChatPayload(body) {
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
        } else if (item.input && typeof item.input === 'object') {
          funcArgs = JSON.stringify(item.input);
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
        const content = typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? {});
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

  const chatPayload = {
    model,
    messages,
    stream: body.stream !== false
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
    chatPayload.tools = body.tools.map(t => {
      const toolName = t.function?.name || t.name || (t.type && t.type !== 'function' ? t.type : 'custom_tool');
      if (t.function) {
        return {
          type: 'function',
          function: {
            name: toolName,
            description: t.function.description || t.description || '',
            parameters: t.function.parameters || t.parameters || {}
          }
        };
      }
      return {
        type: 'function',
        function: {
          name: toolName,
          description: t.description || '',
          parameters: t.parameters || {}
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
  const itemIdReasoning = 'item_reasoning_' + Date.now();
  const itemIdText = 'item_text_' + Date.now();
  let fullReasoning = '';
  let fullText = '';
  const toolCallsMap = new Map(); // index -> { id, name, args, outIdx }
  let collectedUsage = null;
  let buffer = '';

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

        // 1. Thinking / Reasoning Stream
        const reasoningChunk = delta.reasoning || delta.reasoning_content;
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
        const textChunk = delta.content;
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
              const rec = {
                id: callId,
                name: funcName,
                args: '',
                outIdx: tcOutIdx
              };
              toolCallsMap.set(idx, rec);
              sendEvent('response.output_item.added', {
                type: 'response.output_item.added',
                sequence_number: seq++,
                output_index: tcOutIdx,
                item: { id: callId, type: 'function_call', name: funcName, call_id: callId, arguments: '' }
              });
            }

            const rec = toolCallsMap.get(idx);
            if (tc.function?.name && !rec.name) {
              rec.name = tc.function.name;
            }
            if (tc.id && !rec.id) {
              rec.id = tc.id;
            }
            if (tc.function?.arguments) {
              rec.args += tc.function.arguments;
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
      } catch (e) {}
    }
  });

  upstreamRes.on('end', () => {
    closeReasoning();
    closeText();

    // Close tool calls
    for (const rec of toolCallsMap.values()) {
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

    // Build final output array for response.completed
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
      finalOutput.push({
        id: rec.id,
        type: 'function_call',
        name: rec.name || 'custom_tool',
        call_id: rec.id,
        arguments: rec.args,
        status: 'completed'
      });
    }

    if (finalOutput.length === 0) {
      finalOutput.push({
        id: itemIdText,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: '', annotations: [], logprobs: [] }]
      });
    }

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
function convertResponsesToAnthropicPayload(body) {
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
        } else if (item.input && typeof item.input === 'object') {
          inputObj = item.input;
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
        const outputStr = typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? {});
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
    payload.tools = body.tools.map(t => {
      const name = t.function?.name || t.name || (t.type && t.type !== 'function' ? t.type : 'custom_tool');
      const description = t.function?.description || t.description || '';
      const inputSchema = t.function?.parameters || t.parameters || { type: 'object', properties: {} };
      return {
        name,
        description,
        input_schema: inputSchema
      };
    }).filter(t => Boolean(t.name));
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
            const rec = { id: callId, name: funcName, args: '', outIdx: tcOutIdx };
            toolCallsMap.set(bIdx, rec);
            sendEvent('response.output_item.added', {
              type: 'response.output_item.added',
              sequence_number: seq++,
              output_index: tcOutIdx,
              item: { id: callId, type: 'function_call', name: funcName, call_id: callId, arguments: '' }
            });
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
              sendEvent('response.function_call_arguments.delta', {
                type: 'response.function_call_arguments.delta',
                sequence_number: seq++,
                output_index: rec.outIdx,
                call_id: rec.id,
                delta: delta.partial_json
              });
            }
          }
        } else if (evType === 'content_block_stop') {
          const bIdx = parsed.index ?? 0;
          const rec = toolCallsMap.get(bIdx);
          if (rec) {
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
        } else if (evType === 'message_delta' && parsed.usage?.output_tokens) {
          if (!collectedUsage) collectedUsage = {};
          collectedUsage.output_tokens = parsed.usage.output_tokens;
        }
      } catch (e) {}
    }
  });

  upstreamRes.on('end', () => {
    closeText();

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
      finalOutput.push({
        id: rec.id,
        type: 'function_call',
        name: rec.name,
        call_id: rec.id,
        arguments: rec.args,
        status: 'completed'
      });
    }

    if (finalOutput.length === 0) {
      finalOutput.push({
        id: itemIdText,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: '', annotations: [], logprobs: [] }]
      });
    }

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
    output.push({
      id: 'msg_' + Date.now(),
      type: 'message',
      status: 'completed',
      role: 'assistant',
      phase: 'final_answer',
      content: [{ type: 'output_text', text: '', annotations: [], logprobs: [] }]
    });
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

  // Update or append [model_providers.custom] section
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

  if (!hasCustom) {
    filteredLines.push('');
    filteredLines.push('[model_providers.custom]');
    filteredLines.push('name = "custom"');
    filteredLines.push('wire_api = "responses"');
    filteredLines.push('requires_openai_auth = true');
    filteredLines.push(`base_url = ${JSON.stringify(routerUrl)}`);
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
      isBound = raw.includes(`127.0.0.1:${expectedPort}`) ||
        raw.includes(`:${expectedPort}/v1`) ||
        (currentProvider === 'opencode-go' && (raw.includes('127.0.0.1') || raw.includes('localhost')));
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
    currentModel,
    currentProvider,
    currentReasoningEffort,
    hasAuth,
    hasValidAuthKey,
    hasBackup,
    backupInfo,
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

  const catalogModels = OPENCODE_GO_ALL_MODELS.map(m => ({
    ...baseTemplate,
    ...m,
    shell_type: 'shell_command',
    visibility: 'list',
    supported_in_api: true
  }));

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
    const newSlugs = new Set(OPENCODE_GO_ALL_MODELS.map(m => m.slug));
    const retainedModels = existingModels.filter(m => !newSlugs.has(m.slug));
    const mergedModels = [...OPENCODE_GO_ALL_MODELS, ...retainedModels];
    fs.writeFileSync(modelsPath, JSON.stringify({ models: mergedModels }, null, 2), 'utf8');
    messages.push(`已同步全量模型至 ${modelsPath} (总计 ${mergedModels.length} 个模型)`);
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
function restoreCodexConfig(codexDirOverride = null) {
  const codexDir = codexDirOverride || getCodexConfigDir();
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
          fs.copyFileSync(bkConfig, configPath);
          messages.push('已还原原始 config.toml');
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

      if (fs.existsSync(catalogPath)) {
        try { fs.unlinkSync(catalogPath); } catch (e) {}
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
      fs.copyFileSync(configPath + '.router-bak', configPath);
      messages.push('已从 .router-bak 还原 config.toml');
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
      if (fs.existsSync(catalogPath)) fs.unlinkSync(catalogPath);
    } catch (e) {}
    return { success: true, restoredFrom: 'router-bak', messages };
  }

  return {
    success: false,
    message: '未找到 Codex 原始配置备份文件，系统无需还原',
    messages
  };
}

module.exports = {
  OPENCODE_GO_ALL_MODELS,
  NATIVE_RESPONSES_MODELS,
  ANTHROPIC_MODELS,
  getCodexConfigDir,
  convertResponsesToChatPayload,
  bridgeResponsesStream,
  convertChatResponseToResponses,
  convertResponsesToAnthropicPayload,
  bridgeAnthropicStream,
  convertAnthropicResponseToResponses,
  updateCodexTomlString,
  getCodexStatus,
  bindCodexConfig,
  restoreCodexConfig
};
