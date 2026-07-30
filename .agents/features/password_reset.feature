Feature: Password reset

  Reset is the button a user presses when they believe they are compromised (IDEA.md K8.6):
  it must not leak who has an account, and it must end every existing session.

  @auth @backend @AC-25
  Scenario: A reset request never reveals whether an account exists
    Given a password account exists for "known@example.com"
    And no account exists for "unknown@example.com"
    And a Google-only account exists for "googleonly@example.com"
    When I request a password reset for "known@example.com"
    Then the response status is 202
    And the response body is empty
    When I request a password reset for "unknown@example.com"
    Then the response status is 202
    And the response body is empty
    When I request a password reset for "googleonly@example.com"
    Then the response status is 202
    And the response body is empty
    And exactly one "email.send" job is enqueued for "known@example.com" with kind "reset"
    And exactly one "email.send" job is enqueued for "googleonly@example.com" with kind "reset"
    And no "email.send" job is enqueued for "unknown@example.com"

  @auth @backend @AC-26
  Scenario: Completing a reset revokes every existing session
    Given a password account exists for "revoke@example.com" with password "1234567890"
    And I am signed in as "revoke@example.com"
    And a valid reset token was issued for "revoke@example.com"
    When I confirm the password reset with that token and password "new-password-1"
    Then the response status is 200
    When I fetch GET "/me" with that session
    Then the response status is 401
    And the response error code is "UNAUTHENTICATED"
    When I log in with email "revoke@example.com" and password "new-password-1"
    Then the response status is 200
    And a session cookie is set
    When I log in with email "revoke@example.com" and password "1234567890"
    Then the response status is 401
    And the response error code is "INVALID_CREDENTIALS"

  @auth @backend @AC-26
  Scenario: A rejected password leaves the reset token usable
    Given a password account exists for "shortpw@example.com" with password "1234567890"
    And a valid reset token was issued for "shortpw@example.com"
    When I confirm the password reset with that token and password "123456789"
    Then the response status is 422
    And the response error code is "PASSWORD_TOO_SHORT"
    When I confirm the password reset with that token and password "1234567890-ok"
    Then the response status is 200

  @auth @backend @AC-22 @AC-26
  Scenario: A reset token is single-use and expires in an hour
    Given a password account exists for "reused@example.com" with password "1234567890"
    And a valid reset token was issued for "reused@example.com"
    When I confirm the password reset with that token and password "new-password-1"
    Then the response status is 200
    When I confirm the password reset with that token and password "new-password-2"
    Then the response status is 400
    And the response error code is "EMAIL_TOKEN_INVALID"
    Given a reset token was issued for "reused@example.com" 61 minutes ago
    When I confirm the password reset with that token and password "new-password-3"
    Then the response status is 400
    And the response error code is "EMAIL_TOKEN_EXPIRED"

  @auth @backend @AC-27
  Scenario: A Google-only account sets its first password through reset
    Given a Google-only account exists for "firstpw@example.com"
    And a valid reset token was issued for "firstpw@example.com"
    When I confirm the password reset with that token and password "1234567890"
    Then the response status is 200
    When I log in with email "firstpw@example.com" and password "1234567890"
    Then the response status is 200
    And a session cookie is set
    And the account for "firstpw@example.com" has a verified email

  @auth @backend @AC-13
  Scenario: Reset requests are rate-limited by IP, not by account
    Given a password account exists for "limited@example.com"
    When I request 5 password resets for "limited@example.com"
    Then the last response status is 202
    When I request a password reset for "limited@example.com"
    Then the response status is 429
    And the response error code is "RATE_LIMITED"

  @auth @backend @AC-28
  Scenario: Reset log lines carry the user but never the token
    Given a password account exists for "quiet@example.com"
    And a valid reset token was issued for "quiet@example.com"
    When I confirm the password reset with that token and password "1234567890"
    Then a log event "AUTH_RESET_COMPLETED" was emitted with the user id
    And no log line contains the reset token
    And no log line contains a token hash
