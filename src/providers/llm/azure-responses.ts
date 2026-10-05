import { AzureOpenAI } from 'openai'
import type { ExplainRequest, VideoReasoningEffort } from '../../shared/types.js'
import { outputBudget, systemPrompt, userPrompt } from '../../core/explain.js'
import { OutputLimitError, ProviderError, SELECT_LESS, type GenerationRequest, type LlmProvider, type ProviderOptions } from './types.js'

export function parseAzureResponsesEndpoint(value: string): { baseURL: string; apiVersion: string } {
  let url: URL
  try { url = new URL(value) } catch {
    throw new ProviderError('Enter the full Azure Responses endpoint, including ?api-version=… in the Azure provider settings.')
  }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) ||
      url.username || url.password || url.hash || url.pathname.replace(/\/$/, '') !== '/openai/responses') {
    throw new ProviderError('Use an Azure Responses URL ending in /openai/responses?api-version=…. The resource root or Chat Completions URL is not sufficient.')
  }
  const versions = url.searchParams.getAll('api-version')
  if (versions.length !== 1 || !/^\d{4}-\d{2}-\d{2}(?:-preview)?$/.test(versions[0]) ||
      [...url.searchParams.keys()].some(key => key !== 'api-version')) {
    throw new ProviderError('The Azure Responses endpoint needs exactly one api-version, for example 2025-04-01-preview.')
  }
  return { baseURL: `${url.origin}/openai`, apiVersion: versions[0] }
}

/** The Azure SDK supplies api-key authentication and preserves the API version. */
export class AzureResponsesProvider implements LlmProvider {
  readonly id = 'azure' as const
  readonly label = 'Azure OpenAI'
  private readonly client: AzureOpenAI

  constructor(private readonly opts: ProviderOptions & { reasoningEffort?: VideoReasoningEffort; fetch?: typeof globalThis.fetch }) {
    const endpoint = parseAzureResponsesEndpoint(opts.baseUrl ?? '')
    if (!opts.apiKey) throw new ProviderError('No Azure API key is saved.', 'Add the resource key in the settings for this Azure provider.')
    this.client = new AzureOpenAI({ ...endpoint, apiKey: opts.apiKey,
      organization: null, project: null, maxRetries: 0, timeout: 60000, fetch: opts.fetch })
  }

  async ping(signal: AbortSignal): Promise<void> {
    for await (const _text of this.generate({ system: 'Reply with JSON only.', user: 'Return {"ok":true}.', maxTokens: 1200, json: true }, signal)) { /* read to completion */ }
  }

  async *explain(req: ExplainRequest, signal: AbortSignal): AsyncIterable<string> {
    // A short non-reasoning edit/translation already has ample output room.
    // Reserve extra tokens for reasoning, code, and longer selections as before.
    const shortText = req.mode !== 'code' && (req.raw ?? req.text).length < 1000
    const extra = this.opts.reasoningEffort === 'none' && shortText ? 0 : 2000
    yield* this.generate({ system: systemPrompt(req.mode), user: userPrompt(req), maxTokens: outputBudget(req) + extra }, signal)
  }

  async *generate(req: GenerationRequest, signal: AbortSignal): AsyncIterable<string> {
    const stream = await this.client.responses.create({
      model: this.opts.model, // Azure expects the deployment name in this field.
      instructions: req.system,
      // Azure checks input messages for JSON mode; instructions alone do not count.
      input: req.json ? `Return only a valid JSON object.\n\n${req.user}` : req.user,
      max_output_tokens: req.maxTokens,
      reasoning: { effort: this.opts.reasoningEffort ?? 'low' },
      ...(req.json ? { text: { format: { type: 'json_object' as const } } } : {}),
      stream: true,
      store: false
    }, { signal })
    for await (const event of stream) {
      signal.throwIfAborted()
      if (event.type === 'response.output_text.delta') yield event.delta
      if (event.type === 'response.refusal.delta' || event.type === 'response.refusal.done') {
        throw new ProviderError('Azure declined this content. No complete analysis was generated.')
      }
      if (event.type === 'response.failed') {
        throw new ProviderError('Azure could not complete the response.', event.response.error?.message ?? 'Check the deployment in Azure and retry.')
      }
      if (event.type === 'response.incomplete') {
        const reason = event.response.incomplete_details?.reason
        if (reason === 'max_output_tokens') {
          throw new OutputLimitError(
            'Azure reached the response token limit, which counts its reasoning tokens too.',
            SELECT_LESS
          )
        }
        throw new ProviderError(reason === 'content_filter'
          ? 'Azure declined this content. No complete analysis was generated.'
          : 'Azure returned an incomplete response. No complete analysis was generated.')
      }
      if (event.type === 'error') throw new ProviderError('Azure response error.', event.message)
      // This event confirms the complete answer. Waiting for the HTTP connection
      // to close can leave Copy disabled even though generation has finished.
      if (event.type === 'response.completed') return
    }
    signal.throwIfAborted()
    throw new ProviderError('The Azure response stream ended before completion. Please retry.')
  }
}
