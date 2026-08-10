'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { createQueryClient } from '../../lib/query';

export function Providers({ children }: { children: ReactNode }) {
  // Created in state, not at module scope: a module-level client is shared across requests
  // on the server and would leak one user's cached `/me` into another's render.
  const [queryClient] = useState(createQueryClient);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
