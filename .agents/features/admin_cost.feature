Feature: Admin interview cost visibility

  @admin-cost @backend @AC-17
  Scenario: Deleted interviews disappear for users and remain auditable for admins
    Given a candidate owns an interview with recorded cost
    And another candidate is signed in
    When the other candidate deletes that interview
    Then the response status is 404
    And the response error code is "INTERVIEW_NOT_FOUND"
    And the interview remains in the owner's GET "/me/interviews" response
    When the owner deletes the interview
    Then the response status is 204
    When the owner fetches GET "/me/interviews"
    Then the interview is absent
    When an admin fetches GET "/admin/interviews"
    Then the interview is present with deleted true
    And its cost is unchanged

  @admin-cost @backend @AC-18 @unwired
  Scenario: Admin interview and stats endpoints require admin role
    Given a non-admin user has a session
    When the non-admin user fetches GET "/admin/interviews"
    Then the response status is 403
    And the response error code is "FORBIDDEN"
    When an admin user fetches GET "/admin/interviews"
    Then the response status is 200
    And deleted interviews are included
    When the admin user fetches GET "/admin/stats"
    Then the response status is 200
    And averageDurationMs is computed from completed interviews
    And completed, unfinished, totalTokens, perOccupation and weakestQuestions are present
