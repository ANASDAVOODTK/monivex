// vLLM model preset catalog.
//
// Curated from the community recipes at recipes.vllm.ai. Each preset is a
// model with one or more named "configurations" — a feature/precision set
// (FP8, tool calling, MTP speculative decoding, …). Picking a configuration
// pre-fills the deploy form: model ID, context length, extra CLI args and
// environment variables.
//
// GPU count is NOT baked into a configuration — the deploy form has its own
// GPUs picker. `tensorParallelSize` here is only the recommended default the
// picker starts on; the user is free to change it for their own hardware.
//
// `args` holds the extra vLLM argv NOT covered by a typed field — one argv
// per array element (so a flag and its value are two consecutive entries).
// --model / --host / --port / --tensor-parallel-size / --max-model-len /
// --gpu-memory-utilization / --served-model-name are extracted into fields
// and must NOT appear here.

export interface VllmEnvVar {
  key: string;
  value: string;
}

export interface VllmVariant {
  /** Feature/precision label — no hardware in here. */
  label: string;
  /** Overrides the preset modelId when the recipe serves a different repo (e.g. an FP4 re-quant). */
  modelId?: string;
  served?: string;
  /** Recommended GPU count — the GPUs picker starts here but the user can change it. */
  tensorParallelSize?: string;
  maxModelLen?: string;
  gpuMemoryUtilization?: string;
  args: string[];
  env?: VllmEnvVar[];
  /** Suggest the :nightly image instead of :latest. */
  nightly?: boolean;
}

export interface VllmPreset {
  id: string;
  provider: string;
  name: string;
  modelId: string;
  description: string;
  context: number;
  minVllm: string;
  variants: VllmVariant[];
}

/** GPU count options for the deploy form's GPUs picker. */
export const VLLM_GPU_OPTIONS = ['1', '2', '4', '8'] as const;

/** Sentinel provider for fully manual entry (no catalog model). */
export const VLLM_CUSTOM_PROVIDER = 'Custom';

