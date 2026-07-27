(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.DPRLLMConfigUtils = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
  const DEFAULT_DEEPSEEK_CHAT_MODELS = [
    'deepseek-v4-flash',
    'deepseek-v4-pro',
  ];
  const DEFAULT_DASHSCOPE_BASE_URL =
    'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const DEFAULT_DASHSCOPE_CHAT_MODELS = [
    'qwen-plus',
    'qwen-turbo',
    'qwen-max',
    'qwen3-max',
  ];
  const DEEPSEEK_V4_MAX_OUTPUT_TOKENS = 393216;
  const LLM_PRESETS = Object.freeze({
    deepseek: Object.freeze({
      key: 'deepseek',
      label: 'DeepSeek 官方',
      baseUrl: DEFAULT_DEEPSEEK_BASE_URL,
      models: Object.freeze([...DEFAULT_DEEPSEEK_CHAT_MODELS]),
      baseUrlEditable: false,
    }),
    dashscope: Object.freeze({
      key: 'dashscope',
      label: '阿里云 DashScope',
      baseUrl: DEFAULT_DASHSCOPE_BASE_URL,
      models: Object.freeze([...DEFAULT_DASHSCOPE_CHAT_MODELS]),
      baseUrlEditable: true,
    }),
    custom: Object.freeze({
      key: 'custom',
      label: '自定义 OpenAI 兼容',
      baseUrl: '',
      models: Object.freeze([]),
      baseUrlEditable: true,
    }),
  });
  // Backward-compatible alias used by older callers / tests.
  const DEEPSEEK_PRESETS = Object.freeze({
    deepseek: LLM_PRESETS.deepseek,
  });

  const normalizeText = (value) => String(value || '').trim();

  const normalizeBaseUrlForStorage = (value) => {
    let text = normalizeText(value).replace(/\/+$/g, '');
    if (!text) return '';
    text = text.replace(/\/chat\/completions$/i, '');
    return text.replace(/\/+$/g, '');
  };

  const buildChatCompletionsEndpoint = (value) => {
    const raw = normalizeText(value).replace(/\/+$/g, '');
    if (!raw) return '';
    if (/\/chat\/completions$/i.test(raw)) return raw;
    const normalized = normalizeBaseUrlForStorage(raw);
    if (!normalized) return '';
    if (/\/v\d+$/i.test(normalized)) {
      return `${normalized}/chat/completions`;
    }
    return `${normalized}/v1/chat/completions`;
  };

  const sanitizeModelList = (values, maxCount = 3) => {
    const rawList = Array.isArray(values) ? values : [values];
    const out = [];
    const seen = new Set();
    for (const value of rawList) {
      const parts = String(value || '')
        .split(/[\n,]+/)
        .map((item) => normalizeText(item))
        .filter(Boolean);
      for (const name of parts) {
        const key = name.toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(name);
        if (out.length >= Math.max(Number(maxCount) || 0, 1)) {
          return out;
        }
      }
    }
    return out;
  };

  const resolveChatModels = (secret) => {
    const safeSecret = secret && typeof secret === 'object' ? secret : {};
    const chatList = Array.isArray(safeSecret.chatLLMs) ? safeSecret.chatLLMs : [];
    const models = [];
    const seen = new Set();
    chatList.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const baseUrl = normalizeBaseUrlForStorage(item.baseUrl || '');
      const apiKey = normalizeText(item.apiKey || '');
      const modelNames = sanitizeModelList(item.models || [], 99);
      if (!baseUrl || !apiKey || !modelNames.length) return;
      modelNames.forEach((name) => {
        const dedupeKey = `${name.toLowerCase()}\u0000${baseUrl}\u0000${apiKey}`;
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        models.push({
          name,
          apiKey,
          baseUrl,
        });
      });
    });
    return models;
  };

  const resolveSummaryLLM = (secret) => {
    const safeSecret = secret && typeof secret === 'object' ? secret : {};
    const summarized = safeSecret.summarizedLLM || {};
    const baseUrl = normalizeBaseUrlForStorage(summarized.baseUrl || '');
    const apiKey = normalizeText(summarized.apiKey || '');
    const model = normalizeText(summarized.model || '');
    if (baseUrl && apiKey && model) {
      return { baseUrl, apiKey, model };
    }

    const chatModels = resolveChatModels(safeSecret);
    if (!chatModels.length) return null;
    return {
      baseUrl: normalizeBaseUrlForStorage(chatModels[0].baseUrl || ''),
      apiKey: normalizeText(chatModels[0].apiKey || ''),
      model: normalizeText(chatModels[0].name || ''),
    };
  };

  const isDashScopeBaseUrl = (baseUrl) => {
    const normalized = normalizeBaseUrlForStorage(baseUrl || '').toLowerCase();
    return (
      /dashscope\.aliyuncs\.com/i.test(normalized)
      || /dashscope-intl\.aliyuncs\.com/i.test(normalized)
      || /compatible-mode/i.test(normalized)
    );
  };

  const isDeepSeekBaseUrl = (baseUrl) => {
    const normalized = normalizeBaseUrlForStorage(baseUrl || '').toLowerCase();
    return /(^|\/\/)(api\.)?deepseek\.com(?:$|\/)/i.test(normalized);
  };

  const inferProviderTypeFromBaseUrl = (baseUrl, model) => {
    if (isDeepSeekBaseUrl(baseUrl) || normalizeText(model).toLowerCase().startsWith('deepseek-')) {
      return 'deepseek';
    }
    if (isDashScopeBaseUrl(baseUrl) || /^qwen[\w.-]*$/i.test(normalizeText(model))) {
      return 'dashscope';
    }
    if (normalizeBaseUrlForStorage(baseUrl || '')) {
      return 'custom';
    }
    return 'deepseek';
  };

  const inferProviderType = (secret) => {
    const safeSecret = secret && typeof secret === 'object' ? secret : {};
    const llmProvider = safeSecret.llmProvider || {};
    const explicit = normalizeText(llmProvider.type || llmProvider.provider || '').toLowerCase();
    if (explicit === 'deepseek' || explicit === 'dashscope' || explicit === 'custom') {
      return explicit;
    }
    const summary = resolveSummaryLLM(safeSecret) || {};
    return inferProviderTypeFromBaseUrl(summary.baseUrl, summary.model);
  };

  const getLLMPreset = (key) => {
    const presetKey = normalizeText(key).toLowerCase();
    const preset = LLM_PRESETS[presetKey];
    if (!preset) return null;
    return {
      key: preset.key,
      label: preset.label,
      baseUrl: preset.baseUrl,
      models: [...preset.models],
      baseUrlEditable: !!preset.baseUrlEditable,
    };
  };

  const getDeepSeekPreset = (key) => {
    const preset = getLLMPreset(key);
    if (!preset || preset.key !== 'deepseek') return null;
    return {
      key: preset.key,
      label: preset.label,
      baseUrl: preset.baseUrl,
      models: preset.models,
    };
  };

  const inferChatApiProfile = (baseUrl, model) => {
    const normalizedModel = normalizeText(model || '').toLowerCase();
    if (isDeepSeekBaseUrl(baseUrl) || normalizedModel.startsWith('deepseek-')) {
      return 'deepseek';
    }
    if (isDashScopeBaseUrl(baseUrl) || /^qwen[\w.-]*$/i.test(normalizedModel)) {
      return 'openai_compatible';
    }
    if (normalizeBaseUrlForStorage(baseUrl || '')) {
      return 'openai_compatible';
    }
    return 'unsupported';
  };

  const resolveJsonResponseMode = ({ baseUrl, model, preferSchema = true }) => {
    return 'json_object';
  };

  const isDeepSeekV4Model = (model) => {
    const normalizedModel = normalizeText(model || '').toLowerCase();
    return normalizedModel === 'deepseek-v4-flash' || normalizedModel === 'deepseek-v4-pro';
  };

  const resolveMaxOutputTokens = ({ baseUrl, model } = {}) => {
    const profile = inferChatApiProfile(baseUrl, model);
    if (profile === 'deepseek' && isDeepSeekV4Model(model)) {
      return DEEPSEEK_V4_MAX_OUTPUT_TOKENS;
    }
    return null;
  };

  const shouldUseXApiKeyHeader = ({ baseUrl, model }) => {
    return true;
  };

  const buildStreamingChatPayload = ({ baseUrl, model, messages }) => {
    const payload = {
      model: normalizeText(model),
      messages: Array.isArray(messages) ? messages : [],
      stream: true,
    };
    const maxTokens = resolveMaxOutputTokens({ baseUrl, model });
    if (maxTokens) {
      payload.max_tokens = maxTokens;
    }
    return payload;
  };

  const buildConnectivityTestPayload = ({ baseUrl, model }) => {
    const normalizedModel = normalizeText(model);
    return {
      model: normalizedModel,
      messages: [
        {
          role: 'system',
          content: 'Reply with exactly: hello world',
        },
        {
          role: 'user',
          content: 'hello world',
        },
      ],
      temperature: 0,
      max_tokens: 256,
    };
  };

  return {
    DEFAULT_DEEPSEEK_BASE_URL,
    DEFAULT_DEEPSEEK_CHAT_MODELS,
    DEFAULT_DASHSCOPE_BASE_URL,
    DEFAULT_DASHSCOPE_CHAT_MODELS,
    DEEPSEEK_PRESETS,
    LLM_PRESETS,
    normalizeText,
    normalizeBaseUrlForStorage,
    buildChatCompletionsEndpoint,
    sanitizeModelList,
    resolveChatModels,
    resolveSummaryLLM,
    inferProviderType,
    inferProviderTypeFromBaseUrl,
    isDashScopeBaseUrl,
    isDeepSeekBaseUrl,
    getLLMPreset,
    getDeepSeekPreset,
    inferChatApiProfile,
    resolveJsonResponseMode,
    isDeepSeekV4Model,
    resolveMaxOutputTokens,
    shouldUseXApiKeyHeader,
    buildStreamingChatPayload,
    buildConnectivityTestPayload,
  };
});
