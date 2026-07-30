Feature: Report availability

  @report @backend @AC-20
  Scenario: Entering evaluation nudges clients and exposes the ready report once
    Given I have an open SSE connection to GET "/events/interviews/:id"
    And I am on the last technical question of an interview
    When I submit an answer for the current question
    Then the response status is 200
    And the interview state is "evaluating"
    And exactly one report job is enqueued for the interviewId
    And the SSE stream emits an interview nudge
    When evaluating is entered again for the same interviewId
    Then no additional report job is enqueued
    When the report job completes for the interview
    And I fetch GET "/interviews/:id"
    Then the response status is 200
    And the response contains the ready report
