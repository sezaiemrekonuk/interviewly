Feature: Provider fallback, cost accounting and kill switch

  @ai-provider @ai @AC-6
  Scenario Outline: A failed tier-1 attempt falls through to tier-2 and records both attempts
    Given the tier-1 provider will <tier1outcome> for the next call
    When the HR round is generated
    Then a "LLM_FALLBACK_TRIGGERED" event is emitted
    And exactly two llm_calls rows exist for the call
    And the first llm_calls row has attempt_no 1 and no fell_back_from
    And the second llm_calls row has attempt_no 2 and fell_back_from set
    And exactly 3 questions exist for the HR round

    Examples:
      | tier1outcome          |
      | return an HTTP error  |
      | time out              |
      | be rate limited       |
      | return invalid schema |

  @ai-provider @ai @AC-6
  Scenario: A succeeding tier-1 call records a single attempt with no fallback
    Given the tier-1 provider will succeed for the next call
    When the HR round is generated
    Then no "LLM_FALLBACK_TRIGGERED" event is emitted
    And exactly one llm_calls row exists for the call
    And that llm_calls row has attempt_no 1 and no fell_back_from

  @ai-provider @ai @AC-7 @AC-8
  Scenario Outline: Per-attempt cost is computed when the model has a price and null when it does not
    Given the model prices file <priceState> a row for the called model
    When the HR round is generated
    Then the llm_calls row carries provider, model, prompt_uuid, prompt_version and unit_kind
    And the llm_calls row cost_usd is <cost>
    And a "PRICE_MISSING" event is <emitted>

    Examples:
      | priceState | cost     | emitted     |
      | has        | non-null | not emitted |
      | lacks      | null     | emitted     |

  @ai-provider @ai @AC-9
  Scenario: With AI disabled the client returns canned schema-valid content at zero cost
    Given AI_ENABLED is "false"
    When the HR round is generated
    Then the response status is 200
    And exactly 3 questions exist for the HR round
    And every generated question satisfies the QuestionBatch schema
    And exactly one llm_calls row is recorded with cost_usd 0
    And an "AI_DISABLED_STUB_MODE" event is emitted
    And startup performed no provider-key validation
    When AI_ENABLED is "true" and every referenced provider key is present
    And the HR round is generated
    Then no "AI_DISABLED_STUB_MODE" event is emitted
    And the llm_calls row cost_usd is non-null

  @ai-provider @ai @AC-10
  Scenario Outline: Startup validates provider keys only when AI is enabled
    Given AI_ENABLED is "<enabled>"
    And the "<provider>" key referenced by a loaded prompt file is "<keyState>"
    When the API starts
    Then startup <result>
    And the boot error code is "<code>"

    Examples:
      | enabled | provider | keyState | result               | code                 |
      | true    | openai   | unset    | fails before serving | PROVIDER_KEY_MISSING |
      | true    | openai   | set      | serves requests      |                      |
      | false   | openai   | unset    | serves requests      |                      |
