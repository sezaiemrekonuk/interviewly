Feature: User authentication

  @auth @backend @AC-1
  Scenario: Password registration creates only valid accounts
    When I register with email "short@example.com" and password "123456789"
    Then the response status is 422
    And the response error code is "PASSWORD_TOO_SHORT"
    And no user exists for "short@example.com"
    When I register with email "valid@example.com" and password "1234567890"
    Then the response status is 201
    And a session cookie is set
    When I fetch GET "/me" with that session
    Then the response status is 200
    And the current user email is "valid@example.com"

  @auth @backend @AC-2
  Scenario: Email uniqueness is case-insensitive
    Given a password account exists for "case@example.com"
    When I register with email "CASE@example.com" and password "1234567890"
    Then the response status is 409
    And the response error code is "EMAIL_TAKEN"
    And exactly one user exists for "case@example.com"

  @auth @backend @AC-3
  Scenario: Password login issues a session only for valid credentials
    Given a password account exists for "login@example.com" with password "1234567890"
    When I log in with email "login@example.com" and password "wrong-password"
    Then the response status is 401
    And the response error code is "INVALID_CREDENTIALS"
    And no session cookie is set
    When I log in with email "login@example.com" and password "1234567890"
    Then the response status is 200
    And a session cookie is set
    When I fetch GET "/me" with that session
    Then the response status is 200
    And the current user email is "login@example.com"

  @auth @backend @AC-5
  Scenario: Google links password accounts only with verified email
    Given a password account exists for "link@example.com"
    When Google sign-in completes for "link@example.com" with email_verified false
    Then the response status is 403
    And the response error code is "ACCOUNT_LINK_REQUIRES_PASSWORD"
    And no session cookie is set
    And the account for "link@example.com" is not linked to Google
    When Google sign-in completes for "link@example.com" with email_verified true
    Then the response creates a signed-in session for "link@example.com"
    And the account for "link@example.com" is linked to Google

  @auth @backend @AC-5
  Scenario: An unconfigured Google never paints an error body as a page
    Given no Google client credentials are configured
    When I fetch GET "/auth/capabilities"
    Then the response status is 200
    And the response reports Google sign-in as unavailable
    When I fetch GET "/auth/google"
    Then the response redirects to "/sign-in?error=NOT_READY"
    And the response body is not an error envelope

  @auth @backend @AC-5
  Scenario: A callback with no state cookie returns to the form, not to a JSON body
    When I fetch GET "/auth/google/callback?code=abc&state=def"
    Then the response redirects to "/sign-in?error=OAUTH_STATE_MISMATCH"
    And the response body is not an error envelope
