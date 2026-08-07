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

  @report @backend @requeue
  Scenario: An admin requeues a report job that exhausted its retries
    Given I am on the last technical question of an interview
    When I submit an answer for the current question
    Then the response status is 200
    And the interview state is "evaluating"
    And exactly one report job is enqueued for the interviewId
    When the report job fails until its retry budget is exhausted
    Then the report job is retained in the failed set
    When an unauthenticated client requeues the report for the interview
    Then the response status is 401
    And the response error code is "UNAUTHENTICATED"
    When a non-admin requeues the report for the interview
    Then the response status is 403
    And the response error code is "FORBIDDEN"
    When an admin requeues the report for the interview
    Then the response status is 202
    And the interview state is "evaluating"
    And exactly one report job is enqueued for the interviewId
    When the report job completes for the interview
    And I fetch GET "/interviews/:id"
    Then the response status is 200
    And the response contains the ready report
    When an admin requeues the report for the interview
    Then the response status is 409
    And the response error code is "REPORT_ALREADY_EXISTS"
    And exactly one report row exists for the interview

  @report @backend @requeue
  Scenario: An admin requeues a report job deleted outright from Redis
    Given I am on the last technical question of an interview
    When I submit an answer for the current question
    Then the response status is 200
    And the interview state is "evaluating"
    And exactly one report job is enqueued for the interviewId
    When the report job is deleted from Redis
    Then no report job exists for the interviewId
    When an admin requeues the report for the interview
    Then the response status is 202
    And exactly one report job is enqueued for the interviewId
    When the report job completes for the interview
    And I fetch GET "/interviews/:id"
    Then the response status is 200
    And the response contains the ready report
    And exactly one report row exists for the interview

  @report @backend @requeue
  Scenario: An admin requeues an interview dead-lettered with no report
    Given I am on the last technical question of an interview
    When I submit an answer for the current question
    Then the response status is 200
    And the interview state is "evaluating"
    When the report job fails until its retry budget is exhausted
    And the interview is dead-lettered with no report row
    Then the interview state is "failed"
    When an admin requeues the report for the interview
    Then the response status is 202
    And the interview state is "evaluating"
    And exactly one report job is enqueued for the interviewId
    When the report job completes for the interview
    And I fetch GET "/interviews/:id"
    Then the response status is 200
    And the response contains the ready report
    And exactly one report row exists for the interview
