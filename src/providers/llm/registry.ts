import type { AppConfig, LlmProviderId } from '../../shared/types.js'
import { ClaudeProvider, describeClaudeError } from './claude.js'
import { OpenAiProvider, describeOpenAiError } from './openai.js'
import { OllamaProvider } from './ollama.js'
import { AzureResponsesProvider } from './azure-responses.js'
import { ProviderError, type LlmProvider } from './types.js'

export const LLM_PROVIDERS: { id: LlmProviderId; label: string; needsKey: boolean }[] = [
  { id: 'claude', label: 'Claude', needsKey: true },
  { id: 'openai', label: 'OpenAI', needsKey: true },
  { id: 'azure', label: 'Azure OpenAI', needsKey: true },
  { id: 'ollama', label: 'Ollama (local)', needsKey: false }
]

/** Build the configured provider. Throws ProviderError when it can't be constructed. */
export function createLlmProvider(
  config: AppConfig,
  apiKey: string | null,
  model = config.llm.models[config.llm.provider],
  fetch?: typeof globalThis.fetch
): LlmProvider {
  const id = config.llm.provider
  const opts = {
    apiKey,
    model,
    baseUrl: config.llm.baseUrls[id]
  }
  switch (id) {
    case 'claude':
      return new ClaudeProvider(opts)
    case 'openai':
      return new OpenAiProvider(opts)
    case 'azure':
      return new AzureResponsesProvider({ ...opts, reasoningEffort: 'none', fetch })
    case 'ollama':
      return new OllamaProvider(opts)
    default: {
      const never: never = id
      throw new ProviderError(`Unknown provider "${String(never)}".`)
    }
  }
}

/** Normalise any thrown value into a ProviderError with a showable message. */
export function describeError(id: LlmProviderId, err: unknown): ProviderError {
  if (err instanceof ProviderError) return err
  if (id === 'claude') return describeClaudeError(err)
  if (id === 'openai' || id === 'azure') return describeOpenAiError(err)
  return new ProviderError(err instanceof Error ? err.message : String(err))
}
