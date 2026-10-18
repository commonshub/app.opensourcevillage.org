'use client';

/**
 * OfflineMapPanel Component
 *
 * Save, update or remove the map of the venue area for offline use
 * (see src/lib/offline-map.ts).
 */

import { useCallback, useEffect, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  offlineMapSupported,
  getOfflineMapInfo,
  saveMapForOffline,
  removeOfflineMap,
  formatBytes,
  type OfflineMapInfo,
  type SaveProgress,
} from '@/lib/offline-map';

interface OfflineMapPanelProps {
  styleUrl: string;
  /** The map, once its style has loaded */
  map: MapLibreMap | null;
  online: boolean;
}

export default function OfflineMapPanel({ styleUrl, map, online }: OfflineMapPanelProps) {
  const [supported, setSupported] = useState(false);
  const [info, setInfo] = useState<OfflineMapInfo | null>(null);
  const [progress, setProgress] = useState<SaveProgress | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSupported(offlineMapSupported());
    setInfo(getOfflineMapInfo());
  }, []);

  const save = useCallback(async () => {
    if (!map) return;
    setFailed(false);
    setProgress({ done: 0, total: 0 });
    try {
      const result = await saveMapForOffline(styleUrl, map.getStyle(), setProgress);
      setFailed(result.failed > 0);
      setInfo(getOfflineMapInfo());
    } catch (err) {
      console.error('[OfflineMapPanel] Saving the map for offline use failed', err);
      setFailed(true);
    } finally {
      setProgress(null);
    }
  }, [map, styleUrl]);

  const remove = useCallback(async () => {
    await removeOfflineMap();
    setInfo(null);
    setFailed(false);
  }, []);

  if (!supported) return null;

  return (
    <div className="bg-white rounded-lg shadow-sm p-4 space-y-2">
      <h2 className="text-sm font-semibold text-gray-900">Offline map</h2>
      <p className="text-xs text-gray-600">
        Mobile data is patchy at FOSDEM. Save the map of these venues (a few MB) while you have Wi-Fi.
      </p>
      {progress ? (
        <div aria-live="polite">
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Saving… {progress.done} / {progress.total || '…'}
          </p>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={!online || !map}
            className="flex-1 bg-gray-900 text-white text-sm font-medium py-2 rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            {info ? 'Update offline map' : 'Save map for offline use'}
          </button>
          {info && (
            <button
              onClick={remove}
              className="shrink-0 border border-gray-300 text-gray-700 text-sm font-medium px-3 py-2 rounded-lg hover:bg-gray-50"
            >
              Remove
            </button>
          )}
        </div>
      )}
      {info && !progress && (
        <p className="text-xs text-green-700">
          Saved {new Date(info.savedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
          {' · '}
          {formatBytes(info.bytes)}
        </p>
      )}
      {failed && (
        <p className="text-xs text-red-600">
          Some parts could not be downloaded. Try again on a better connection.
        </p>
      )}
    </div>
  );
}
