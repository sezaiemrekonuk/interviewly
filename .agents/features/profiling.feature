Feature: Candidate profiling personalises generation

  @profiling @ai @AC-2
  Scenario: A skipped profile compiles to the explicit no-profile marker
    Given I set up an interview with 8 questions
    And I skip the profiling questions
    When the HR round is generated
    Then the response status is 200
    And the compiled user message contains the block "<candidate_profile>no profile provided</candidate_profile>"
    And the compiled user message contains no empty "<candidate_profile></candidate_profile>" block
    And the recorded AI prompt name is "interview.question.generate"
    When I set up another interview with 8 questions
    And I answer the profiling questions with 2 years of experience
    And the HR round is generated
    Then the response status is 200
    And the compiled user message carries the answered profile inside the candidate_profile block
    And the candidate_profile block content is not "no profile provided"

  @profiling @ai @AC-2 @AC-4a
  Scenario: A missing CV compiles to the explicit no-cv marker
    Given I am signed in as "nocv@example.com"
    And my account profile has no cv text
    And I set up an interview with 8 questions
    When I answer the profiling questions with 2 years of experience
    And the HR round is generated
    Then the response status is 200
    And the compiled user message contains the block "<candidate_cv>no cv provided</candidate_cv>"
    And the compiled user message contains no empty "<candidate_cv></candidate_cv>" block

  @profiling @ai @AC-3b
  Scenario: A date of birth is stripped before any prompt is compiled
    Given I am signed in as "dob@example.com"
    And my account profile has a full name and a date of birth
    And I set up an interview with 8 questions
    When I answer the profiling questions with 2 years of experience
    And the HR round is generated
    Then the response status is 200
    And the compiled user message carries the account full name inside the candidate_profile block
    And the compiled user message contains no date of birth
    When the report is generated for that interview
    Then the compiled user message contains no date of birth

  @profiling @ai @AC-4a
  Scenario: The CV reaches report generation as data
    Given I am signed in as "cvreport@example.com"
    And my account profile has cv text
    And I completed an 8-question interview
    When the report is generated for that interview
    Then the response status is 200
    And the compiled user message carries the cv text inside the candidate_cv block
    And the recorded AI prompt name is "interview.report.generate"
