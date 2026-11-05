// LLM providers, shared by the server and the browser
// format names how a request is built: 'instruct' (system prompt + thinkingParams) or 'plamo' (PLaMo 3 Translate's chat template).

export const PROVIDERS = {
  local: {
    label: 'ローカル（OpenAI 互換）',
    defaults: { baseUrl: 'http://localhost:8000/v1', model: '' },
    format: 'instruct',
    thinkingParams: ({ enableThinking, reasoningEffort }) => ({
      chat_template_kwargs: { enable_thinking: enableThinking },
      ...(enableThinking && reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    }),
  },
  deepseek: {
    label: 'DeepSeek',
    defaults: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
    format: 'instruct',
    // DeepSeek thinks unless told otherwise, so the mode is always sent explicitly.
    thinkingParams: ({ enableThinking, reasoningEffort }) =>
      enableThinking
        ? { thinking: { type: 'enabled' }, ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}) }
        : { thinking: { type: 'disabled' } },
  },
  plamo: {
    label: 'PLaMo 3 Translate',
    defaults: { baseUrl: 'http://localhost:8890/v1', model: '' },
    format: 'plamo',
  },
};

export const DEFAULT_PROVIDER = 'local';
