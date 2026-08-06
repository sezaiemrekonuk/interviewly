Feature: Question generation

  @question-generation @backend @AC-6
  Scenario: Interview setup fixes the HR and technical split
    Given I am signed in as a candidate
    When I POST "/interviews" with neither jobText nor uploadId
    Then the response status is 422
    And the response error code is "LISTING_REQUIRED"
    And no interview is created
    When I start an interview with a "Backend Developer" listing and 8 target questions
    Then the response status is 201
    And the interview state is "profiling"
    And the interview has hrQuestionCount 3
    And the interview has techQuestionCount 5

  @question-generation @backend @AC-7
  Scenario: HR generation inserts only the first round
    Given I set up an interview with 8 questions
    When I POST "/interviews/:id/profile" for an interview that is not in "profiling"
    Then the response status is 409
    And the response error code is "INVALID_STATE_TRANSITION"
    And no HR questions exist for that interview
    When I POST "/interviews/:id/profile" for the profiling interview
    Then the response status is 200
    And exactly 3 questions exist for the HR round
    And the HR questions are ordered 1 to 3
    And the technical round has no questions yet
    And the interview state is "hr_round"
    And the recorded AI prompt name is "interview.question.generate"

  @question-generation @backend @AC-7
  Scenario: A short batch leaves the interview where a resume can retry it
    Given I set up an interview with 8 questions
    And the stub AI shorts the next batch by one question
    When I POST "/interviews/:id/profile" for the profiling interview
    Then the response status is 500
    And the response error code is "AI_OUTPUT_INVALID"
    And no HR questions exist for that interview
    # The transition to hr_round was already claimed before generation ran (concurrency
    # guard), so a short batch pauses rather than stranding the interview mid-transition —
    # `paused` is the legal, resumable edge `machine.ts` already models for this failure.
    And the interview state is "paused"
    When the stub AI is configured to return a schema-valid batch of 3 questions
    And I POST "/interviews/:id/resume" for the paused interview
    Then the response status is 200
    And exactly 3 questions exist for the HR round
    And the interview state is "hr_round"

  @question-generation @ai @AC-1
  Scenario: A generated round returns exactly the requested count of typed questions
    Given I set up an interview with 8 questions
    And the profiling round is complete
    And the stub AI is configured to return 4 questions for a requested 5
    When the technical round of 5 questions is generated
    Then no questions are handed back to the interview
    And the response error code is "AI_OUTPUT_INVALID"
    And no questions exist for the technical round
    When the stub AI is configured to return a schema-valid batch of 5 questions
    And the technical round of 5 questions is generated
    Then the response status is 200
    And exactly 5 questions exist for the technical round
    And each generated question has a kind in "open, behavioral, technical, widget"
    And each generated question has a difficulty in "easy, medium, hard"
    And the technical questions are ordered 1 to 5
    And the recorded AI prompt name is "interview.question.generate"
