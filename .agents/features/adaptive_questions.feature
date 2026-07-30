Feature: Adaptive question selection

  @adaptive-questions @ai @AC-12
  Scenario Outline: The answer score drives the next question's difficulty and topic
    Given the current question has topic "sql-indexes" and difficulty "<difficulty>"
    And the stub AI scores the submitted answer <overall>
    When I submit an answer for the current question
    Then the response status is 200
    And the scored answer validates against the Scores schema
    And the next question difficulty is "<nextDifficulty>"
    And the next question topic is "<topicRelation>" the current topic
    And the next question chosen_reason is "<reason>"

    Examples:
      | difficulty | overall | nextDifficulty | topicRelation  | reason     |
      | medium     | 1       | easy           | the same as    | score_low  |
      | medium     | 3       | medium         | the same as    | score_mid  |
      | medium     | 5       | hard           | different from | score_high |
      | hard       | 5       | hard           | different from | score_high |
      | easy       | 0       | easy           | the same as    | score_low  |

  @adaptive-questions @ai @AC-12
  Scenario: A malformed answer score never selects a graded next question
    Given the current question has topic "sql-indexes" and difficulty "medium"
    And the stub AI is configured to return a score with overall 9
    When I submit an answer for the current question
    Then no answer score is handed back
    And a "LLM_FALLBACK_TRIGGERED" event is emitted
    And the next question chosen_reason is "fallback"
