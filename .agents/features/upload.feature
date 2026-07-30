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
