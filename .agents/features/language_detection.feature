Feature: Server-side language detection

  @language-detection @ai @AC-13
  Scenario Outline: Language classification runs without an LLM call
    Given an interview whose language is "en"
    When I submit an answer whose text is <textKind>
    Then no llm_calls row is recorded for the language classification
    And the classified language is "<language>"
    And the classification ambiguous flag is <ambiguous>
    And the turn <counts> toward a language switch

    Examples:
      | textKind                | language | ambiguous | counts         |
      | clear Turkish stop-words| tr       | false     | counts         |
      | clear English stop-words| en       | false     | counts         |
      | below the detection margin | en    | true      | does not count |

  @language-detection @ai @AC-13
  Scenario: A below-margin turn does not advance a language switch
    Given an interview whose language is "en"
    When I submit a clear Turkish answer
    And I submit a below-margin answer
    Then the interview language is still "en"
    When I submit two consecutive clear Turkish answers
    Then the interview language becomes "tr"
    And no llm_calls row was recorded for any language classification
