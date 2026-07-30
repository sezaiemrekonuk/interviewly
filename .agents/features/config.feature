Feature: Startup configuration validation

  @config @infra @AC-5
  Scenario: A missing required env var fails startup fast and a valid one serves
    Given the required env var "DATABASE_URL" is unset
    When the API starts
    Then startup fails before serving
    And the boot error code is "ENV_VALIDATION_FAILED"
    And the boot error message names "DATABASE_URL"
    And no request is served
    When every required env var is set to a valid value
    And the API starts
    Then startup serves requests
    And no "ENV_VALIDATION_FAILED" boot error is raised

  @config @infra @AC-5
  Scenario Outline: Each missing or malformed required key is named at boot
    Given the required env var "<key>" is "<state>"
    When the API starts
    Then startup fails before serving
    And the boot error code is "ENV_VALIDATION_FAILED"
    And the boot error message names "<key>"
    And no request is served
    When "<key>" is set to a valid value
    And every other required env var is set to a valid value
    And the API starts
    Then startup serves requests

    Examples:
      | key         | state     |
      | REDIS_URL   | malformed |
      | S3_BUCKET   | unset     |
      | PUBLIC_ORIGIN | malformed |
