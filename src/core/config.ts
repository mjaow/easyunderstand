/**
 * Config + secret storage. Main-process only (it touches `app` and `safeStorage`).
 *
 * Settings live in plain JSON so they're inspectable and hand-editable. API keys do
 * NOT — they go through Electron's safeStorage, which on Windows means DPAPI, so the
 * ciphertext is bound to the user account and useless if the file is copied elsewhere.
 */
import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { AppConfig, LlmProviderId, SecretId } from '../shared/types.js'
import { DEFAULT_VIDEO_PRESET } from '../shared/presets.js'
import { withVideoDefaults } from './video-config.js'

export const DEFAULT_CONFIG: AppConfig = {
  hotkeys: {
    // Deliberately not anything that shadows Ctrl+C / Ctrl+V / Ctrl+X — see the
    // copy-safety contract.
    //
    // Ctrl+Alt+Space and Ctrl+Alt+R look like the obvious picks but are commonly
    // taken: the first by Chinese/Japanese IMEs, the second by screen recorders and
    // conferencing apps. R is still memorable for refinement; registerHotkeys()
    // gives each action a separate fallback if its preferred key is unavailable.
    // CommandOrControl rather than Control: one stored shortcut is then correct on
    // Windows (Ctrl) and macOS (Cmd) alike, instead of being tied to where it was set.
    explain: 'CommandOrControl+Alt+E',
    refine: 'CommandOrControl+Alt+R'
  },
  doubleClickTranscripts: true,
  unverifiedPronunciations: false,
  llm: {
    provider: 'claude',
    // Model ids are complete as-is — never append a date suffix.
    //
    // These are the cheap-but-good picks for each provider, because the work is
    // short dictionary-style lookups where a flagship model earns little. Settings
    // lists pricier options, and Quick setup switches all three fields at once.
    models: {
      claude: 'claude-haiku-4-5',
      openai: 'qwen-flash',
      azure: 'gpt-6-luna',
      ollama: 'qwen2.5:3b'
    },
    // Note the differing conventions: the Anthropic SDK appends /v1/messages to its
    // base URL, while the OpenAI SDK appends /chat/completions — so the OpenAI one
    // must already include /v1 or every request 404s.
    baseUrls: {
      claude: 'https://api.anthropic.com',
      openai: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      azure: 'https://YOUR-RESOURCE-NAME.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview',
      ollama: 'http://localhost:11434'
    },
    codeModel: '',
    videoProvider: DEFAULT_VIDEO_PRESET.provider,
    videoBaseUrl: DEFAULT_VIDEO_PRESET.baseUrl,
    videoModel: DEFAULT_VIDEO_PRESET.model
  },
  tts: {
    // Online by default: the Windows voices are noticeably robotic, and hearing a
    // natural American accent is the point of read-aloud for a learner.
    provider: 'online',
    systemVoice: '',
    azureRegion: 'eastus',
    azureVoice: 'en-US-AvaMultilingualNeural',
    slowRate: -40,
    autoPlay: false
  },
  launchAtLogin: false
}

let cached: AppConfig | null = null

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

function secretsPath(): string {
  return join(app.getPath('userData'), 'secrets.json')
}

function ensureDir(file: string): void {
  const dir = dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

/** Merge stored values over defaults, one level deep per section. */
function merge(stored: unknown): AppConfig {
  const s = (stored ?? {}) as Partial<AppConfig>
  return {
    hotkeys: { ...DEFAULT_CONFIG.hotkeys, ...s.hotkeys },
    doubleClickTranscripts: s.doubleClickTranscripts ?? DEFAULT_CONFIG.doubleClickTranscripts,
    unverifiedPronunciations: s.unverifiedPronunciations ?? DEFAULT_CONFIG.unverifiedPronunciations,
    llm: withVideoDefaults({
      ...DEFAULT_CONFIG.llm,
      ...s.llm,
      models: { ...DEFAULT_CONFIG.llm.models, ...s.llm?.models },
      baseUrls: { ...DEFAULT_CONFIG.llm.baseUrls, ...s.llm?.baseUrls },
      codeModel: s.llm?.codeModel ?? '',
      // Old files lack video fields or store an empty optional override.
      // Never accidentally apply an old model ID to the new Google endpoint.
      videoProvider: s.llm?.videoProvider,
      videoBaseUrl: s.llm?.videoBaseUrl,
      videoModel: s.llm?.videoModel ?? ''
    }),
    tts: { ...DEFAULT_CONFIG.tts, ...s.tts },
    launchAtLogin: s.launchAtLogin ?? DEFAULT_CONFIG.launchAtLogin
  }
}

export function loadConfig(): AppConfig {
  if (cached) return cached
  try {
    const file = configPath()
    cached = existsSync(file) ? merge(JSON.parse(readFileSync(file, 'utf8'))) : { ...DEFAULT_CONFIG }
  } catch (err) {
    // A corrupt config shouldn't stop the app booting — fall back to defaults and
    // let the user fix it in settings.
    console.error('[config] unreadable, using defaults:', err)
    cached = { ...DEFAULT_CONFIG }
  }
  return cached
}

export function saveConfig(patch: Partial<AppConfig>): AppConfig {
  const next = merge({ ...loadConfig(), ...patch })
  cached = next
  try {
    const file = configPath()
    ensureDir(file)
    writeFileSync(file, JSON.stringify(next, null, 2), 'utf8')
  } catch (err) {
    console.error('[config] save failed:', err)
  }
  return next
}

// ------------------------------------------------------------------ secrets

type SecretStore = Record<string, string>

function readSecrets(): SecretStore {
  try {
    const file = secretsPath()
    if (!existsSync(file)) return {}
    return JSON.parse(readFileSync(file, 'utf8')) as SecretStore
  } catch {
    return {}
  }
}

function writeSecrets(store: SecretStore): void {
  const file = secretsPath()
  ensureDir(file)
  writeFileSync(file, JSON.stringify(store, null, 2), 'utf8')
}

/**
 * Store an API key encrypted at rest.
 *
 * If the OS can't provide encryption we refuse rather than silently writing the key
 * in plaintext — a user who typed a key into a settings box has a reasonable
 * expectation it isn't sitting readable on disk.
 */
export function setSecret(provider: SecretId, value: string): { ok: boolean; error?: string } {
  const store = readSecrets()
  if (!value) {
    delete store[provider]
    writeSecrets(store)
    return { ok: true }
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: 'OS encryption unavailable; refusing to store the key in plaintext.' }
  }
  try {
    store[provider] = safeStorage.encryptString(value).toString('base64')
    writeSecrets(store)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function getSecret(provider: SecretId): string | null {
  // Env vars win, so power users can run without ever typing a key into the UI.
  const fromEnv =
    provider === 'claude'
      ? process.env.ANTHROPIC_API_KEY
      : provider === 'video'
        ? process.env.EASYTRANSLATE_VIDEO_API_KEY
      : provider === 'openai' || provider === 'tts'
        ? process.env.OPENAI_API_KEY
        : undefined
  if (fromEnv) return fromEnv

  const raw = readSecrets()[provider]
  if (!raw) return null
  try {
    return safeStorage.decryptString(Buffer.from(raw, 'base64'))
  } catch (err) {
    console.error(`[config] could not decrypt ${provider} key:`, err)
    return null
  }
}

/** Unused import guard — LlmProviderId still names the LLM half of the id space. */
export type { LlmProviderId }

export function hasSecret(provider: SecretId): boolean {
  return getSecret(provider) !== null
}

/** Test seam: drop the in-memory cache so the next load re-reads disk. */
export function __resetCache(): void {
  cached = null
}
