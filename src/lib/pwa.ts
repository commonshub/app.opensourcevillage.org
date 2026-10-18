/**
 * PWA utilities for service worker registration and management
 */

/**
 * Register the service worker
 * Should be called in the app layout or main entry point
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  // Check if service workers are supported
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    console.log('[PWA] Service workers not supported');
    return null;
  }

  try {
    // Register the service worker
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    });

    console.log('[PWA] Service worker registered:', registration.scope);

    // Check for updates on page load
    registration.update();

    // Listen for updates
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;

      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New version available
            console.log('[PWA] New version available');
            notifyUpdate(registration);
          }
        });
      }
    });

    // Handle controller change (new service worker activated). The first
    // install also takes control of the page; that needs no reload.
    let refreshing = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !refreshing) {
        refreshing = true;
        console.log('[PWA] Controller changed, reloading...');
        window.location.reload();
      }
    });

    return registration;
  } catch (error) {
    console.error('[PWA] Service worker registration failed:', error);
    return null;
  }
}

/**
 * Unregister all service workers
 * Useful for development or troubleshooting
 */
export async function unregisterServiceWorker(): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();

    if (registration) {
      await registration.unregister();
      console.log('[PWA] Service worker unregistered');
      return true;
    }

    return false;
  } catch (error) {
    console.error('[PWA] Failed to unregister service worker:', error);
    return false;
  }
}

/**
 * Notify user about available update
 * Shows a prompt to reload the app
 */
function notifyUpdate(registration: ServiceWorkerRegistration): void {
  // Create a custom event that the app can listen to
  const event = new CustomEvent('sw-update-available', {
    detail: { registration },
  });
  window.dispatchEvent(event);

  // Optional: Show a simple confirmation dialog
  const shouldUpdate = window.confirm(
    'A new version of Open Source Village is available. Reload to update?'
  );

  if (shouldUpdate && registration.waiting) {
    // Tell the service worker to skip waiting
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }
}

/**
 * Check if the app is running in standalone mode (installed as PWA)
 */
export function isPWAInstalled(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  // Check if running in standalone mode
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

  // Check iOS standalone mode
  const isIOSStandalone = (navigator as any).standalone === true;

  return isStandalone || isIOSStandalone;
}

/**
 * Check if the app is installable
 */
export function canInstallPWA(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  // This will be set by the beforeinstallprompt event
  return (window as any).__pwaInstallPrompt !== undefined;
}

/**
 * Show the PWA install prompt
 * Returns true if the prompt was shown, false otherwise
 */
export async function showInstallPrompt(): Promise<boolean> {
  if (typeof window === 'undefined') {
    return false;
  }

  const deferredPrompt = (window as any).__pwaInstallPrompt;

  if (!deferredPrompt) {
    console.log('[PWA] Install prompt not available');
    return false;
  }

  try {
    // Show the install prompt
    deferredPrompt.prompt();

    // Wait for the user to respond
    const { outcome } = await deferredPrompt.userChoice;

    console.log('[PWA] Install prompt outcome:', outcome);

    // Clear the saved prompt
    (window as any).__pwaInstallPrompt = null;

    return outcome === 'accepted';
  } catch (error) {
    console.error('[PWA] Failed to show install prompt:', error);
    return false;
  }
}

/**
 * Setup PWA install prompt capture
 * Should be called early in the app lifecycle
 */
export function setupInstallPrompt(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the default install prompt
    e.preventDefault();

    // Save the event for later use
    (window as any).__pwaInstallPrompt = e;

    console.log('[PWA] Install prompt available');

    // Dispatch custom event that the app can listen to
    const event = new CustomEvent('pwa-installable');
    window.dispatchEvent(event);
  });

  window.addEventListener('appinstalled', () => {
    console.log('[PWA] App installed');

    // Clear the saved prompt
    (window as any).__pwaInstallPrompt = null;

    // Dispatch custom event
    const event = new CustomEvent('pwa-installed');
    window.dispatchEvent(event);
  });
}

/**
 * Check if the app is online
 */
export function isOnline(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }

  return navigator.onLine;
}

/**
 * Setup online/offline event listeners
 * Calls the provided callbacks when network status changes
 */
export function setupNetworkListeners(
  onOnline?: () => void,
  onOffline?: () => void
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleOnline = () => {
    console.log('[PWA] Network online');
    onOnline?.();
  };

  const handleOffline = () => {
    console.log('[PWA] Network offline');
    onOffline?.();
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  // Return cleanup function
  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}

/**
 * Request notification permission
 * Returns the permission status
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }

  if (Notification.permission === 'granted') {
    return 'granted';
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission;
  }

  return Notification.permission;
}

/**
 * Show a local notification
 * Requires notification permission
 */
export async function showNotification(
  title: string,
  options?: NotificationOptions
): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }

  // Check permission
  if (Notification.permission !== 'granted') {
    console.log('[PWA] Notification permission not granted');
    return false;
  }

  try {
    // Get service worker registration
    const registration = await navigator.serviceWorker.getRegistration();

    if (registration) {
      // Show notification via service worker (persists across tabs)
      await registration.showNotification(title, {
        icon: '/icons/icon-192x192.png',
        badge: '/icons/badge-72x72.png',
        ...options,
      });
    } else {
      // Fallback to regular notification
      new Notification(title, options);
    }

    return true;
  } catch (error) {
    console.error('[PWA] Failed to show notification:', error);
    return false;
  }
}

/**
 * Clear all caches
 * Useful for debugging or after logout
 */
export async function clearAllCaches(): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) {
    return;
  }

  try {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames.map((cacheName) => caches.delete(cacheName))
    );
    console.log('[PWA] All caches cleared');
  } catch (error) {
    console.error('[PWA] Failed to clear caches:', error);
  }
}

/**
 * Get cache storage estimate
 * Returns information about storage usage
 */
export async function getStorageEstimate(): Promise<{
  usage: number;
  quota: number;
  percentage: number;
} | null> {
  if (typeof window === 'undefined' || !('storage' in navigator) || !navigator.storage.estimate) {
    return null;
  }

  try {
    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage || 0;
    const quota = estimate.quota || 0;
    const percentage = quota > 0 ? (usage / quota) * 100 : 0;

    return {
      usage,
      quota,
      percentage,
    };
  } catch (error) {
    console.error('[PWA] Failed to get storage estimate:', error);
    return null;
  }
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Check if PWA features are supported
 */
export function checkPWASupport(): {
  serviceWorker: boolean;
  manifest: boolean;
  notifications: boolean;
  backgroundSync: boolean;
  push: boolean;
} {
  if (typeof window === 'undefined') {
    return {
      serviceWorker: false,
      manifest: false,
      notifications: false,
      backgroundSync: false,
      push: false,
    };
  }

  return {
    serviceWorker: 'serviceWorker' in navigator,
    manifest: 'onbeforeinstallprompt' in window,
    notifications: 'Notification' in window,
    backgroundSync: 'serviceWorker' in navigator && 'SyncManager' in window,
    push: 'serviceWorker' in navigator && 'PushManager' in window,
  };
}
