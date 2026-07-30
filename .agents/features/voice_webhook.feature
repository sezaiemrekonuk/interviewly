Feature: The ElevenLabs webhook passes four gates before mutating an interview

  @voice-webhook @voice @AC-3
  Scenario Outline: A webhook failing signature or freshness is rejected and mutates nothing
    Given a live voice session exists for my interview
    And the interview is on question 2
    When ElevenLabs posts a "submit_answer" webhook that is <defect>
    Then the response status is 401
    And the response error code is "<code>"
    And the interview is still on question 2
    And no answer row is written
    And a "<code>" event is emitted with the interviewId
    When ElevenLabs posts a correctly signed and fresh "submit_answer" webhook with the live nonce
    Then the response status is 200

    Examples:
      | defect                                             | code                      |
      | signed with the wrong secret                       | WEBHOOK_SIGNATURE_INVALID |
      | carrying a timestamp outside the freshness window  | WEBHOOK_REPLAY_REJECTED   |

  @voice-webhook @voice @AC-4
  Scenario: A webhook whose nonce matches no unexpired row is rejected as an invalid session
    Given a live voice session exists for my interview
    And the interview is on question 2
    When ElevenLabs posts a correctly signed "submit_answer" webhook whose (interviewId, nonce) matches no unexpired row
    Then the response status is 403
    And the response error code is "VOICE_SESSION_INVALID"
    And the interview is still on question 2
    And no answer row is written
    When ElevenLabs posts a correctly signed "submit_answer" webhook with the live nonce
    Then the response status is 200

  @voice-webhook @voice @AC-4
  Scenario: A webhook arriving after the ceiling ends the interview time_exhausted
    Given the fixed clock is "2026-07-29T10:00:00Z"
    And a live voice session exists for my interview with expires_at "2026-07-29T10:05:00Z"
    And the interview is on question 2
    When ElevenLabs posts a valid "submit_answer" webhook with the live nonce at "2026-07-29T10:04:00Z"
    Then the response status is 200
    And the interview endedReason is not set
    When the fixed clock moves to "2026-07-29T10:05:01Z"
    And ElevenLabs posts a valid "submit_answer" webhook with the live nonce
    Then the response status is 403
    And the response error code is "VOICE_SESSION_EXPIRED"
    And the interview state is "evaluating"
    And the interview endedReason is "time_exhausted"

  @voice-webhook @voice @AC-5
  Scenario: A valid submit_answer persists a voice answer and advances the clock
    Given a live voice session exists for my interview
    And the interview is on question 2
    When ElevenLabs posts a valid "submit_answer" webhook with the live nonce
    Then the response status is 200
    And an answers row for question 2 is stored with input_mode "voice"
    And the interview currentIndex is 3
    When ElevenLabs posts a valid "end_round" webhook before the round's questions are exhausted
    Then the response status is 409
    And the response error code is "INVALID_STATE_TRANSITION"
    And the interview currentIndex is 3

  @voice-webhook @voice @AC-10
  Scenario: Voice webhook log lines carry the interviewId but never a session secret or transcript
    Given a live voice session exists for my interview
    When ElevenLabs posts a valid "submit_answer" webhook whose transcript is "my secret answer"
    And a "submit_answer" webhook signed with the wrong secret is rejected
    Then the captured "VOICE_WEBHOOK_RECEIVED" event includes the interviewId and the action
    And the captured "WEBHOOK_SIGNATURE_INVALID" event includes the interviewId
    And no captured log field contains the nonce
    And no captured log field contains the session token
    And no captured log field contains the ElevenLabs API key
    And no captured log field contains the transcript text "my secret answer"
