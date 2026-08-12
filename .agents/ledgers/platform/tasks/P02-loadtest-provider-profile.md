# P02 — The load-test provider profile: fake speech at real latency, and a guard that cannot be quiet
REPO: (this repo) · Depends: — · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-5** — the one task here that can be wrong without anything going red. A fake
speech provider reaching a production boot transcribes nothing, scores nobody, and looks entirely
normal.

## Goal
Owner's ask:

> If I want to deploy my system in fly and use also kuberneets and with fake routing show my
> scale level and note it in docs what would i need

The routing under load is real; the providers are not (ADR-P07). This task makes the speech
provider selectable at boot, gives both stubs the latency the real providers have, and puts a guard
around the whole thing that a misconfigured deploy cannot walk past quietly.

P03 consumes this. Nothing else in the ledger touches application code.

## Non-negotiables
- **Fakes are all-or-nothing.** Boot must **refuse** when the fake speech provider is selected
  unless the LLM is stubbed too (`AI_ENABLED=false`) *and* `LOADTEST=1` is set. The forbidden
  configuration is fake STT with a live LLM: that produces a real, scored, billed report about
  answers the candidate never gave. Nothing downstream can detect it — the transcript is
  well-formed, the score is plausible, the PDF renders.
- **The refusal is a boot failure, not a warning.** `backend/src/lib/env.ts` already exits the
  process on invalid config, and the check belongs in the same `superRefine` as the existing
  `AI_ENABLED` rule — not in a route, not in a middleware.
- **Log the selected speech provider at startup unconditionally**, on both the fake and the live
  path. The failure mode this guards is "nobody knew which one was running".
- **There is no override flag.** The acceptance suite has `ACCEPTANCE_ALLOW_DESTRUCTIVE_DB=1`
  because a human sometimes genuinely means to truncate their own database. Nobody ever genuinely
  means to interview a real candidate with a fake transcriber, so this one has no escape hatch to
  find later.
- **Latency is injected, not omitted.** A stub returning instantly makes a live-interview VU cycle
  with no think time, and the streams that determine concurrency are exactly the ones held open for
  seconds. An instant-stub run reports a concurrency the real system will never see.
- **Do not touch `ElevenLabsSpeech` or `StubAiClient`'s behaviour.** This task adds a selection
  path and a delay; the providers themselves are unchanged.

## Context (anchors)
- `backend/modules/speech/SpeechProvider.ts`
  - `:21` `export let speechProvider = new ElevenLabsSpeech(...)` — built at import time.
  - `:27` `setSpeechProvider(next)` — **the seam already exists.** The acceptance ring calls it
    from a `Before` hook; no production path ever does. You are adding the first boot-time caller,
    not a new mechanism.
- `backend/modules/speech/fake-speech.ts:8` `FakeSpeechProvider` — implements the interface, used
  today only by `features/step_definitions/speech*.ts` and `speech.test.ts`.
- `backend/src/lib/env.ts` — the zod config with a `superRefine`; the existing rule requiring
  `ELEVENLABS_API_KEY` under `AI_ENABLED=true` is the pattern to follow, and the comment at
  `SpeechProvider.ts:18` explains why the key is optional in stub mode.
- `packages/ai/src/resolve-client.ts:38` — `if (config.AI_ENABLED) return new LiveAiClient(...)`,
  else `StubRecordingClient(new StubAiClient(...))`. The LLM half of the switch already exists and
  still writes audit rows (`:100`).
- `packages/ai/src/stub.ts` — the LLM stub. No delay anywhere in it.
- `.agents/ledgers/speech-latency/REFERENCE.md` — the measured warm medians to inject: STT ~1 650
  ms, conductor ~1 180 ms, TTS ~430 ms (`eleven_turbo_v2_5`, since L01). Use these numbers, do not
  invent round ones.
- `.env.example` — where the new keys are documented, in the same commented style as its
  neighbours.

## Steps
- [ ] Add to `backend/src/lib/env.ts`: `SPEECH_PROVIDER` (`'elevenlabs' | 'fake'`, default
      `'elevenlabs'`), `LOADTEST` (boolean, default false), and `FAKE_SPEECH_TTS_MS` /
      `FAKE_SPEECH_STT_MS` (defaults 430 / 1650).
- [ ] Add the `superRefine` rule: `SPEECH_PROVIDER === 'fake'` is invalid unless
      `AI_ENABLED === false` **and** `LOADTEST === true`. The message must name all three keys and
      say why — a future reader hitting this at 2am should not have to find this file.
- [ ] Add the equivalent latency knob for the LLM stub (`STUB_AI_LATENCY_MS`, default 1180) and
      apply it inside `StubAiClient` so `StubRecordingClient`'s audit row still wraps it.
- [ ] Apply the delays in `FakeSpeechProvider` (`speak` → `FAKE_SPEECH_TTS_MS`, `transcribe` →
      `FAKE_SPEECH_STT_MS`), taking the values by constructor argument rather than importing
      `config` — it is used by unit tests that must stay instant.
- [ ] Call `setSpeechProvider(new FakeSpeechProvider(...))` once at boot when
      `SPEECH_PROVIDER === 'fake'`, and log the selected provider name in both branches.
- [ ] Document all five keys in `.env.example`, together, with a comment stating the all-or-nothing
      rule.
- [ ] Tests: (1) a `fake` + `AI_ENABLED=true` config **fails validation** — the negative case that
      proves the guard is what refuses, and it must be red before the `superRefine` is written;
      (2) `fake` + `AI_ENABLED=false` + `LOADTEST=1` validates; (3) the default config still
      selects `ElevenLabsSpeech`; (4) `FakeSpeechProvider` constructed with a delay takes at least
      that long, constructed without one stays instant.

## Definition of done
- A process booted with `SPEECH_PROVIDER=fake` and a live `AI_ENABLED=true` **exits non-zero** with
  a message naming `SPEECH_PROVIDER`, `AI_ENABLED` and `LOADTEST`.
- A process booted with all three set for load testing serves an interview end to end, taking
  roughly the real turn latency and spending nothing at either provider.
- A process booted with none of them set behaves exactly as `master` does today, and logs which
  speech provider it selected.
- `npm run test:acceptance` is unaffected — the ring's own `Before` hook still swaps the provider,
  and it does not go through the new env path.

## Verification
```bash
npm run lint && npm run typecheck && npm test
npm run test:acceptance
```

Then live — the guard, which is the point of the task:

```bash
docker compose up -d
docker compose exec -e SPEECH_PROVIDER=fake -e AI_ENABLED=true api node backend/dist/src/index.js; echo "exit=$?"
```

Expect a non-zero exit and a message naming all three keys. Then the permitted combination:

```bash
docker compose exec -e SPEECH_PROVIDER=fake -e AI_ENABLED=false -e LOADTEST=1 \
  api node -e "require('./backend/dist/src/lib/env.js'); console.log('booted')"
```

Expect `booted` and a log line naming the fake provider. Cleanup: `docker compose down`.

## Notes
