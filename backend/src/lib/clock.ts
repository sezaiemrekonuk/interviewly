// The server clock behind one indirection. `answers.duration_ms` is measured from it and
// never from a client timestamp (I06, @AC-10), so the acceptance suite fixes `now` here
// instead of faking global `Date` under Prisma.
export const clock = { now: () => new Date() };
