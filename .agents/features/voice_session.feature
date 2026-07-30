Feature: Voice session minting

  @voice-session @voice @AC-1
  Scenario Outline: The mint binds expires_at to the tighter of the round and interview ceiling
    Given I am signed in as a candidate
    And the fixed clock is "2026-07-29T10:00:00Z"
    And I own an interview in a state that can host a voice round
    And <roundLeft> seconds remain on the round voice ceiling
    And <interviewLeft> seconds remain on the interview voice ceiling
    When I POST "/interviews/:id/voice/session"
    Then the response status is 201
    And the response contains a session token and a wssOrigin
    And the response dynamicVars are the interviewId and a nonce
    And a voice_sessions row exists with expires_at <expires> seconds ahead of the fixed clock
    And the response contains no ElevenLabs API key

    Examples:
      | roundLeft | interviewLeft | expires |
      | 720       | 300           | 300     |
      | 200       | 1500          | 200     |

  @voice-session @voice @AC-2
  Scenario Outline: A mint is refused unless the owner targets a voice-capable interview with voice enabled
    Given the precondition "<precondition>" holds
    When the mint is attempted with "POST /interviews/:id/voice/session"
    Then the response status is <status>
    And the response error code is "<code>"
    And no voice_sessions row is written

    Examples:
      | precondition                                                       | status | code                     |
      | a non-owner targets another candidate's voice-capable interview    | 403    | FORBIDDEN                |
      | the owner targets an interview in a state that cannot host voice    | 409    | INVALID_STATE_TRANSITION |
      | the owner targets a voice-capable interview with AI_ENABLED "false" | 503    | VOICE_UNAVAILABLE        |

  @voice-session @voice @AC-2
  Scenario: A voice-capable owner mint succeeds when voice is enabled
    Given I own an interview in a state that can host a voice round
    And AI_ENABLED is "true"
    When I POST "/interviews/:id/voice/session"
    Then the response status is 201
    And a voice_sessions row is written for the interview
