import { QueryClient } from '@tanstack/react-query';

// Single shared client. Offline persistence (last search survives signal loss)
// is wired in Step 14 with @tanstack/react-query-persist-client + async storage.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Parking eligibility and journeys don't change minute-to-minute; the
      // backend already caches TfL responses, so a few minutes of staleness is fine.
      staleTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
