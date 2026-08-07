Feature: Account language (issue 76)

  `users.locale` is the language of the two surfaces the browser does not render: the
  verification/reset mail, and the interview. The switcher used to write only a `NEXT_LOCALE`
  cookie, so the column sat at its "en" default for every account ever created and a Turkish
  user got Turkish UI copy wrapped around English mail and an English interview.

  The interview half is asserted here only as far as the auth ring reaches — the column.
  `interview/setup.ts` reads `req.user!.locale` into `interviews.language` unconditionally, and
  the ring that can create an interview is AiWorld, which cannot share a cucumber World with
  this one (ADR-A04-3).

  @auth @backend @locale
  Scenario: Switching the language persists it on the account
    Given I am signed in as "switcher@example.com"
    When I switch my language to "tr"
    Then the response status is 200
    When I fetch GET "/me" with that session
    Then the response status is 200
    And the current user locale is "tr"
    And the stored locale for "switcher@example.com" is "tr"

  @auth @backend @locale
  Scenario: Mail sent after the switch is queued in the chosen language
    Given I am signed in as "mailswitch@example.com"
    And I switch my language to "tr"
    When I request a password reset for "mailswitch@example.com"
    Then the queued mail for "mailswitch@example.com" carries locale "tr"

  @auth @backend @locale
  Scenario: A language chosen before registering is stored on the new account
    When I register with email "trnew@example.com" and password "1234567890" in locale "tr"
    Then the response status is 201
    And the stored locale for "trnew@example.com" is "tr"
    And the queued mail for "trnew@example.com" carries locale "tr"

  @auth @backend @locale
  Scenario: Registering without a language keeps the default
    When I register with email "endefault@example.com" and password "1234567890"
    Then the response status is 201
    And the stored locale for "endefault@example.com" is "en"

  @auth @backend @locale
  Scenario: An anonymous visitor is refused the account write, not the cookie
    When I switch my language to "tr" with no session
    Then the response status is 401
    And the response error code is "UNAUTHENTICATED"

  @auth @backend @locale
  Scenario: A locale with no messages file is refused and nothing is written
    Given I am signed in as "badlocale@example.com"
    When I switch my language to "de"
    Then the response status is 422
    And the response error code is "VALIDATION_ERROR"
    And the stored locale for "badlocale@example.com" is "en"
