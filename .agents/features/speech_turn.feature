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
