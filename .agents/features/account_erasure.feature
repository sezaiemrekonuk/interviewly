Feature: Consent and account erasure (KVKK / GDPR — issue 009)

  @auth @backend @kvkk
  Scenario: An account is never created without consent
    When I register with email "noconsent@example.com" and password "1234567890" without accepting the policies
    Then the response status is 422
    And the response error code is "CONSENT_REQUIRED"
    And no user exists for "noconsent@example.com"

  @auth @backend @kvkk
  Scenario: Accepting the policies is recorded on the account, not assumed
    When I register with email "consent@example.com" and password "1234567890"
    Then the response status is 201
    And the account for "consent@example.com" carries the accepted policy version and a timestamp

  @auth @backend @kvkk
  Scenario: Deleting the account erases the personal data and locks the address out
    Given a signed-in account with a profile and an interview exists for "erase@example.com"
    When I delete my account
    Then the response status is 204
    And the session no longer resolves
    And logging in as "erase@example.com" is refused
    And no personal data remains for "erase@example.com"
    And no interview of that account is retrievable
