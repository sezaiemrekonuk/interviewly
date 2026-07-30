Feature: Account onboarding profile

  Three cards build `users.profile` once per account (IDEA.md §3.3 layer 1). Each card saves on
  its own so an abandoned flow loses nothing, and the merge into an interview is a snapshot.

  @onboarding @backend @AC-30
  Scenario: Each card saves independently and later cards do not erase earlier ones
    Given I am signed in as "cards@example.com"
    When I save onboarding card 1 with a full name and job title
    Then the response status is 200
    When I save onboarding card 2 with 2 education rows
    Then the response status is 200
    When I fetch GET "/me/profile" with that session
    Then the response status is 200
    And the profile carries the card 1 full name and job title
    And the profile carries 2 education rows
    When I save onboarding card 1 with a different job title
    Then the response status is 200
    And the profile still carries 2 education rows

  @onboarding @backend @AC-31
  Scenario: An abandoned flow resumes from the server profile
    Given I am signed in as "resume@example.com"
    And I save onboarding card 1 with a full name and job title
    When I sign out and sign in again as "resume@example.com"
    And I fetch GET "/me" with that session
    Then the response status is 200
    And the current user has not completed onboarding
    When I fetch GET "/me/profile" with that session
    Then the profile carries the card 1 full name and job title
    And the profile carries no education rows

  @onboarding @backend @AC-31
  Scenario: Skipping completes onboarding with a partial profile and no error
    Given I am signed in as "skipper@example.com"
    When I complete onboarding without saving any card
    Then the response status is 200
    When I fetch GET "/me" with that session
    Then the current user has completed onboarding
    When I fetch GET "/me/profile" with that session
    Then the response status is 200
    And the profile carries no full name

  @onboarding @backend @AC-30
  Scenario: Education rows are capped at five
    Given I am signed in as "rows@example.com"
    When I save onboarding card 2 with 5 education rows
    Then the response status is 200
    When I save onboarding card 2 with 6 education rows
    Then the response status is 422
    And the response error code is "VALIDATION_ERROR"
    And the profile carries 5 education rows

  @onboarding @backend @AC-32
  Scenario: A CV upload is retained privately and its text is cached on the profile
    Given I am signed in as "cv@example.com"
    When I upload a valid PDF with kind "cv"
    Then the response status is 201
    And the response carries an upload id with kind "cv"
    And the current user's cv upload id is that upload
    And the profile carries cv text
    And the stored object for that upload is not publicly readable
    And a signed URL for that upload reads the object

  @onboarding @backend @AC-32
  Scenario: An oversized CV is truncated rather than rejected
    Given I am signed in as "bigcv@example.com"
    When I upload a valid PDF with kind "cv" whose extracted text is 20000 characters
    Then the response status is 201
    And the profile cv text is exactly 12000 characters
    And a log event "CV_TRUNCATED" was emitted

  @onboarding @backend @AC-33
  Scenario: The interview profile is a merged snapshot without the date of birth
    Given I am signed in as "merge@example.com"
    And my account profile has a full name, a date of birth and cv text
    And I set up an interview with 8 questions
    When I answer the profiling questions with 2 years of experience
    Then the response status is 200
    And the interview candidate profile carries the account full name
    And the interview candidate profile carries the cv text
    And the interview candidate profile carries the per-interview answers
    And the interview candidate profile carries no date of birth
    And the compiled user message contains no date of birth

  @onboarding @backend @AC-34
  Scenario: Editing the account profile does not rewrite an existing interview snapshot
    Given I am signed in as "frozen@example.com"
    And my account profile has a full name
    And I set up an interview with 8 questions
    And I answer the profiling questions with 2 years of experience
    When I save onboarding card 1 with a different full name
    Then the response status is 200
    And the interview candidate profile still carries the original full name

  @onboarding @backend @AC-35
  Scenario: The routing inputs come from one server answer
    Given I am signed in as "routing@example.com"
    When I fetch GET "/me" with that session
    Then the response status is 200
    And the response carries the onboarding completion, email verification and interview count
