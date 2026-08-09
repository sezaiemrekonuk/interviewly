Feature: Adaptive question selection

  @adaptive-questions @ai @AC-12
  Scenario Outline: The answer score drives the next question's difficulty and topic
    Given the current question has topic "sql-indexes" and difficulty "<difficulty>"
    And the stub AI scores the submitted answer <overall>
    When I submit the current answer for adaptive scoring
    Then the response status is 200
    And the scored answer validates against the Scores schema
    And the next question difficulty is "<nextDifficulty>"
    And the next question topic is "<topicRelation>" the current topic
    And the next question chosen_reason is "<reason>"

    Examples:
      | difficulty | overall | nextDifficulty | topicRelation  | reason     |
      | medium     | 20      | easy           | the same as    | score_low  |
      | medium     | 60      | medium         | the same as    | score_mid  |
      | medium     | 100     | hard           | different from | score_high |
      | hard       | 100     | hard           | different from | score_high |
      | easy       | 0       | easy           | the same as    | score_low  |

  @adaptive-questions @ai @AC-12
  Scenario: The turn generates the candidate pool it promotes from
    Given the current question has topic "sql-indexes" and difficulty "medium" and no candidate pool
    And the stub AI scores the submitted answer 100
    When I submit the current answer for adaptive scoring
    Then the next question carries a candidate pool
    And the next question chosen_reason is "score_high"
    And the next question difficulty is "hard"
    And the next question is not the one the round generated

  @adaptive-questions @ai @AC-12
  Scenario: A malformed answer score never selects a graded next question
    Given the current question has topic "sql-indexes" and difficulty "medium"
    And the stub AI is configured to return a score with overall 101
    When I submit the current answer for adaptive scoring
    Then no answer score is handed back
    And a "LLM_FALLBACK_TRIGGERED" event is emitted
    And the next question chosen_reason is "fallback"
