// Default provider values. This is the ONE place for them until the settings file is
// designed; the settings will replace this object and the callers will read from there.
// The functions in openrouter.js take every value from their arguments and have no defaults.

/** @type {{endpoint: string, model: string, aspectRatio: string, resolution: string, keyEnvVar: string, timeoutMs: number, retries: number, backoffMs: number}} */
export const PROVIDER_DEFAULTS = {
  endpoint: 'https://openrouter.ai/api/v1',
  model: 'google/gemini-nano-banana-2.1',
  aspectRatio: '4:5',
  resolution: '1K',
  keyEnvVar: 'OPENROUTER_API_KEY',
  timeoutMs: 600000,
  retries: 2,
  backoffMs: 2000,
};
