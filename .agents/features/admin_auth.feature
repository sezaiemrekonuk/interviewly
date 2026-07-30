Feature: Admin sign-in restriction

  @admin-auth @backend @AC-4
  Scenario: Admin accounts can sign in only with password
    Given an account with the admin role exists for "admin@example.com" with password "1234567890"
    When Google sign-in completes for "admin@example.com" with email_verified true
    Then the response status is 403
    And the response error code is "ADMIN_MUST_USE_PASSWORD"
    And no session cookie is set
    When I log in with email "admin@example.com" and password "1234567890"
    Then the response status is 200
    And a session cookie is set
