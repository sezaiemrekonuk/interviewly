Feature: Speech provider seam — SpeechProvider interface contract

  # S01: these scenarios test the seam, not the HTTP routes.
  # S02 (TTS route) and S03 (STT route) own the HTTP-level AC-1/AC-3 scenarios.

  Background:
    Given the fake speech provider is installed

  @speech @AC-1
  Scenario: speak() returns an audio buffer and the character count of the spoken text
    When I call speak with text "Tell me about yourself." voiceId "v-001" language "en"
    Then the audio mime is "audio/mpeg"
    And the audio buffer is non-empty
    And the character count equals the length of the spoken text

  @speech @AC-3
  Scenario: transcribe() returns a non-empty transcript and a positive duration
    When I call transcribe with 512 bytes of mime "audio/mpeg" language "en"
    Then the transcript is a non-empty string
    And the seconds count is positive

  @speech @AC-1
  Scenario: failNext makes the next speak() throw VOICE_UNAVAILABLE, then the following call succeeds
    Given failNext is set on the fake speech provider
    When I attempt to call speak with text "hello" voiceId "v-001" language "en"
    Then the speak call throws an ApiError with code "VOICE_UNAVAILABLE"
    When I call speak with text "hello" voiceId "v-001" language "en"
    Then the audio mime is "audio/mpeg"

  @speech @AC-1
  Scenario: owner can fetch current question speech bytes from same origin without exposing key material
    Given I am signed in as a speech candidate
    And I have a voice interview in hr_round with current index 1
    When I GET "/interviews/:id/questions/:index/speech" as that owner
    Then the response is "audio/mpeg" bytes
    And the speech response body does not include the ElevenLabs API key material

  @speech @AC-1
  Scenario: non-owner cannot fetch another candidate's question speech
    Given another candidate owns a voice interview in hr_round with current index 1
    When I GET "/interviews/:id/questions/:index/speech" as a non-owner
    Then the API response code is "FORBIDDEN"

  @speech @AC-2
  Scenario: second request for same current question is served from cache with no second provider call
    Given I am signed in as a speech candidate
    And I have a voice interview in hr_round with current index 1
    When I GET "/interviews/:id/questions/:index/speech" as that owner
    And I GET "/interviews/:id/questions/:index/speech" as that owner
    Then the fake speech provider speak call count is 1

  @speech @AC-6
  Scenario: request past voice ceiling ends interview and does not call provider
    Given I am signed in as a speech candidate
    And I have a voice interview in hr_round with current index 1
    And that interview started 2000 seconds ago
    When I GET "/interviews/:id/questions/:index/speech" as that owner
    Then the API response code is "VOICE_SESSION_EXPIRED"
    And the fake speech provider speak call count is 0
    And that interview ended reason is "time_exhausted"

  # S03: the STT answer route — POST audio to Scribe to the same guarded advance a typed answer uses.

  @speech @AC-3
  Scenario: an audio answer is transcribed, persisted as voice, and advances the interview
    Given I am signed in as a speech candidate
    And I have a voice interview in hr_round with current index 1
    When I POST a "audio/webm" answer recording as that owner
    Then the answer response status is 200
    And the interview holds exactly 1 answer with input mode "voice"
    And the interview current index is 2

  @speech @AC-4
  Scenario: an oversize recording is refused and nothing changes
    Given I am signed in as a speech candidate
    And I have a voice interview in hr_round with current index 1
    When I POST an oversize "audio/webm" answer recording as that owner
    Then the API response code is "UPLOAD_TOO_LARGE"
    And the interview holds exactly 0 answers
    And the interview current index is 1

  @speech @AC-4
  Scenario: a non-audio recording is refused and nothing changes
    Given I am signed in as a speech candidate
    And I have a voice interview in hr_round with current index 1
    When I POST a "text/plain" answer recording as that owner
    Then the API response code is "UNSUPPORTED_MEDIA_TYPE"
    And the interview holds exactly 0 answers
    And the interview current index is 1

  @speech @AC-4
  Scenario: an undecodable recording yields a transcription failure and nothing changes
    Given I am signed in as a speech candidate
    And I have a voice interview in hr_round with current index 1
    And the fake speech provider returns an empty transcript next
    When I POST a "audio/webm" answer recording as that owner
    Then the API response code is "SPEECH_TRANSCRIPTION_FAILED"
    And the interview holds exactly 0 answers
    And the interview current index is 1

  @speech @AC-6
  Scenario: an audio answer past the voice ceiling ends the interview and calls no provider
    Given I am signed in as a speech candidate
    And I have a voice interview in hr_round with current index 1
    And that interview started 2000 seconds ago
    When I POST a "audio/webm" answer recording as that owner
    Then the API response code is "VOICE_SESSION_EXPIRED"
    And the fake speech provider transcribe call count is 0
    And that interview ended reason is "time_exhausted"
    And the interview holds exactly 0 answers

  @speech @AC-3
  Scenario: a recording naming a stale question is rejected without a transcription call
    Given I am signed in as a speech candidate
    And I have a voice interview in hr_round with current index 1
    When I POST a "audio/webm" answer recording naming a stale question as that owner
    Then the API response code is "QUESTION_NOT_CURRENT"
    And the fake speech provider transcribe call count is 0
    And the interview holds exactly 0 answers
    And the interview current index is 1

  @speech @AC-14
  Scenario: no audio is persisted anywhere after a voice answer
    Given I am signed in as a speech candidate
    And I have a voice interview in hr_round with current index 1
    When I POST a "audio/webm" answer recording as that owner
    Then the answer response status is 200
    And the fake storage holds no audio object
    And the interview holds exactly 1 answer with input mode "voice"

  # S04: per-call usage accounting — every provider call bills spent_usd in one transaction.

  @speech @AC-5
  Scenario: a TTS call writes one character-metered llm_calls row and charges spent_usd
    Given I am signed in as a speech candidate
    And I have a voice interview in hr_round with current index 1
    When I GET "/interviews/:id/questions/:index/speech" as that owner
    Then the interview has exactly 1 elevenlabs llm_calls row for model "tts" with unit kind "character"
    And the interview spent_usd is greater than zero

  @speech @AC-5
  Scenario: an STT call writes one second-metered llm_calls row and charges spent_usd
    Given I am signed in as a speech candidate
    And I have a voice interview in hr_round with current index 1
    When I POST a "audio/webm" answer recording as that owner
    Then the answer response status is 200
    And the interview has exactly 1 elevenlabs llm_calls row for model "stt" with unit kind "second"
    And the interview spent_usd is greater than zero

  @speech @AC-5
  Scenario: a cached TTS response makes no provider call and bills nothing
    Given I am signed in as a speech candidate
    And I have a voice interview in hr_round with current index 1
    When I GET "/interviews/:id/questions/:index/speech" as that owner
    And I GET "/interviews/:id/questions/:index/speech" as that owner
    Then the interview has exactly 1 elevenlabs llm_calls row for model "tts" with unit kind "character"

  # S08: voice-first default and the candidate's chosen duration. The ceiling itself is @AC-6
  # above; these say who gets to choose it and what the server does with a choice it will not
  # honour.

  @speech @AC-11
  Scenario: a create that names no mode is a voice interview
    Given I am signed in as a candidate
    When I start an interview with a "Backend Engineer" listing and no mode
    Then the response status is 201
    And the interview mode is "voice"

  @speech @AC-11
  Scenario: a duration under the platform ceiling is stored on the interview
    Given I am signed in as a candidate
    When I start a voice interview with a duration of 600 seconds
    Then the response status is 201
    And the interview max duration is 600 seconds

  @speech @AC-11
  Scenario: a duration over the platform ceiling is refused, not clamped
    Given I am signed in as a candidate
    When I start a voice interview with a duration of 99999 seconds
    Then the response status is 422
    And the response error code is "VALIDATION_ERROR"
    And no interview is created
