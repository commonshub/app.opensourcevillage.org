'use client';

/**
 * Workshop/Offer detail page with RSVP functionality
 */

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getStoredCredentials } from '@/lib/nostr';
import { useNostrPublisher } from '@/hooks/useNostrPublisher';
import { formatRelativeDate, formatTime } from '@/lib/nostr-events';
import { Offer } from '@/types';
import { VILLAGE_SLUG, mapUrl } from '@/lib/venues';

interface RSVPData {
  count: number;
  userHasRSVP: boolean;
}

export default function OfferDetailPage() {
  const params = useParams();
  const router = useRouter();
  const offerId = params.id as string;
  const { publishNote, publishReaction } = useNostrPublisher();

  const [credentials, setCredentials] = useState<{ username: string; npub: string } | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [rsvpData, setRSVPData] = useState<RSVPData>({ count: 0, userHasRSVP: false });
  const [isLoading, setIsLoading] = useState(true);
  const [isRSVPing, setIsRSVPing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const creds = getStoredCredentials();
    setCredentials(creds);
    loadOffer();
  }, [offerId]);

  const loadOffer = async () => {
    try {
      // Load offer details
      const offerResponse = await fetch(`/api/offers`);
      const offerData = await offerResponse.json();

      if (offerData.success) {
        const foundOffer = offerData.offers.find((o: Offer) => o.id === offerId);
        if (foundOffer) {
          setOffer(foundOffer);

          // Load RSVP data
          const rsvpResponse = await fetch(`/api/rsvp?offerId=${offerId}`);
          const rsvpData = await rsvpResponse.json();

          if (rsvpData.success) {
            const creds = getStoredCredentials();
            const userHasRSVP = creds
              ? rsvpData.rsvps.some((r: any) => r.npub === creds.npub)
              : false;

            setRSVPData({
              count: rsvpData.count,
              userHasRSVP,
            });
          }
        } else {
          setError('Offer not found');
        }
      }

      setIsLoading(false);
    } catch (err) {
      console.error('Failed to load offer:', err);
      setError('Failed to load offer details');
      setIsLoading(false);
    }
  };

  const handleRSVP = async () => {
    if (!credentials) {
      router.push('/badge');
      return;
    }

    setIsRSVPing(true);
    setError('');

    try {
      const response = await fetch('/api/rsvp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          offerId,
          npub: credentials.npub,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        setError(data.error || 'Failed to RSVP');
        setIsRSVPing(false);
        return;
      }

      // Reload offer data
      await loadOffer();

      // Publish human-readable events for RSVP
      if (offer) {
        // Kind 7: Reaction with ✅ emoji referencing the workshop event
        if (offer.nostrEventId && offer.authors.length > 0) {
          publishReaction({
            content: '✅',
            referencedEventId: offer.nostrEventId,
            referencedPubkey: offer.authors[0],
          });
        }

        // Kind 1: Note "RSVP to :title in :room :date at :time"
        let noteContent = `RSVP to "${offer.title}"`;
        if (offer.room) {
          noteContent += ` in ${offer.room}`;
        }
        if (offer.startTime) {
          const startDate = new Date(offer.startTime);
          const dateStr = formatRelativeDate(startDate);
          const timeStr = formatTime(startDate);
          noteContent += ` ${dateStr} at ${timeStr}`;
        }
        publishNote({
          content: noteContent,
          referencedEventId: offer.nostrEventId,
        });
      }

      setIsRSVPing(false);

    } catch (err) {
      console.error('RSVP failed:', err);
      setError('Failed to RSVP');
      setIsRSVPing(false);
    }
  };

  const handleCancelRSVP = async () => {
    if (!credentials) return;

    setIsRSVPing(true);
    setError('');

    try {
      const response = await fetch('/api/rsvp', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          offerId,
          npub: credentials.npub,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        setError(data.error || 'Failed to cancel RSVP');
        setIsRSVPing(false);
        return;
      }

      // Reload offer data
      await loadOffer();
      setIsRSVPing(false);

    } catch (err) {
      console.error('Cancel RSVP failed:', err);
      setError('Failed to cancel RSVP');
      setIsRSVPing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  if (error && !offer) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Error</h1>
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={() => router.push('/offers')}
            className="w-full bg-blue-600 text-white font-semibold py-3 px-4 rounded-lg hover:bg-blue-700 transition"
          >
            Back to Offers
          </button>
        </div>
      </div>
    );
  }

  if (!offer) return null;

  const isAuthor = credentials && offer.authors.includes(credentials.npub);
  const minAttendees = offer.maxAttendees || 5;
  const isPending = offer.status === 'pending';
  const remainingRSVPs = Math.max(0, minAttendees - rsvpData.count);
  const eventHasStarted = offer.startTime ? new Date(offer.startTime) <= new Date() : false;

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Top App Bar */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              className="text-gray-600 hover:text-gray-900"
              onClick={() => router.back()}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <h1 className="font-semibold text-gray-900 truncate">{offer.title}</h1>
          </div>
        </div>
      </header>

      {/* Offer Content */}
      <main className="max-w-2xl mx-auto px-4 py-6">
        <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
          {/* Status Badge */}
          <div className="mb-4">
            {isPending ? (
              <span className="bg-yellow-100 text-yellow-800 text-xs font-medium px-2 py-1 rounded">
                Pending {rsvpData.count}/{minAttendees}
              </span>
            ) : (
              <span className="bg-green-100 text-green-800 text-xs font-medium px-2 py-1 rounded">
                Confirmed
              </span>
            )}
            <span className="ml-2 text-xs text-gray-600 capitalize">
              {offer.type}
            </span>
          </div>

          {/* Title */}
          <h2 className="text-2xl font-bold text-gray-900 mb-4">{offer.title}</h2>

          {/* Description */}
          <p className="text-gray-700 mb-4 whitespace-pre-wrap">{offer.description}</p>

          {/* Tags */}
          {offer.tags && offer.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {offer.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Schedule Info */}
          {(offer.startTime || offer.room) && (
            <div className="border-t pt-4 mb-4">
              {offer.startTime && (
                <p className="text-sm text-gray-600 mb-1">
                  📅 {new Date(offer.startTime).toLocaleString()}
                </p>
              )}
              {offer.room && (
                <p className="text-sm text-gray-600">
                  📍 {offer.room}
                </p>
              )}
              {offer.startTime && !eventHasStarted && (
                <Link
                  href={mapUrl(VILLAGE_SLUG, offer.startTime)}
                  className="inline-block mt-2 text-sm font-medium text-blue-600 hover:underline"
                >
                  Get there on time →
                </Link>
              )}
            </div>
          )}

          {/* Attendance Info */}
          <div className="bg-blue-50 rounded-lg p-4 mb-4">
            <p className="text-sm font-semibold text-blue-900 mb-1">
              {rsvpData.count} attending
            </p>
            {isPending && remainingRSVPs > 0 && (
              <p className="text-sm text-orange-600">
                {remainingRSVPs} more RSVP{remainingRSVPs !== 1 ? 's' : ''} required to confirm
              </p>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* RSVP Actions */}
          {!isAuthor && credentials && (
            <div>
              {eventHasStarted ? (
                <div className="bg-gray-100 rounded-lg p-3">
                  <p className="text-sm text-gray-600 text-center">
                    {rsvpData.userHasRSVP
                      ? "You're attending this event"
                      : "This event has already started"}
                  </p>
                </div>
              ) : rsvpData.userHasRSVP ? (
                <button
                  onClick={handleCancelRSVP}
                  disabled={isRSVPing}
                  className="w-full bg-red-600 text-white font-semibold py-3 px-4 rounded-lg hover:bg-red-700 transition disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {isRSVPing ? 'Cancelling...' : 'Cancel RSVP (Refund 1 token)'}
                </button>
              ) : (
                <button
                  onClick={handleRSVP}
                  disabled={isRSVPing}
                  className="w-full bg-blue-600 text-white font-semibold py-3 px-4 rounded-lg hover:bg-blue-700 transition disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {isRSVPing ? 'RSVPing...' : 'RSVP (1 token)'}
                </button>
              )}
            </div>
          )}

          {isAuthor && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
              <p className="text-sm text-purple-800">
                ✨ You are the author of this {offer.type}
              </p>
            </div>
          )}

          {!credentials && !eventHasStarted && (
            <button
              onClick={() => router.push('/badge')}
              className="w-full bg-blue-600 text-white font-semibold py-3 px-4 rounded-lg hover:bg-blue-700 transition"
            >
              Sign In to RSVP
            </button>
          )}

          {!credentials && eventHasStarted && (
            <div className="bg-gray-100 rounded-lg p-3">
              <p className="text-sm text-gray-600 text-center">
                This event has already started
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
