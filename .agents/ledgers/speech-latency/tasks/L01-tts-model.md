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
- [ ] **1. Re-measure, warm** — `eleven_multilingual_v2`, `eleven_turbo_v2_5`, `eleven_flash_v2_5`,
  both languages, n≥5, warm-up discarded. Confirm or correct REFERENCE.md's table.
- [ ] **2. Resolve the identical-bytes anomaly** — same text, same voice, `multilingual_v2` vs
  `turbo_v2_5` in Turkish. If the outputs really are byte-identical, the two model ids are not
  producing different audio and the whole comparison is void. Report what you find.
- [ ] **3. Render samples for the ear** — for each model, one English and one Turkish interviewer
  line, using the seeded voices (`EXAVITQu4vr4xnSDxMaL` HR, `JBFqnCBsd6RMkjVDRZzb` tech). Use a
  real conductor reply, not a lorem sentence — a question with a name and a technical term in it.
  Write them somewhere playable and name the files by model and language.
- [ ] **4. Check the price** — confirm per-character cost for turbo and flash against
  `model-prices.yaml`. A faster model that costs more changes the recommendation.
- [ ] **5. Cache invalidation, if the swap happens** — cached MP3s under `speech/{questionId}` and
  `speech/msg-{id}` were produced by the old model and carry no model marker. A live interview
  would hear both voices in one session. Decide and state the answer: purge the prefix, or accept
  it on the grounds that cached entries belong to interviews already in flight.
- [ ] **6. Hand over and wait.** Present the samples and the table. **Do not choose.** Record the
  owner's answer in `## Notes` with a sentence on why.
- [ ] **7. Execute the decision** — either the `.env` / `.env.example` edit plus step 5's cache
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
_(fill in when done — the owner's decision, the reason, the anomaly explanation, and a measured
before/after if it swapped)_
