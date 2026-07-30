Feature: LLM output schema validation

  @schema-validation @ai @AC-11
  Scenario: A malformed report never reaches the caller
    Given an interview has reached "evaluating"
    And the stub AI is configured to return a report with overall_score 7
    When the report job runs
    Then no report payload is stored for the interview
    And the interview state is "failed"
    And an "AI_OUTPUT_SCHEMA_INVALID" event is emitted
    When the stub AI is configured to return a schema-valid ReportPayload
    And the report job runs
    Then the interview state is "completed"
    And the stored report overall_score is an integer in 0..5
    And every stored rounds[].score is an integer in 0..5
    And every stored questions[].score is an integer in 0..5
    And the stored report strengths has between 2 and 5 items
    And the stored report improvements has between 2 and 5 items
    And every stored questions[].star_adherence is between 0 and 1
