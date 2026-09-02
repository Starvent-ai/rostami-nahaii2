import { useEffect } from 'react';
import { useStore } from '../store/useStore';

/**
 * Subscribes to main-process push events for the given domains and calls
 * `onChange` whenever one of them mutates — this is what makes every module
 * update live without a manual refresh (spec §10).
 */
export function useClubEvent(domains: string[], onChange: () => void) {
  useEffect(() => {
    onChange();
    const off = window.api.onEvent((e) => {
      if (e.domains.some((d) => domains.includes(d))) onChange();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domains.join(',')]);
}

/** Global listener for 'notification' events → pushes a toast (mounted once at app root). */
export function useNotificationBridge() {
  const pushToast = useStore((s) => s.pushToast);
  useEffect(() => {
    return window.api.onEvent((e) => {
      if (e.domains.includes('notification') && e.payload) {
        const p = e.payload as { title: string; body: string; level: 'info' | 'warning' | 'danger' };
        pushToast(p);
      }
    });
  }, [pushToast]);
}
