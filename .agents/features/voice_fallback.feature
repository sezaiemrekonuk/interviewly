Feature: The interview survives a voice outage

  @voice-fallback @voice @AC-6
  Scenario: A fatal voice error downgrades the interview to text and preserves progress
    Given I am in an interview in voice mode on question 3
    And I answered questions 1 and 2 by voice
    When the fake voice session reports a fatal error
    Then the interview mode becomes "text"
    And the answers for questions 1 and 2 are preserved with input_mode "voice"
    And the interview currentIndex is 3
    And a "VOICE_DOWNGRADED_TO_TEXT" event is emitted with the interviewId
    When I submit an answer for question 3
    Then the response status is 200
    And the stored answer for question 3 has input_mode "text"
    And the interview mode is still "text"
    When I POST "/interviews/:id/voice/session" after the downgrade
    Then the response status is 409
    And the response error code is "INVALID_STATE_TRANSITION"
    And the interview mode is still "text"

  @voice-fallback @voice @AC-6
  Scenario: A healthy voice session stays in voice mode
    Given I am in an interview in voice mode on question 3
    When the fake voice session completes a turn without error
    Then the interview mode is still "voice"
    And no "VOICE_DOWNGRADED_TO_TEXT" event is emitted
