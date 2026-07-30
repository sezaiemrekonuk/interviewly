# Voice — Recommended Model Per Task

Voice is the project's widest trust boundary (a browser talking to a third party, that party
calling us back). Every task that authenticates a webhook, guarantees the fallback, or reconciles
money runs at the expensive tier. Only the mint-endpoint wiring and the `VoiceSession` driver
scaffold — plumbing over an existing ownership check and an existing state read — runs at the
moderate tier.

| ID | Title | Model | Why |
|----|-------|-------|-----|
| V01 | `VoiceSession` seam, `FakeVoiceSession`, and the session-mint endpoint | `claude-sonnet-4.6` | Mint-endpoint wiring + driver scaffold over the existing I03 ownership check and I07 state read; the ceiling arithmetic is mechanical and the token is opaque. No new trust boundary is crossed here — the webhook (V02) is |
| V02 | ElevenLabs webhook authentication: the four gates + submit_answer/next_question/end_round + log redaction | `claude-opus-4.8` | The **new** trust boundary — HMAC signature, freshness/timestamp window, nonce replay defence, legality+expiry — plus secret redaction. A gate ordering slip or a non-constant-time compare is a forged-webhook hole invisible to a green happy-path test |
| V03 | Voice → text downgrade on a fatal voice failure | `claude-opus-4.8` | Fallback correctness is the mandatory-requirement invariant (§3.2/§3.8): losing an answer or leaving `mode` able to return to `voice` is a data-integrity defect the stub cannot surface |
| V04 | Post-call usage reconciliation worker job (idempotent `spent_usd` + `llm_calls` transaction) | `claude-opus-4.8` | The reconciliation transaction is the cost invariant (§7.3, K13): a non-atomic write or a non-idempotent redelivery double-charges or splits `spent_usd` from its `llm_calls` row — both subtle |

## Summary

- **`claude-opus-4.8` (3 tasks):** V02, V03, V04
- **`claude-sonnet-4.6` (1 task):** V01

Rule of thumb: **webhook authentication + fallback guarantee + money reconciliation = expensive
tier; endpoint wiring + driver scaffold over an existing check = moderate.** When unsure on V01 if
the ceiling arithmetic or the state-legality check turns subtle, run it sonnet then code-review the
diff with `claude-opus-4.8` — cheaper than running the whole task expensive. Never use haiku, mini,
or flash for any voice task — the webhook is the widest attack surface in the system.
