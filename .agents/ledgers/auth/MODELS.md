# Auth — Recommended Model Per Task

Auth is a security invariant. Every task that touches credential verification, password
hashing, session-token issuance, or the OAuth-link trust boundary runs at the expensive
tier. The frontend form task is pure UI wiring and runs at the moderate tier.

| ID | Title | Model | Why |
|----|-------|-------|-----|
| A01 | Creating the backend auth module: register, login, logout, session cookie, and `/me` | `claude-opus-4.8` | Credential verification + argon2id hashing + session token issuance — security invariant |
| A02 | Adding Google OAuth (arctic PKCE), account linking, and admin password restriction | `claude-opus-4.8` | OAuth trust boundary + admin restriction enforcement — security invariant |
| A03 | Building the frontend login and register forms | `claude-sonnet-4.6` | Pure UI form wiring over existing API; no new trust boundary |

## Summary

- **`claude-opus-4.8` (2 tasks):** A01, A02
- **`claude-sonnet-4.6` (1 task):** A03

Rule of thumb: **auth + session issuance + OAuth trust boundary = expensive tier.** When
unsure on A03 if an edge case arises, run A03 with sonnet and code-review the diff with
`claude-opus-4.8` — cheaper than running the whole task expensive. Never use haiku, mini,
or flash for any auth ledger task.
