Feature: PDF upload validation

  @upload @backend @AC-14
  Scenario: Only valid PDF uploads create upload handles
    Given I am signed in as a candidate
    When I upload each file to POST "/uploads"
      | fixture                    | expectedStatus | expectedCode             |
      | pdf-over-10mb.pdf          | 413            | UPLOAD_TOO_LARGE         |
      | renamed-text-file.pdf      | 415            | UNSUPPORTED_MEDIA_TYPE   |
      | pdf-31-pages.pdf           | 422            | UPLOAD_TOO_MANY_PAGES    |
      | scanned-short-text.pdf     | 422            | PDF_TEXT_TOO_SHORT       |
    Then each upload is rejected with its expected status and error code
    And no uploadId is returned for any rejected upload
    When I upload "valid-3-page-listing.pdf" to POST "/uploads"
    Then the response status is 201
    And the response contains an uploadId

  @upload @backend @AC-14
  Scenario: The upload kind is required and closed
    Given I am signed in as a candidate
    When I upload "valid-3-page-listing.pdf" to POST "/uploads" with no kind
    Then the response status is 422
    And the response error code is "VALIDATION_ERROR"
    When I upload "valid-3-page-listing.pdf" to POST "/uploads" with kind "resume"
    Then the response status is 422
    And the response error code is "VALIDATION_ERROR"
    When I upload "valid-3-page-listing.pdf" to POST "/uploads" with kind "listing"
    Then the response status is 201
    And the response carries an upload id with kind "listing"

  # Issue #78: the endpoint parsed the listing, spent the text on the length gate and dropped
  # it. `POST /interviews` needs `job_text` NOT NULL, so an upload-only setup was refused and
  # the form asked the candidate to paste what the server had already read. The `cv` half is
  # the deliberate opposite: `attachCv` caches that text server-side, so its uploader is
  # answered with an id alone and the CV never travels back over the wire.
  @upload @backend @AC-14
  Scenario: A listing upload answers with the text it parsed, a CV does not
    Given I am signed in as a candidate
    When I upload "valid-3-page-listing.pdf" to POST "/uploads" with kind "listing"
    Then the response status is 201
    And the response carries the listing's own extracted text
    When I upload "another-valid-listing.pdf" to POST "/uploads" with kind "cv"
    Then the response status is 201
    And the response carries no text

  @upload @db @AC-3
  Scenario: A byte-identical PDF reuses the stored upload instead of duplicating it
    Given I am signed in as a candidate
    When I upload "valid-3-page-listing.pdf" to POST "/uploads"
    Then the response status is 201
    And the response contains an uploadId
    When I upload the byte-identical file "valid-3-page-listing.pdf" again to POST "/uploads"
    Then the response status is 201
    And the returned uploadId equals the first uploadId
    And exactly one uploads record exists for that sha256
    When I upload a different valid PDF "another-valid-listing.pdf" to POST "/uploads"
    Then the response status is 201
    And the returned uploadId differs from the first uploadId
    And a second uploads record exists for the new sha256

  # `uploadId` is the one id in the interview module that arrives in a body instead of as
  # `:id`, so the ownership resolver never saw it (issue #73). Unchecked, an absent id was a
  # foreign-key violation surfacing as a 500 and a foreign id silently attached another
  # candidate's upload. One case per scenario: each is a separate claim and has to be able to
  # fail on its own.

  @upload @upload-ownership @db @AC-73
  Scenario: A nonexistent uploadId is refused before the foreign key is reached
    Given I am signed in as a candidate
    When I start an interview with the "nonexistent" uploadId
    Then the response status is 422
    And the response error code is "VALIDATION_ERROR"
    And no interview is created

  @upload @upload-ownership @db @AC-73
  Scenario: Another candidate's uploadId cannot be attached to my interview
    Given I am signed in as a candidate
    And another candidate has uploaded a job listing
    When I start an interview with the "other candidate's listing" uploadId
    Then the response status is 422
    And the response error code is "VALIDATION_ERROR"
    And no interview is created

  @upload @upload-ownership @db @AC-73
  Scenario: My own CV is not a job listing
    Given I am signed in as a candidate
    And I have uploaded my CV
    When I start an interview with the "own CV" uploadId
    Then the response status is 422
    And the response error code is "VALIDATION_ERROR"
    And no interview is created

  @upload @upload-ownership @db @AC-73
  Scenario: A foreign uploadId and an absent one are one answer
    # A 500 for an id that is absent against a 201 for one that exists told any caller which
    # upload ids are real. Both must now be indistinguishable, status and body.
    Given I am signed in as a candidate
    And another candidate has uploaded a job listing
    When I start an interview with the "nonexistent" uploadId
    And I start an interview with the "other candidate's listing" uploadId
    Then that response is identical to the "nonexistent" uploadId response
    And no interview is created

  @upload @upload-ownership @db @AC-73
  Scenario: An interview accepts the candidate's own listing upload
    Given I am signed in as a candidate
    And I have uploaded a job listing
    When I start an interview with the "own listing" uploadId
    Then the response status is 201
    And the interview jobSource is "upload"
    And the interview references my own upload
