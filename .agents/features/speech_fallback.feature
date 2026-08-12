Feature: The interview survives a speech outage

  # S05 renames voice_fallback.feature. Same invariant (§3.8, ADR-V03): the downgrade is
  # one-directional and loses nothing. Only the trigger moved — FakeVoiceSession's mint became
  # FakeSpeechProvider.failNext on the TTS route, because there is no mint any more (ADR-S01).

  @speech-fallback @AC-7
  Scenario: A fatal speech error downgrades the interview to text and preserves progress
    Given I am in an interview in voice mode on question 3
    And I answered questions 1 and 2 by voice
    When the fake speech provider reports a fatal error
    Then the interview mode becomes "text"
    And the answers for questions 1 and 2 are preserved with input_mode "voice"
    And the interview currentIndex is 3
    And a "VOICE_DOWNGRADED_TO_TEXT" event is emitted with the interviewId
    When I submit an answer for question 3
    Then the response status is 200
    And the stored answer for question 3 has input_mode "text"
    And the interview mode is still "text"
    When I request the current question speech after the downgrade
    Then the response status is 409
    And the response error code is "INVALID_STATE_TRANSITION"
    And the interview mode is still "text"

  # The same outage on the other route — the candidate's own recording, not the interviewer's
  # line. Without the downgrade here the upload 503s and the room is stranded in voice mode:
  # it tells the candidate to carry on in text and gives them no composer to do it with.
  @speech-fallback @AC-7
  Scenario: A fatal transcription error downgrades the interview to text
    Given I am in an interview in voice mode on question 3
    And I answered questions 1 and 2 by voice
    When the fake speech provider fails the next transcription
    Then the interview mode becomes "text"
    And the answers for questions 1 and 2 are preserved with input_mode "voice"
    And the interview currentIndex is 3
    And a "VOICE_DOWNGRADED_TO_TEXT" event is emitted with the interviewId
    When I submit an answer for question 3
    Then the response status is 200
    And the stored answer for question 3 has input_mode "text"
    And the interview mode is still "text"

  # S07 — the other trigger for the same one-directional downgrade: the candidate has no
  # microphone, and the room was never reached. Nothing was spoken, so nothing was billed.
  @speech-fallback @AC-10
  Scenario: A microphone refused at pre-join downgrades the interview with no provider call
    Given I am in an interview in voice mode on question 1
    When the candidate cannot grant a microphone at pre-join
    Then the response status is 200
    And the interview mode becomes "text"
    And no elevenlabs llm_calls row exists for the interview
    And a "VOICE_DOWNGRADED_TO_TEXT" event is emitted with the interviewId

  @speech-fallback @AC-7
  Scenario: A healthy speech call stays in voice mode
    Given I am in an interview in voice mode on question 3
    When the fake speech provider serves a question without error
    Then the interview mode is still "voice"
    And no "VOICE_DOWNGRADED_TO_TEXT" event is emitted
