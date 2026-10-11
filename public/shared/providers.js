// LLM providers, shared by the server and the browser

export const PROVIDERS = {
  local: {
    label: 'ローカル（OpenAI 互換）',
    defaults: { baseUrl: 'http://localhost:8000/v1', model: '' },
    thinkingParams: ({ enableThinking, reasoningEffort }) => ({
      chat_template_kwargs: { enable_thinking: enableThinking },
      ...(enableThinking && reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    }),
  },
  deepseek: {
    label: 'DeepSeek',
    defaults: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
    // DeepSeek thinks unless told otherwise, so the mode is always sent explicitly.
    thinkingParams: ({ enableThinking, reasoningEffort }) =>
      enableThinking
        ? { thinking: { type: 'enabled' }, ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}) }
        : { thinking: { type: 'disabled' } },
  },
};

export const DEFAULT_PROVIDER = 'local';
