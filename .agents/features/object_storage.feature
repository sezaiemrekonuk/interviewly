Feature: Private object access is signed and short-lived

  @object-storage @infra @AC-6
  Scenario: A private report is handed out only as a short-lived signed URL scoped to its owner
    Given I am signed in as a candidate
    And the fixed clock is "2026-07-29T10:00:00Z"
    And I own an interview with a generated report PDF
    When I request the report download for that interview
    Then the response status is 200
    And the response contains a signed URL for the private object
    And the signed URL carries an expiry no more than 300 seconds ahead of the fixed clock
    And the signed URL target is not under the public "/assets/" route
    When another candidate is signed in
    And the other candidate requests the report download for that interview
    Then the response status is 404
    And the response error code is "INTERVIEW_NOT_FOUND"
    And no signed URL is returned to the other candidate

  @object-storage @infra @AC-6
  Scenario: A signed URL reads the private object until its TTL expires and then is refused
    Given I am signed in as a candidate
    And the fixed clock is "2026-07-29T10:00:00Z"
    And I own an interview with a generated report PDF
    When I request the report download for that interview
    And I fetch the returned signed URL before its TTL expires
    Then the object fetch status is 200
    When the fixed clock moves past the signed URL TTL
    And I fetch the same signed URL again
    Then the object fetch status is 403
