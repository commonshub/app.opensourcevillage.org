/**
 * Map page - venues around FOSDEM with public transport directions
 */

import { Suspense } from 'react';
import VenueMap from '@/components/VenueMap';

export const metadata = {
  title: 'Map | Open Source Village',
  description: 'Find your way between the village, FOSDEM and fringe events by public transport.',
};

export default function MapPage() {
  return (
    <main className="min-h-screen bg-gray-50 pb-20">
      <div className="max-w-lg mx-auto px-4 py-6">
        <Suspense fallback={<div className="h-[50vh] bg-gray-200 rounded-lg animate-pulse" />}>
          <VenueMap />
        </Suspense>
      </div>
    </main>
  );
}
