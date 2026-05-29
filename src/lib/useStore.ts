import { useSyncExternalStore } from 'react';
import { subscribe, getSnapshot } from './store';

export function useStore() {
  return useSyncExternalStore(subscribe, getSnapshot);
}
