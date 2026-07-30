Feature: API rate limits

  @rate-limits @backend @AC-12
  Scenario: The sixth interview within twenty-four hours is rejected
    Given I am signed in as a candidate
    And the fixed clock is "2026-07-29T10:00:00Z"
    And I started 5 interviews during the last 24 hours
    When I start another interview
    Then the response status is 429
    And the response error code is "DAILY_INTERVIEW_LIMIT"
    And no sixth interview is created
    When the fixed clock moves past the rolling 24 hour window
    And I start another interview
    Then the response status is 201

  @rate-limits @backend @AC-13
  Scenario Outline: Per-action rate limits reject only requests beyond the window
    Given the fixed clock is "2026-07-29T10:00:00Z"
    And <limit> successful "<action>" requests exist for "<key>" in the current window
    When I perform another "<action>" request for "<key>"
    Then the response status is 429
    And the response error code is "RATE_LIMITED"
    When the fixed clock moves past the rate-limit window
    And I perform another "<action>" request for "<key>"
    Then the response status is <successStatus>

    Examples:
      | action          | key          | limit | successStatus |
      | sign-in         | 203.0.113.10 | 5     | 200           |
      | register        | 203.0.113.11 | 3     | 201           |
      | interview-start | user-123     | 10    | 201           |
