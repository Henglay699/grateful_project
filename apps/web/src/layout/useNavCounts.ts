import { useQuery } from '@tanstack/react-query';
import type { NavCounts } from '@gs/shared';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';

export function useNavCounts() {
  return useQuery({
    queryKey: queryKeys.navCounts,
    queryFn: () => api<NavCounts>('/meta/nav-counts'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
