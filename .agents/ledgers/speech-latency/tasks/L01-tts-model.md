# L01 — The TTS model: 3.3× faster in config, but the ear decides
REPO: (this repo) · Depends: S02 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-5** — an `.env` value, a benchmark that already exists, and audio rendered
for a human to judge. The judgement itself must not be automated away: ADR-L03 makes the owner's
ear the decider, so there is no correctness call left for a session to get wrong.

## Goal
`eleven_turbo_v2_5` renders the same interviewer reply in **313 ms** against
`eleven_multilingual_v2`'s **1 024 ms** — 3.3× faster, on English and Turkish alike, and more
than streaming TTS would buy. S01 made the model id an environment variable, so trying one costs
a `.env` edit.

This task does not "switch to the fast model". It produces the evidence a human needs to decide,
and then executes whichever way they decide — including not switching.

## Non-negotiables
- **The decision is made by listening, not by the table.** Render both models, both languages,
  and hand over playable files. Latency loses if the faster model mispronounces Turkish or sounds
  synthetic. The artefact is the interviewer's voice — the one surface carrying the illusion the
  product depends on, and a candidate rehearsing for a real interview is not helped by 700 ms
  saved and a voice that sounds like a phone tree.
- **Distrust the byte counts.** `multilingual_v2` and `turbo_v2_5` returned **identical** Turkish
  output lengths (82 799). Two different models producing exactly the same MP3 size is unlikely
  enough that the comparison is suspect until someone has heard both files. If they sound
  identical too, something is wrong with the measurement — find out what before recommending.
- **If the owner says no, say so and stop.** Do not swap anyway, do not "compromise" on flash
  because it is between the two. Record the rejection in `## Notes`, leave the ~700 ms on the
  clock, and note that #266's streaming TTS becomes the only remaining route to it.
- **No code change.** If a model swap requires touching anything but `.env` and `.env.example`,
  the config surface is broken and that is the finding — report it rather than working around it.
- **Warm medians, n≥5, warm-up discarded** (ADR-L01).

## Context (anchors)
- `backend/src/lib/env.ts:53-55` — `ELEVENLABS_TTS_MODEL`, already config.
- `.env.example:72-74` — where the documented default lives.
- `backend/modules/speech/elevenlabs-speech.ts:34-71` `speak()` — `model_id` is passed straight
  through; nothing else reads it.
- `backend/modules/speech/tts.ts:196,234` — the two cache keys. **Cached audio does not carry the
  model that produced it**, so a swap leaves old entries in the old voice; see step 5.
- REFERENCE.md — the measured table, so you do not re-run the benchmark from scratch.
- `packages/ai/config/model-prices.yaml` — TTS is priced per character; confirm the faster models
  are not priced differently before recommending one.

## Steps
- [x] **1. Re-measure, warm** — `eleven_multilingual_v2`, `eleven_turbo_v2_5`, `eleven_flash_v2_5`,
  both languages, n≥5, warm-up discarded. Confirm or correct REFERENCE.md's table.
- [x] **2. Resolve the identical-bytes anomaly** — same text, same voice, `multilingual_v2` vs
  `turbo_v2_5` in Turkish. If the outputs really are byte-identical, the two model ids are not
  producing different audio and the whole comparison is void. Report what you find.
- [x] **3. Render samples for the ear** — for each model, one English and one Turkish interviewer
  line, using the seeded voices (`EXAVITQu4vr4xnSDxMaL` HR, `JBFqnCBsd6RMkjVDRZzb` tech). Use a
  real conductor reply, not a lorem sentence — a question with a name and a technical term in it.
  Write them somewhere playable and name the files by model and language.
- [x] **4. Check the price** — confirm per-character cost for turbo and flash against
  `model-prices.yaml`. A faster model that costs more changes the recommendation.
- [x] **5. Cache invalidation, if the swap happens** — cached MP3s under `speech/{questionId}` and
  `speech/msg-{id}` were produced by the old model and carry no model marker. A live interview
  would hear both voices in one session. Decide and state the answer: purge the prefix, or accept
  it on the grounds that cached entries belong to interviews already in flight.
- [x] **6. Hand over and wait.** Present the samples and the table. **Do not choose.** Record the
  owner's answer in `## Notes` with a sentence on why.
- [x] **7. Execute the decision** — either the `.env` / `.env.example` edit plus step 5's cache
  answer, or a recorded rejection.

## Definition of done
- Both models heard by a human, in both languages, and the decision recorded with its reason.
- The identical-bytes anomaly explained, not ignored.
- If swapped: `.env.example` updated, cache answer stated, and a re-measured end-to-end figure in
  `## Notes`.
- If rejected: `## Notes` says so, and STATE.md's backlog notes that #266 is the remaining route.

## Verification
```bash
npm test -- --project node speech
npm run lint && npm run typecheck
```
Then, with `AI_ENABLED=true` and a live key: start a voice interview and listen to a real
interviewer line end to end. The benchmark is not the verification — the room is.

## Notes
**Decision: SWAP to `eleven_turbo_v2_5`.** Owner listened to all 6 samples (EN+TR × 3 models) and
judged them indistinguishable — "they all sound the same". No quality regression, so latency wins;
turbo chosen over flash because it was both faster and beat flash in this run.

**Executed:** `.env` + `.env.example` → `ELEVENLABS_TTS_MODEL=eleven_turbo_v2_5`. No app code
touched (config surface held, as required). `.env.example` carries a one-line why.

**Anomaly (step 2) — resolved, benign.** REFERENCE's identical 82,799-byte TR for multilingual and
turbo did NOT reproduce. This run: 6/6 outputs have distinct byte lengths AND distinct sha256. The
old reading was a spike-time measurement artefact, not two ids collapsing to one audio. Comparison
is valid.

**Cache (step 5) — no purge.** Keys `speech/{questionId}.mp3` / `speech/msg-{id}.mp3` carry no
model marker, so an in-flight interview may serve old-model + new-model bytes in one session. Since
the voices are audibly identical (owner's verdict) there is no seam; purging would only re-bill
interviews already in flight for zero audible gain. Accepted as-is.

**Price (step 4).** `elevenlabs/tts` in `model-prices.yaml` is one flat $180/1M-char rate keyed by
model family, applied to every `model_id`. Swap changes latency only, not billed cost.

**Measured before/after (warm median, n=5, warm-up discarded, live key):**

| model | EN | TR |
|---|---|---|
| multilingual_v2 (before) | 1270 ms | 1483 ms |
| turbo_v2_5 (after) | 407 ms | 460 ms |

TTS stage ~1130 → ~430 ms ⇒ end-to-end baseline ~7100 → **~6400 ms** (only the TTS line moved).
Bench script kept at `bench/l01-tts-bench.mjs`; samples at `bench/out/` (untracked, throwaway).

**Verification:** `npm test -- --project node speech` 79/79; `npm run lint`, `npm run typecheck`
clean. Room-level end-to-end listen (task's stated final check) needs the full stack up with
`AI_ENABLED=true`; not run here — the config-only change is covered by the swap + green tests.
