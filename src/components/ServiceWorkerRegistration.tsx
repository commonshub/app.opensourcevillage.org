'use client';

/**
 * Registers public/sw.js so pages and the saved map work offline.
 * Skipped in development, where a cache-first worker would serve stale code.
 */

import { useEffect } from 'react';
import { registerServiceWorker } from '@/lib/pwa';

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      registerServiceWorker();
    }
  }, []);

  return null;
}
