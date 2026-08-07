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

  @question-generation @backend @AC-6
  Scenario: An oversized question count is refused before an interview exists
    Given I am signed in as a candidate
    # The UI only ever offers 6, 8 or 10. Unbounded, the request body sized the single provider
    # call that generates a round, so one authenticated request could ask for 4000 questions
    # (issue #98).
    When I start an interview with a "Backend Developer" listing and 10000 target questions
    Then the response status is 422
    And the response error code is "VALIDATION_ERROR"
    And no interview is created
    And the database refuses a direct insert of 10000 target questions
    When I start an interview with a "Backend Developer" listing and 8 target questions
    Then the response status is 201
    And the interview has hrQuestionCount 3
    And the interview has techQuestionCount 5

  @question-generation @backend @AC-6
  Scenario: The bound is inclusive at 20 and refuses 21
    # A fresh candidate per scenario, and only two attempts here: the daily cap is 5 rolling
    # interviews and a rejected attempt burns a slot too (rate-limit.ts).
    Given I am signed in as a candidate
    When I start an interview with a "Backend Developer" listing and 21 target questions
    Then the response status is 422
    And the response error code is "VALIDATION_ERROR"
    And no interview is created
    When I start an interview with a "Backend Developer" listing and 20 target questions
    Then the response status is 201
    And the interview has hrQuestionCount 8
    And the interview has techQuestionCount 12

  @question-generation @backend @AC-7
  Scenario: An interview with no budget left never buys its HR batch
    Given I set up an interview with 8 questions
    And the interview spent_usd equals its budget_usd inside the next AI transaction
    # The technical batch has always run under I08's ceiling; the HR round — the larger call,
    # and the first one — did not, so the budget was a ceiling with a hole in it (issue #98).
    When I POST "/interviews/:id/profile" for the profiling interview
    Then the response status is 402
    And the response error code is "BUDGET_EXCEEDED"
    And no HR questions exist for that interview
    And no AI call is recorded for that submission
    And the interview state is "evaluating"
    And the interview endedReason is "budget_exhausted"

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

  @question-generation @backend @AC-7
  Scenario: An interview stranded in hr_round with no batch can still be rebuilt
    Given I set up an interview with 8 questions
    # What is left when the pause itself fails to write (INTERVIEW_PAUSE_FAILED) or the process
    # dies between the profile transition and its generation: a round with nothing to ask.
    And the interview is left in "hr_round" with no questions
    When I POST "/interviews/:id/resume" for that interview
    Then the response status is 200
    And exactly 3 questions exist for the HR round
    And the interview state is "hr_round"

  @question-generation @backend @AC-7
  Scenario: An interview parked in profiling can still be started from the room
    Given I set up an interview with 8 questions
    # The setup screen is the only caller of POST /profile. When it never ran — the tab was
    # closed, the call failed — history's Continue link lands the candidate in a room waiting
    # on a batch nothing is generating, and only this endpoint can start it.
    When I POST "/interviews/:id/resume" for that interview
    Then the response status is 200
    And exactly 3 questions exist for the HR round
    And the interview state is "hr_round"

  @question-generation @backend @AC-7
  Scenario: The room is nudged again once the HR batch exists
    Given I set up an interview with 8 questions
    And the room is listening on the interview event stream
    # POST /profile claims profiling → hr_round before it calls the model — the claim is what
    # makes concurrent requests safe — so the transition's nudge reaches a client whose refetch
    # still finds currentQuestion: null. Without a second event the room waits on a question it
    # already has, until the candidate reloads (issue #54).
    When I POST "/interviews/:id/profile" for the profiling interview
    Then the response status is 200
    And exactly 3 questions exist for the HR round
    And the room is nudged once the HR questions exist

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
