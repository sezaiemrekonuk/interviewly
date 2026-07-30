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