export const VLLM_PRESETS: VllmPreset[] = [
  // ---- Arcee AI ----
  {
    id: 'arcee-trinity-large-thinking',
    provider: 'Arcee AI',
    name: 'Trinity-Large-Thinking',
    modelId: 'arcee-ai/Trinity-Large-Thinking',
    description: "Reasoning-focused sparse MoE with structured <think> traces and agentic tool use.",
    context: 262144,
    minVllm: '0.11.1',
    variants: [
      {
        label: 'Reasoning + tool use',
        args: ['--dtype', 'bfloat16', '--reasoning-parser', 'deepseek_r1', '--enable-auto-tool-choice', '--tool-call-parser', 'qwen3_coder'],
      },
    ],
  },

  // ---- DeepSeek ----
  {
    id: 'deepseek-r1',
    provider: 'DeepSeek',
    name: 'DeepSeek-R1',
    modelId: 'deepseek-ai/DeepSeek-R1-0528',
    description: '671B-parameter MoE reasoning model trained with large-scale RL for strong chain-of-thought.',
    context: 163840,
    minVllm: '0.12.0',
    variants: [
      {
        label: 'FP8 + expert parallel',
        modelId: 'deepseek-ai/DeepSeek-R1-0528',
        tensorParallelSize: '8',
        args: ['--trust-remote-code', '--enable-expert-parallel'],
      },
      {
        label: 'FP4 (NVIDIA re-quant)',
        modelId: 'nvidia/DeepSeek-R1-FP4',
        tensorParallelSize: '4',
        args: ['--trust-remote-code', '--enable-expert-parallel'],
      },
    ],
  },
  {
    id: 'deepseek-v3',
    provider: 'DeepSeek',
    name: 'DeepSeek-V3',
    modelId: 'deepseek-ai/DeepSeek-V3',
    description: '671B-parameter Mixture-of-Experts model with native FP8 weights and strong reasoning/coding/math.',
    context: 163840,
    minVllm: '0.12.0',
    variants: [
      {
        label: 'FP8 + expert parallel',
        tensorParallelSize: '8',
        args: ['--trust-remote-code', '--enable-expert-parallel'],
      },
      {
        label: 'FP4 (NVIDIA re-quant)',
        modelId: 'nvidia/DeepSeek-V3-FP4',
        tensorParallelSize: '4',
        args: ['--trust-remote-code', '--enable-expert-parallel'],
      },
    ],
  },
  {
    id: 'deepseek-v31',
    provider: 'DeepSeek',
    name: 'DeepSeek-V3.1',
    modelId: 'deepseek-ai/DeepSeek-V3.1',
    description: 'Hybrid MoE supporting dynamic thinking / non-thinking modes with tool calling.',
    context: 163840,
    minVllm: '0.12.0',
    variants: [
      {
        label: 'Expert parallel',
        tensorParallelSize: '8',
        served: 'ds31',
        args: ['--enable-expert-parallel'],
      },
    ],
  },
  {
    id: 'deepseek-v32',
    provider: 'DeepSeek',
    name: 'DeepSeek-V3.2',
    modelId: 'deepseek-ai/DeepSeek-V3.2',
    description: 'MoE with MLA + sparse attention and scalable RL for strong reasoning and agent capabilities.',
    context: 163840,
    minVllm: '0.18.0',
    variants: [
      {
        label: 'Full reasoning + tools',
        tensorParallelSize: '8',
        args: [
          '--trust-remote-code',
          '--kernel-config.enable_flashinfer_autotune=False',
          '--tokenizer-mode', 'deepseek_v32',
          '--tool-call-parser', 'deepseek_v32',
          '--enable-auto-tool-choice',
          '--reasoning-parser', 'deepseek_v3',
        ],
      },
    ],
  },

  // ---- Ernie (Baidu) ----
  {
    id: 'ernie-45',
    provider: 'Baidu',
    name: 'ERNIE-4.5',
    modelId: 'baidu/ERNIE-4.5-21B-A3B-PT',
    description: 'ERNIE 4.5 MoE text models (21B-A3B / 300B-A47B) with BF16 and FP8 support.',
    context: 131072,
    minVllm: '0.10.1',
    variants: [
      { label: '21B-A3B (BF16)', tensorParallelSize: '1', args: [] },
      {
        label: '300B-A47B (FP8)',
        modelId: 'baidu/ERNIE-4.5-300B-A47B-PT',
        tensorParallelSize: '8',
        gpuMemoryUtilization: '0.95',
        args: ['--quantization', 'fp8'],
      },
    ],
  },

  // ---- GLM (Z-AI) ----
  {
    id: 'glm-45',
    provider: 'Z-AI (GLM)',
    name: 'GLM-4.5',
    modelId: 'zai-org/GLM-4.5-FP8',
    description: 'GLM-4.5 MoE (~358B total, BF16) with built-in MTP layers and native tool calling.',
    context: 131072,
    minVllm: '0.11.0',
    variants: [
      {
        label: 'FP8 + tool calling',
        tensorParallelSize: '8',
        args: ['--tool-call-parser', 'glm45', '--reasoning-parser', 'glm45', '--enable-auto-tool-choice'],
      },
    ],
  },
  {
    id: 'glm-46',
    provider: 'Z-AI (GLM)',
    name: 'GLM-4.6',
    modelId: 'zai-org/GLM-4.6-FP8',
    description: 'GLM-4.6 MoE (~357B total) with MTP speculative decoding, native tool calling and reasoning.',
    context: 202752,
    minVllm: '0.11.0',
    variants: [
      {
        label: 'FP8 + tool calling',
        tensorParallelSize: '8',
        args: ['--tool-call-parser', 'glm45', '--reasoning-parser', 'glm45', '--enable-auto-tool-choice'],
      },
      {
        label: 'FP8 + MTP speculative decoding',
        tensorParallelSize: '4',
        args: [
          '--speculative-config.method', 'mtp',
          '--speculative-config.num_speculative_tokens', '1',
          '--tool-call-parser', 'glm45',
          '--reasoning-parser', 'glm45',
          '--enable-auto-tool-choice',
        ],
      },
    ],
  },
  {
    id: 'glm-47',
    provider: 'Z-AI (GLM)',
    name: 'GLM-4.7',
    modelId: 'zai-org/GLM-4.7-FP8',
    description: 'GLM-4.7 MoE (~358B total) with MTP speculative decoding and updated tool-call parser.',
    context: 202752,
    minVllm: '0.11.0',
    variants: [
      {
        label: 'FP8 + MTP speculative decoding',
        tensorParallelSize: '4',
        args: [
          '--speculative-config.method', 'mtp',
          '--speculative-config.num_speculative_tokens', '1',
          '--tool-call-parser', 'glm47',
          '--reasoning-parser', 'glm45',
          '--enable-auto-tool-choice',
        ],
      },
    ],
  },
  {
    id: 'glm-5',
    provider: 'Z-AI (GLM)',
    name: 'GLM-5',
    modelId: 'zai-org/GLM-5-FP8',
    description: 'GLM-5 frontier-scale MoE (~744B total) for reasoning, coding, and agentic tasks.',
    context: 202752,
    minVllm: '0.16.0',
    variants: [
      {
        label: 'FP8 + MTP speculative decoding',
        tensorParallelSize: '8',
        served: 'glm-5-fp8',
        args: [
          '--speculative-config.method', 'mtp',
          '--speculative-config.num_speculative_tokens', '3',
          '--tool-call-parser', 'glm47',
          '--reasoning-parser', 'glm45',
          '--enable-auto-tool-choice',
          '--chat-template-content-format=string',
        ],
      },
    ],
  },

  // ---- Google ----
  {
    id: 'gemma-4-26b-a4b',
    provider: 'Google',
    name: 'Gemma 4 26B-A4B IT',
    modelId: 'google/gemma-4-26B-A4B-it',
    description: 'Gemma 4 MoE multimodal (26B total / 4B active) with thinking mode and tool-use protocol.',
    context: 131072,
    minVllm: '0.19.1',
    variants: [
      {
        label: 'Standard (BF16)',
        tensorParallelSize: '1',
        maxModelLen: '32768',
        gpuMemoryUtilization: '0.90',
        args: [],
      },
      {
        label: 'Full-featured (tools + thinking)',
        tensorParallelSize: '1',
        maxModelLen: '16384',
        gpuMemoryUtilization: '0.90',
        args: [
          '--enable-auto-tool-choice',
          '--reasoning-parser', 'gemma4',
          '--tool-call-parser', 'gemma4',
          '--chat-template', 'examples/tool_chat_template_gemma4.jinja',
          '--limit-mm-per-prompt.image', '4',
          '--async-scheduling',
        ],
      },
    ],
  },
  {
    id: 'gemma-4-31b',
    provider: 'Google',
    name: 'Gemma 4 31B IT',
    modelId: 'google/gemma-4-31B-it',
    description: 'Unified multimodal Gemma 4 dense model (31B) with native text, image, and audio.',
    context: 262144,
    minVllm: '0.19.1',
    variants: [
      {
        label: 'Standard (BF16)',
        tensorParallelSize: '2',
        maxModelLen: '32768',
        gpuMemoryUtilization: '0.90',
        args: [],
      },
      {
        label: 'Full-featured (tools + thinking)',
        tensorParallelSize: '2',
        maxModelLen: '16384',
        gpuMemoryUtilization: '0.90',
        args: [
          '--enable-auto-tool-choice',
          '--reasoning-parser', 'gemma4',
          '--tool-call-parser', 'gemma4',
          '--chat-template', 'examples/tool_chat_template_gemma4.jinja',
          '--limit-mm-per-prompt', '{"image": 4, "audio": 1}',
          '--async-scheduling',
        ],
      },
    ],
  },
  {
    id: 'gemma-4-e2b',
    provider: 'Google',
    name: 'Gemma 4 E2B IT',
    modelId: 'google/gemma-4-E2B-it',
    description: 'Compact Gemma 4 multimodal model (effective 2B) with text, image, and audio.',
    context: 131072,
    minVllm: '0.19.1',
    variants: [
      { label: 'Standard (BF16)', tensorParallelSize: '1', maxModelLen: '32768', args: [] },
    ],
  },
  {
    id: 'gemma-4-e4b',
    provider: 'Google',
    name: 'Gemma 4 E4B IT',
    modelId: 'google/gemma-4-E4B-it',
    description: 'Compact Gemma 4 multimodal model (effective 4B) with text, image, and audio.',
    context: 131072,
    minVllm: '0.19.1',
    variants: [
      { label: 'Standard (BF16)', tensorParallelSize: '1', maxModelLen: '32768', args: [] },
    ],
  },

  // ---- Hunyuan (Tencent) ----
  {
    id: 'hunyuan-a13b',
    provider: 'Tencent',
    name: 'Hunyuan-A13B-Instruct',
    modelId: 'tencent/Hunyuan-A13B-Instruct',
    description: 'Tencent Hunyuan A13B instruct-tuned MoE language model.',
    context: 32768,
    minVllm: '0.11.0',
    variants: [
      { label: 'Standard', tensorParallelSize: '2', args: ['--trust-remote-code'] },
    ],
  },

  // ---- InternLM ----
  {
    id: 'intern-s1',
    provider: 'InternLM',
    name: 'Intern-S1',
    modelId: 'internlm/Intern-S1',
    description: 'Intern-S1 vision-language model with BF16/FP8 variants and thinking modes.',
    context: 65536,
    minVllm: '0.10.0',
    variants: [
      {
        label: 'BF16',
        tensorParallelSize: '8',
        args: ['--trust-remote-code', '--enable-auto-tool-choice', '--reasoning-parser', 'deepseek_r1', '--tool-call-parser', 'internlm'],
      },
      {
        label: 'FP8',
        modelId: 'internlm/Intern-S1-FP8',
        tensorParallelSize: '4',
        args: ['--trust-remote-code', '--enable-auto-tool-choice', '--reasoning-parser', 'deepseek_r1', '--tool-call-parser', 'internlm'],
      },
    ],
  },

  // ---- Jina AI ----
  {
    id: 'jina-embeddings-v5',
    provider: 'Jina AI',
    name: 'Jina Embeddings v5 Text Small',
    modelId: 'jinaai/jina-embeddings-v5-text-small-retrieval',
    description: 'Multilingual text embedding model (677M) — served as a pooling runner.',
    context: 32768,
    minVllm: '0.20.0',
    variants: [
      { label: 'Retrieval (pooling runner)', tensorParallelSize: '1', args: ['--trust-remote-code', '--runner', 'pooling'] },
    ],
  },

  // ---- Meta ----
  {
    id: 'llama-31-8b',
    provider: 'Meta',
    name: 'Llama-3.1-8B-Instruct',
    modelId: 'meta-llama/Llama-3.1-8B-Instruct',
    description: "Meta's Llama 3.1 8B dense instruction-tuned model with 128K context.",
    context: 131072,
    minVllm: '0.6.0',
    variants: [
      { label: 'Standard', tensorParallelSize: '1', args: [] },
      {
        label: 'EAGLE3 speculative decoding',
        tensorParallelSize: '1',
        args: [
          '--speculative-config',
          '{"model":"RedHatAI/Llama-3.1-8B-Instruct-speculator.eagle3","method":"eagle3","num_speculative_tokens":3}',
        ],
      },
    ],
  },

  // ---- MiMo (Xiaomi) ----
  {
    id: 'mimo-v2-flash',
    provider: 'Xiaomi (MiMo)',
    name: 'MiMo-V2-Flash',
    modelId: 'XiaomiMiMo/MiMo-V2-Flash',
    description: 'MoE reasoning model (309B total / 15B active) with hybrid attention and MTP.',
    context: 262144,
    minVllm: '0.11.0',
    variants: [
      {
        label: 'Standard',
        tensorParallelSize: '4',
        served: 'mimo_v2_flash',
        gpuMemoryUtilization: '0.9',
        args: ['--trust-remote-code', '--generation-config', 'vllm'],
      },
      {
        label: 'Tool use + reasoning',
        tensorParallelSize: '4',
        served: 'mimo_v2_flash',
        gpuMemoryUtilization: '0.9',
        args: ['--trust-remote-code', '--tool-call-parser', 'qwen3_xml', '--reasoning-parser', 'qwen3', '--generation-config', 'vllm'],
      },
    ],
  },
  {
    id: 'mimo-v25',
    provider: 'Xiaomi (MiMo)',
    name: 'MiMo-V2.5',
    modelId: 'XiaomiMiMo/MiMo-V2.5',
    description: 'Native omnimodal model with text, image, video, and audio understanding.',
    context: 1048576,
    minVllm: '0.21.0',
    variants: [
      {
        label: 'Reasoning + tools',
        tensorParallelSize: '4',
        gpuMemoryUtilization: '0.95',
        args: [
          '--trust-remote-code',
          '--reasoning-parser', 'mimo',
          '--tool-call-parser', 'mimo',
          '--enable-auto-tool-choice',
          '--generation-config', 'vllm',
        ],
      },
    ],
  },

  // ---- Microsoft ----
  {
    id: 'phi-4-mini',
    provider: 'Microsoft',
    name: 'Phi-4-mini-instruct',
    modelId: 'microsoft/Phi-4-mini-instruct',
    description: "Microsoft's lightweight Phi-4 dense model with 128K context.",
    context: 131072,
    minVllm: '0.7.0',
    variants: [
      { label: 'Standard', tensorParallelSize: '1', maxModelLen: '4000', args: [] },
    ],
  },
  {
    id: 'phi-4-multimodal',
    provider: 'Microsoft',
    name: 'Phi-4-multimodal-instruct',
    modelId: 'microsoft/Phi-4-multimodal-instruct',
    description: "Microsoft's Phi-4 multimodal instruct model.",
    context: 131072,
    minVllm: '0.7.0',
    variants: [
      { label: 'Standard', tensorParallelSize: '1', maxModelLen: '4000', args: ['--trust-remote-code'] },
    ],
  },

  // ---- MiniMax ----
  {
    id: 'minimax-m2',
    provider: 'MiniMax',
    name: 'MiniMax-M2',
    modelId: 'MiniMaxAI/MiniMax-M2',
    description: 'MoE language model (230B total / 10B active) for coding and agent toolchains.',
    context: 196608,
    minVllm: '0.11.0',
    variants: [
      {
        label: 'Standard (FP8)',
        tensorParallelSize: '4',
        args: [
          '--tool-call-parser', 'minimax_m2',
          '--reasoning-parser', 'minimax_m2',
          '--compilation-config', '{"mode":3,"pass_config":{"fuse_minimax_qk_norm":true}}',
          '--enable-auto-tool-choice',
          '--trust-remote-code',
        ],
      },
      {
        label: 'Expert parallel',
        tensorParallelSize: '4',
        args: [
          '--enable-expert-parallel',
          '--tool-call-parser', 'minimax_m2',
          '--reasoning-parser', 'minimax_m2',
          '--compilation-config', '{"mode":3,"pass_config":{"fuse_minimax_qk_norm":true}}',
          '--enable-auto-tool-choice',
        ],
      },
    ],
  },
  {
    id: 'minimax-m27',
    provider: 'MiniMax',
    name: 'MiniMax-M2.7',
    modelId: 'MiniMaxAI/MiniMax-M2.7',
    description: 'Latest M2 release for coding, agent toolchains and long-context reasoning (native FP8).',
    context: 196608,
    minVllm: '0.20.0',
    variants: [
      {
        label: 'Standard (FP8)',
        tensorParallelSize: '4',
        args: [
          '--tool-call-parser', 'minimax_m2',
          '--reasoning-parser', 'minimax_m2',
          '--compilation-config', '{"mode":3,"pass_config":{"fuse_minimax_qk_norm":true}}',
          '--enable-auto-tool-choice',
          '--trust-remote-code',
        ],
      },
    ],
  },

  // ---- Mistral AI ----
  {
    id: 'ministral-3-14b',
    provider: 'Mistral AI',
    name: 'Ministral-3-14B-Instruct',
    modelId: 'mistralai/Ministral-3-14B-Instruct-2512',
    description: 'Ministral 3 Instruct with FP8 weights, vision support, and 256K context.',
    context: 262144,
    minVllm: '0.11.0',
    variants: [
      {
        label: 'Standard',
        tensorParallelSize: '1',
        args: [
          '--tokenizer_mode', 'mistral',
          '--config_format', 'mistral',
          '--load_format', 'mistral',
          '--enable-auto-tool-choice',
          '--tool-call-parser', 'mistral',
        ],
      },
    ],
  },
  {
    id: 'mistral-small-4-119b',
    provider: 'Mistral AI',
    name: 'Mistral-Small-4-119B',
    modelId: 'mistralai/Mistral-Small-4-119B-2603',
    description: 'Multimodal hybrid instruct + reasoning MoE (119B, 6.5B active) with native FP8.',
    context: 262144,
    minVllm: '0.20.0',
    variants: [
      {
        label: 'FLASH_ATTN_MLA + tools',
        tensorParallelSize: '2',
        maxModelLen: '262144',
        gpuMemoryUtilization: '0.8',
        args: [
          '--attention-backend', 'FLASH_ATTN_MLA',
          '--tool-call-parser', 'mistral',
          '--enable-auto-tool-choice',
          '--reasoning-parser', 'mistral',
          '--max_num_batched_tokens', '16384',
          '--max_num_seqs', '128',
        ],
      },
    ],
  },
  {
    id: 'mistral-medium-35',
    provider: 'Mistral AI',
    name: 'Mistral-Medium-3.5',
    modelId: 'mistralai/Mistral-Medium-3.5-128B',
    description: 'Dense vision-language model (128B) with native FP8 weights and 256K context.',
    context: 262144,
    minVllm: 'nightly',
    variants: [
      {
        label: 'Tools + reasoning (nightly)',
        tensorParallelSize: '8',
        nightly: true,
        args: [
          '--tokenizer_mode', 'mistral',
          '--config_format', 'mistral',
          '--load_format', 'mistral',
          '--enable-auto-tool-choice',
          '--tool-call-parser', 'mistral',
          '--reasoning-parser', 'mistral',
        ],
      },
    ],
  },

  // ---- Moonshot AI ----
  {
    id: 'kimi-k2-thinking',
    provider: 'Moonshot AI',
    name: 'Kimi-K2-Thinking',
    modelId: 'moonshotai/Kimi-K2-Thinking',
    description: 'Advanced reasoning MoE with native INT4 QAT weights for long-horizon agent workflows.',
    context: 262144,
    minVllm: '0.12.0',
    variants: [
      {
        label: 'Low-latency',
        tensorParallelSize: '8',
        args: ['--enable-auto-tool-choice', '--tool-call-parser', 'kimi_k2', '--reasoning-parser', 'kimi_k2', '--trust-remote-code'],
      },
      {
        label: 'High-throughput (decode context parallel)',
        tensorParallelSize: '8',
        args: [
          '--decode-context-parallel-size', '8',
          '--enable-auto-tool-choice',
          '--tool-call-parser', 'kimi_k2',
          '--reasoning-parser', 'kimi_k2',
          '--trust-remote-code',
        ],
      },
    ],
  },
  {
    id: 'kimi-linear-48b',
    provider: 'Moonshot AI',
    name: 'Kimi-Linear-48B-A3B-Instruct',
    modelId: 'moonshotai/Kimi-Linear-48B-A3B-Instruct',
    description: 'Instruction-tuned MoE (48B / ~3B active) with linear attention for 1M-token context.',
    context: 1048576,
    minVllm: '0.11.2',
    variants: [
      { label: '1M context', tensorParallelSize: '4', maxModelLen: '1048576', args: ['--trust-remote-code'] },
    ],
  },

  // ---- NVIDIA ----
  {
    id: 'nemotron-nano-9b-v2',
    provider: 'NVIDIA',
    name: 'Nemotron-Nano-9B-v2',
    modelId: 'nvidia/NVIDIA-Nemotron-Nano-9B-v2-FP8',
    description: 'Nemotron-Nano 9B Mamba-hybrid reasoning + tool-use model (FP8 variant).',
    context: 131072,
    minVllm: '0.10.1',
    variants: [
      { label: 'FP8', tensorParallelSize: '1', args: ['--trust-remote-code'] },
    ],
  },
  {
    id: 'nemotron-3-nano-30b',
    provider: 'NVIDIA',
    name: 'Nemotron-3-Nano-30B-A3B',
    modelId: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8',
    description: 'Nemotron-3-Nano Mamba-hybrid MoE (30B total / ~3B active), FP8 variant.',
    context: 262144,
    minVllm: '0.11.2',
    variants: [
      {
        label: 'FP8 + FlashInfer MoE',
        tensorParallelSize: '1',
        args: ['--trust-remote-code', '--async-scheduling', '--kv-cache-dtype', 'fp8'],
        env: [
          { key: 'VLLM_USE_FLASHINFER_MOE_FP8', value: '1' },
          { key: 'VLLM_FLASHINFER_MOE_BACKEND', value: 'throughput' },
        ],
      },
    ],
  },

  // ---- OpenAI ----
  {
    id: 'gpt-oss-120b',
    provider: 'OpenAI',
    name: 'GPT-OSS 120B',
    modelId: 'openai/gpt-oss-120b',
    description: "OpenAI's gpt-oss 120B with MXFP4 MoE, attention-sinks and built-in tools.",
    context: 131072,
    minVllm: '0.10.0',
    variants: [
      { label: 'Standard (MXFP4)', tensorParallelSize: '1', args: [] },
    ],
  },
  {
    id: 'gpt-oss-20b',
    provider: 'OpenAI',
    name: 'GPT-OSS 20B',
    modelId: 'openai/gpt-oss-20b',
    description: "OpenAI's gpt-oss-20b — 21B-total / 3.6B-active MoE reasoning model with native MXFP4.",
    context: 131072,
    minVllm: '0.10.0',
    variants: [
      { label: 'Standard (MXFP4)', tensorParallelSize: '1', args: [] },
    ],
  },

  // ---- Qwen ----
  {
    id: 'qwen3-27b-fp8',
    provider: 'Qwen',
    name: 'Qwen3 27B FP8',
    modelId: 'Qwen/Qwen3.6-27B-FP8',
    description: 'Qwen3 27B FP8 with reasoning parser and MTP speculative decoding.',
    context: 65536,
    minVllm: '0.11.0',
    variants: [
      {
        label: 'FP8 + MTP speculative decoding',
        tensorParallelSize: '1',
        maxModelLen: '65536',
        gpuMemoryUtilization: '0.5',
        served: 'qwen3-27b',
        args: [
          '--max-num-seqs', '6',
          '--reasoning-parser', 'qwen3',
          '--speculative-config', '{"method":"mtp","num_speculative_tokens":4}',
        ],
      },
    ],
  },
];

/** Unique provider list, in catalog order, for the provider dropdown. */
export const VLLM_PROVIDERS: string[] = Array.from(
  new Set(VLLM_PRESETS.map((p) => p.provider)),
);

/** Derive a safe served-model-name / project-name suggestion from a model ID. */
export function deriveServedName(modelId: string): string {
  const base = modelId.split('/').pop() ?? modelId;
  return base.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}
