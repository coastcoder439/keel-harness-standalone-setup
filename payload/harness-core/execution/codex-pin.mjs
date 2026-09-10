// Named, maintainable source of truth for the delegated-Codex model/effort pin.
//
// Owner and follow-up duty (audit follow-up 373, 09.09.2026): this pin is not a
// silent constant. Its owner is the Codex/provider wave of the package
// new-harness-audit-followup; the follow-up trigger is any change OpenAI makes to
// the Codex model id or the reasoning-effort scale (gpt-5.6-sol deprecated, or the
// "max" step renamed/removed). Such a change surfaces at runtime as
// CODEX_PLUGIN_MAX_UNSUPPORTED (see routeFailure in codex-plugin-bootstrap.mjs).
//
// On that trigger this file and its per-installation twin .codex/config.toml
// (model = "…", model_reasoning_effort = "…") are updated together — the config
// file is the value the Codex CLI actually reads, this module is the single value
// the execution code (provider-runtime.mjs, codex-plugin-bootstrap.mjs) binds to
// instead of duplicating the literal.
export const CODEX_MODEL = "gpt-5.6-sol";
export const CODEX_EFFORT = "max";
