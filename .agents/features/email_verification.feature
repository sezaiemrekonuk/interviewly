Feature: Email verification

  Verification exists (IDEA.md K8.6) but never blocks a clean-machine demo: the mail is always
  sent, and enforcement is the `EMAIL_VERIFICATION_REQUIRED` config gate on exactly one endpoint.

  @auth @backend @AC-21 @AC-28
  Scenario: Registration sends exactly one verification mail without waiting on SMTP
    When I register with email "verify@example.com" and password "1234567890"
    Then the response status is 201
    And a session cookie is set
    And exactly one "email.send" job is enqueued for "verify@example.com" with kind "verify"
    And the current user has no verified email
    And no log line contains the verification token

  @auth @backend @AC-22
  Scenario: A verification token works once and is never replayable
    Given a registered unverified account exists for "once@example.com"
    And a valid verification token was issued for "once@example.com"
    When I confirm email verification with that token
    Then the response status is 200
    And the account for "once@example.com" has a verified email
    When I confirm email verification with that token
    Then the response status is 400
    And the response error code is "EMAIL_TOKEN_INVALID"

  @auth @backend @AC-22
  Scenario: An expired verification token is refused and distinguishable from an unknown one
    Given a registered unverified account exists for "stale@example.com"
    And a verification token was issued for "stale@example.com" 25 hours ago
    When I confirm email verification with that token
    Then the response status is 400
    And the response error code is "EMAIL_TOKEN_EXPIRED"
    And the account for "stale@example.com" has no verified email
    When I confirm email verification with token "never-issued"
    Then the response status is 400
    And the response error code is "EMAIL_TOKEN_INVALID"

  @auth @backend @AC-23
  Scenario: Two concurrent confirmations of one token yield exactly one success
    Given a registered unverified account exists for "race@example.com"
    And a valid verification token was issued for "race@example.com"
    When I confirm email verification with that token twice concurrently
    Then exactly one response status is 200
    And exactly one response error code is "EMAIL_TOKEN_INVALID"
    And the account for "race@example.com" has a verified email

  @auth @backend @AC-24
  Scenario: Resending is cooldown-limited and then rate-limited
    Given a registered unverified account exists for "resend@example.com"
    When I request a verification resend
    Then the response status is 202
    And the response carries a cooldown of 60 seconds
    When I request a verification resend
    Then the response status is 429
    And the response error code is "EMAIL_RESEND_COOLDOWN"
    And the response carries the remaining cooldown seconds
    When the cooldown elapses and I request 5 verification resends
    Then the last response status is 429
    And the last response error code is "RATE_LIMITED"

  @auth @backend @AC-29
  Scenario: The verification gate applies to interview start only, and only when required
    Given email verification is required
    And a registered unverified account exists for "gated@example.com"
    When I set up an interview with 8 questions
    Then the response status is 403
    And the response error code is "EMAIL_NOT_VERIFIED"
    And no interview exists for "gated@example.com"
    When I fetch GET "/me/interviews" with that session
    Then the response status is 200
    When I confirm email verification with a valid token for "gated@example.com"
    And I set up an interview with 8 questions
    Then the response status is 201

  @auth @backend @AC-29
  Scenario: With the gate off an unverified account can interview
    Given email verification is not required
    And a registered unverified account exists for "ungated@example.com"
    When I set up an interview with 8 questions
    Then the response status is 201

  @auth @backend @AC-22
  Scenario: Google sign-in with a verified email marks our account verified
    Given a password account exists for "google@example.com"
    And the account for "google@example.com" has no verified email
    When Google sign-in completes for "google@example.com" with email_verified true
    Then the response creates a signed-in session for "google@example.com"
    And the account for "google@example.com" has a verified email
