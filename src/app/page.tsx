'use client';

/**
 * Home page - Main entry point with navigation and nostr feed
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredCredentials } from '@/lib/nostr';
import WelcomeActions from '@/components/WelcomeActions';
import NostrFeed from '@/components/NostrFeed';
import { EVENT } from '@/lib/event';

export default function Home() {
  const router = useRouter();
  const [credentials, setCredentials] = useState<{ username: string; npub: string } | null>(null);

  useEffect(() => {
    const creds = getStoredCredentials();
    setCredentials(creds);
  }, []);

  return (
    <main className="min-h-screen bg-gray-50 pb-20">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {/* Welcome Box with Actions */}
        <WelcomeActions username={credentials?.username} />

        {/* Quick Links */}
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => router.push('/calendar')}
              className="bg-gray-100 text-gray-700 font-medium py-3 px-4 rounded-lg hover:bg-gray-200 transition flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span>Schedule</span>
            </button>

            <button
              onClick={() => router.push('/offers')}
              className="bg-gray-100 text-gray-700 font-medium py-3 px-4 rounded-lg hover:bg-gray-200 transition flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <span>Offers</span>
            </button>

            <button
              onClick={() => router.push('/directory')}
              className="bg-gray-100 text-gray-700 font-medium py-3 px-4 rounded-lg hover:bg-gray-200 transition flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <span>Directory</span>
            </button>

            {credentials ? (
              <button
                onClick={() => router.push(`/profile/${credentials.username}`)}
                className="bg-gray-100 text-gray-700 font-medium py-3 px-4 rounded-lg hover:bg-gray-200 transition flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span>Profile</span>
              </button>
            ) : (
              <button
                onClick={() => router.push('/badge')}
                className="bg-green-600 text-white font-medium py-3 px-4 rounded-lg hover:bg-green-700 transition flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                <span>Join</span>
              </button>
            )}
          </div>
        </div>

        {/* Nostr Feed */}
        <NostrFeed />

        <div className="text-center">
          <p className="text-xs text-gray-500">
            {EVENT.datesLabel}
          </p>
        </div>
      </div>
    </main>
  );
}
