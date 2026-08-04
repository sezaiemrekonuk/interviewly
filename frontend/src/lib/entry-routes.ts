// ui §4.1/§4.2 — the closed list of routes the entry gradient grounds. Data, not a
// per-screen judgement call: W02's shell and every screen import this instead of deciding.
export const ENTRY_ROUTES = [
  '/',
  '/register',
  '/sign-in',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
  '/onboarding',
  '/interviews/new',
  '/interviews/[id]/pre-join',
] as const;

export type EntrySurface = 'entry' | 'room';

// ui §4.2 — --shadow-soft is entry-only; the room (and everything else) is limited to
// --shadow-hairline. Keyed by the same surface names task file / REFERENCE use.
export const SURFACE_SHADOW: Record<
  'entry' | 'room' | 'report' | 'dashboard' | 'admin',
  'soft' | 'hairline'
> = {
  entry: 'soft',
  room: 'hairline',
  report: 'hairline',
  dashboard: 'hairline',
  admin: 'hairline',
};
