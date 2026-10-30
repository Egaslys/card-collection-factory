// Default values of the Codex CLI image provider (codex-cli.js). Kept in its own module because
// defaults.js is being replaced by the settings file; when that exists, these move there too.

/** @type {{command: string, timeoutMs: number, reasoningEffort: string, sandbox: string, model: string|null, promptTemplate: string}} */
export const CODEX_DEFAULTS = {
  command: 'codex',
  // Observed generation time is 30-75 s; the limit only catches a hung process.
  timeoutMs: 600000,
  // The orchestrating model only has to call the image tool once, so low effort is enough.
  reasoningEffort: 'low',
  // The image tool needs no file or network access from the shell sandbox.
  sandbox: 'read-only',
  // null: use the model from the user's Codex config (the image itself is drawn by Codex's built-in image tool).
  model: null,
  // {refs} is the legend of attached images (empty without references), {brief} is the caller's prompt.
  promptTemplate: 'Use your image generation tool exactly once to create one image from the brief below, then reply with the single word DONE. Do not run shell commands or edit files.\n{refs}\nBRIEF: {brief}\n',
};
