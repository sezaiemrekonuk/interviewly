Feature: Runtime health and readiness

  @reliability @backend @AC-19
  Scenario: Probes report live process and ready dependencies
    When I fetch GET "/healthz"
    Then the response status is 200
    When Postgres and Redis are reachable
    And I fetch GET "/readyz"
    Then the response status is 200

  @reliability @backend @AC-19
  Scenario Outline: Readiness fails when a dependency is unreachable
    Given <dependency> is unreachable
    When I fetch GET "/readyz"
    Then the response status is 503
    And the response error code is "NOT_READY"

    Examples:
      | dependency |
      | Postgres   |
      | Redis      |
