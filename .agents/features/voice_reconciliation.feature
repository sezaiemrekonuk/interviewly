Feature: Voice usage is reconciled after the call

  @voice-reconciliation @voice @AC-7
  Scenario: The post-call webhook records elevenlabs seconds and reconciles spent_usd in one transaction
    Given an interview ran a voice round for 240 seconds
    And the interview spent_usd before reconciliation is recorded
    When ElevenLabs posts the post-call reconciliation webhook reporting 240 seconds
    Then the worker writes exactly one llm_calls row for the interview
    And that llm_calls row has provider "elevenlabs"
    And that llm_calls row has unit_kind "second"
    And that llm_calls row has units 240
    And the interview spent_usd increases by the reconciled voice cost
    And the llm_calls row and the spent_usd update commit in one transaction
    And a "VOICE_USAGE_RECONCILED" event is emitted with the interviewId
    When the same post-call reconciliation webhook is delivered again
    Then no additional llm_calls row is written
    And the interview spent_usd is unchanged
