# @unwired (I05): this file is owned by four tasks. The default cucumber profile runs
# `not @unwired`, so a scenario whose steps are not written yet is skipped, not undefined.
# The owning task DELETES its own @unwired tag in the PR that wires its step definitions.
Feature: Sequential interview flow

  @interview-flow @backend @AC-8
  Scenario: An answer cannot target a non-current question
    Given I am on question 2 of an 8-question interview
    When I submit an answer for question 3
    Then the response status is 409
    And the response error code is "QUESTION_NOT_CURRENT"
    And the interview currentIndex is 2
    When I submit an answer for question 2
    Then the response status is 200
    And the interview currentIndex is 3

  @interview-flow @backend @AC-9
  Scenario: State fetch resumes at the next unanswered question
    Given I answered 3 questions in an 8-question interview
    When I fetch GET "/interviews/:id/state"
    Then the response status is 200
    And currentIndex is 4
    And the transcript cursor covers 3 answers
    When I fetch GET "/interviews/:id/state" with a new client connection
    Then currentIndex is 4
    And the transcript cursor covers 3 answers

  @interview-flow @backend @AC-10
  Scenario: Answer duration is computed on the server clock
    Given the fixed clock is "2026-07-29T10:00:00Z"
    And question 2 was delivered at "2026-07-29T09:59:48Z"
    When I submit an answer for question 2 with client duration_ms 999
    Then the response status is 200
    And the stored answer duration_ms is 12000
    And no audio session is required

  @interview-flow @backend @AC-11
  Scenario: Budget exhaustion preserves the triggering answer without an AI call
    Given I am on the current question of an interview
    And the interview spent_usd equals its budget_usd inside the next AI transaction
    When I submit an answer for the current question
    Then the response status is 402
    And the response error code is "BUDGET_EXCEEDED"
    And the submitted answer is stored
    And no AI call is recorded for that submission
    And the interview state is "evaluating"
    And the interview endedReason is "budget_exhausted"

  @interview-flow @backend @AC-15
  Scenario: State-changing requests require the public origin
    Given I have a session and an interview in "profiling"
    When I POST "/interviews/:id/profile" with Origin "https://evil.example"
    Then the response status is 403
    And the response error code is "CSRF_ORIGIN_MISMATCH"
    And the interview state is "profiling"
    When I POST "/interviews/:id/profile" with Origin equal to PUBLIC_ORIGIN
    Then the response status is 200
    And the interview state is "hr_round"

  @interview-flow @backend @AC-16
  Scenario: The state machine accepts only listed HTTP transitions
    Given the backend state transition table is loaded
    When each listed HTTP transition is exercised through its endpoint
      | from      | to         | trigger                 |
      | created   | profiling  | POST /interviews        |
      | profiling | hr_round   | POST /interviews/:id/profile |
      | hr_round  | tech_round | last HR answer          |
      | tech_round | evaluating | last technical answer   |
      | hr_round  | paused     | AI timeout during generation |
      | paused    | hr_round   | POST /interviews/:id/resume |
    Then each transition response has a success status
    And each transition emits "INTERVIEW_STATE_CHANGED" with from, to and interviewId
    When each unlisted HTTP transition is exercised through its endpoint
      | from      | trigger                 |
      | hr_round  | POST /interviews/:id/profile |
      | profiling | POST /interviews/:id/answers |
      | evaluating | POST /interviews/:id/resume |
    Then each transition response status is 409
    And each transition response error code is "INVALID_STATE_TRANSITION"
    And no rejected transition changes state

  @interview-flow @backend @AC-16
  Scenario: Resume regenerates the batch the pause never wrote
    Given I set up an interview with 8 questions
    And the AI provider chain is exhausted
    When I POST "/interviews/:id/profile" for the profiling interview
    Then the response status is 503
    And the interview state is "paused"
    And no HR questions exist for that interview
    When the stub AI is configured to return a schema-valid batch of 3 questions
    And I POST "/interviews/:id/resume" to resume the interview
    Then the response status is 200
    And the interview state is "hr_round"
    And exactly 3 questions exist for the HR round
    And the HR questions are ordered 1 to 3
    And the room's current question is HR question 1

  @interview-flow @backend @AC-16
  Scenario: A resume that fails again stays resumable, and a repeat resume adds no second batch
    Given I set up an interview with 8 questions
    And the AI provider chain is exhausted
    When I POST "/interviews/:id/profile" for the profiling interview
    And I POST "/interviews/:id/resume" to resume the interview
    Then the response status is 503
    And the response error code is "AI_PROVIDER_UNAVAILABLE"
    And the interview state is "paused"
    When the stub AI is configured to return a schema-valid batch of 3 questions
    And I POST "/interviews/:id/resume" to resume the interview
    Then the response status is 200
    And exactly 3 questions exist for the HR round
    When the interview is forced back to "paused"
    And I POST "/interviews/:id/resume" to resume the interview
    Then the response status is 200
    And exactly 3 questions exist for the HR round
