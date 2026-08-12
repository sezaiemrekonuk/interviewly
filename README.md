<div align="center">

# Interviewly

**Practise the interview before it counts, and leave with a written account of how it went.**

Paste the job listing you're preparing for. The role is classified from it, the questions are
written from it, and two interviewers take a round each — **Ada** for HR, then **Turing** for
technical. Answer by speaking or typing. Every answer is scored with a written reason, and a
report lands at the end.

[![CI](https://github.com/OBSS-AI-Summer-Internship-2026/Group-6/actions/workflows/ci.yml/badge.svg)](https://github.com/OBSS-AI-Summer-Internship-2026/Group-6/actions/workflows/ci.yml)
![Next.js 16](https://img.shields.io/badge/Next.js-16-000)
![Express 5](https://img.shields.io/badge/Express-5-444)
![Postgres 16](https://img.shields.io/badge/Postgres-16-336791)
![EN · TR](https://img.shields.io/badge/i18n-EN%20%C2%B7%20TR-0a7)

[Setup](SETUP.md) · [Architecture & decisions](DECISIONS.md) · [How it was built](AI_DEVLOG.md)

</div>

---

## Try it

```bash
cp .env.example .env
docker compose -f compose.yaml -f compose.dev.yaml up -d --build
npm install && npm run prisma:generate
DATABASE_URL=postgresql://interviewly:interviewly@localhost:5432/interviewly \
S3_ENDPOINT=http://localhost:9000 npm run seed
```

Then open <http://localhost> and sign in as **admin@demo.com** / **AdminDemo1!**.

No API keys needed — the stack boots on a stub client with canned content, which walks every
screen. [SETUP.md](SETUP.md) covers turning on real generation, the ports, the tests, the logs,
and the handful of things that trip people up.

## What it does

**For the candidate**

- Paste a listing as free text or upload a PDF; pick 6, 8 or 10 questions
- A pre-join device check, then a real room: audio-first, captions, leave
- Answer by voice or by typing — a model decides when your turn is over, not a fixed countdown
- Two personas with different standards: Ada wants the story to be yours, Turing wants method
- Per-question scores with written reasons, strengths, gaps, full transcript, PDF export
- Pause and resume; switch language mid-interview; EN and TR at full parity

**For the operator (`/admin`)**

- Every interview, including deleted ones, still marked as deleted
- Tokens and dollars spent per interview, per user, per day
- Interviews by profession, average duration, completion rate, failure rates
- A filter builder over the list grammar, and a security/audit feed

## How it's put together

```
Browser ──:80──▶ Caddy ──▶ Next.js (web)
                    └────▶ Express (api) ──▶ Postgres · Redis · MinIO
                                   └──────▶ @interviewly/ai ──▶ OpenAI → Gemini
                            Redis ──jobs──▶ Worker (reports, PDF, mail, sweeper)
```

The server owns the truth of a session — round, question index, active persona, remaining budget.
The client renders that state and never derives it, which is what makes reload, pause/resume and
a mid-interview language switch behave the same way.

Diagrams and the reasoning behind each choice live in [DECISIONS.md](DECISIONS.md).

## Layout

```
frontend/      Next.js App Router · React Query · CSS Modules + design tokens
backend/       Express 5 · Prisma 6 · modules/{auth,interview,speech,admin,ai}
worker/        BullMQ jobs — report generation, PDF, mail, abandoned sweeper
packages/ai/   prompt registry (versioned YAML), provider chain, Zod gates, cost accounting
packages/types/ shared types across all three services
db/ edge/      Postgres init, Caddy config
.agents/       specs, Gherkin features, per-area ledgers, 84 task devlogs
```

## Tests

```bash
npm test                  # vitest, all workspaces
npm run typecheck
npm run lint
npm run test:acceptance   # 24 Cucumber feature files, needs the stack up
```

CI runs five jobs on every push: `static`, `build`, `unit`, `acceptance`, `audit`.

## Logs

Debugging runs on **Kibana at <http://localhost:5601>**. It sits behind a Compose profile, so it
needs the profile flag as well as the file:

```bash
docker compose -f compose.yaml -f compose.dev.yaml -f compose.observability.yaml \
  --profile observability up -d
docker compose restart api worker      # the log transport connects once, at boot
```

Create a data view over `interviewly-*` with **`time`** as the time field (not `@timestamp`), then
search by event name or trace:

```
title: "AUTH_LOGIN_FAILED"        level >= 50        msg: "<traceId>"
```

Every log line is `title` (a fixed `UPPER_SNAKE` event name) plus `msg` (the request context —
traceId, userId, method, path — folded into one JSON string). Elasticsearch is not published;
Kibana is the only door. Without it, `docker compose logs -f api worker` has the same lines.

[SETUP.md](SETUP.md#logs-and-debugging--kibana) has the data view walkthrough, the event index by
symptom, and the queries worth keeping.

## Docs

| File | What's in it |
|---|---|
| [SETUP.md](SETUP.md) | Clean-machine install, ports, tests, troubleshooting |
| [DECISIONS.md](DECISIONS.md) | Design, diagrams, and the decisions with their reasoning |
| [AI_DEVLOG.md](AI_DEVLOG.md) | How we used AI, the methodology, what was hard, what we threw away |
| [PRODUCT.md](PRODUCT.md) | Audience, positioning, brand and accessibility commitments |
| [AGENTS.md](AGENTS.md) | Repo conventions, task ownership, things that look like bugs and aren't |
| [frontend/DESIGN.md](frontend/DESIGN.md) | The design system, enforced by tests |
| `.agents/ledgers/*/DECISIONS.md` | All 139 ADRs, in full |

## Team

Built by **Sezai Emre Konuk**, **Mehmet Fatih Top** and **Ahmet Şükrü Kılıç** for the OBSS
AI-Native Internship programme. One owner per area; task IDs carry the prefix.
