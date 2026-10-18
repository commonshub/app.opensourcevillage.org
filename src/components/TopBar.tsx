'use client';

/**
 * TopBar Component
 *
 * Global navigation bar displayed at the top of all pages.
 * - Left: Hamburger menu
 * - Center: Dynamic page title (or site name on home)
 * - Right: User balance and avatar (links to profile)
 */

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import UserHeader from './UserHeader';

// Map routes to page titles
const PAGE_TITLES: Record<string, string> = {
  '/': 'Open Source Village',
  '/calendar': 'Calendar',
  '/map': 'Map',
  '/offers': 'Offers',
  '/needs': 'Needs',
  '/offers/create': 'Propose Workshop',
  '/book': 'Book a Room',
  '/notifications': 'Notifications',
  '/settings': 'Settings',
  '/profile/edit': 'Edit Profile',
  '/badge': 'Claim Badge',
  '/transactions': 'Transactions',
  '/onboarding': 'Welcome',
  '/onboard': 'Onboard a Villager',
  '/directory': 'Directory',
  '/post': 'Post a Message',
};

// Get title for dynamic routes
function getPageTitle(pathname: string): string {
  // Check exact match first
  if (PAGE_TITLES[pathname]) {
    return PAGE_TITLES[pathname];
  }

  // Handle dynamic routes
  if (pathname.startsWith('/calendar/')) {
    return 'Calendar';
  }
  if (pathname.startsWith('/profile/')) {
    return 'Profile';
  }
  if (pathname.startsWith('/offers/') && pathname.endsWith('/edit')) {
    return 'Edit Workshop';
  }
  if (pathname.startsWith('/offers/')) {
    return 'Workshop Details';
  }
  if (pathname.startsWith('/rooms/')) {
    return 'Room Details';
  }

  // Default to site name
  return 'Open Source Village';
}

function TopBarContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);

  // Hide TopBar on screen display routes (/screen and /YYYY/MM/DD/screen)
  if (pathname.startsWith('/screen') || pathname.endsWith('/screen')) {
    return null;
  }

  // Get page title, with special handling for /offers/create with type param
  let pageTitle = getPageTitle(pathname);
  if (pathname === '/offers/create') {
    const typeParam = searchParams.get('type');
    if (typeParam === 'need') {
      pageTitle = 'Post a Need';
    } else if (typeParam === 'offer' || typeParam === 'other') {
      pageTitle = 'Share an Offering';
    }
  }
  const isHome = pathname === '/';

  const menuItems = [
    { href: '/', label: 'Home' },
    { href: '/calendar', label: 'Calendar' },
    { href: '/map', label: 'Map & Directions' },
    { href: '/book', label: 'Book a Room' },
    { href: '/offers', label: 'Offers' },
    { href: '/needs', label: 'Needs' },
    { href: '/directory', label: 'Directory' },
    { href: '/offers/create', label: 'Propose Workshop' },
    { href: '/notifications', label: 'Notifications' },
    { href: '/settings', label: 'Settings' },
  ];

  return (
    <>
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center relative">
          {/* Left: Hamburger menu */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-2 -ml-2 hover:bg-gray-100 rounded-lg transition-colors z-10"
            aria-label="Toggle menu"
          >
            <svg
              className="w-6 h-6 text-gray-700"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {menuOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>

          {/* Center: Page Title (absolutely positioned to always be centered) */}
          <div className="absolute left-0 right-0 flex justify-center pointer-events-none">
            {isHome ? (
              <span className="text-lg font-semibold text-gray-900">{pageTitle}</span>
            ) : (
              <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity pointer-events-auto">
                <span className="text-lg font-semibold text-gray-900">{pageTitle}</span>
              </Link>
            )}
          </div>

          {/* Right: User info */}
          <div className="ml-auto z-10">
            <UserHeader />
          </div>
        </div>
      </header>

      {/* Dropdown menu */}
      {menuOpen && (
        <nav className="bg-white border-b border-gray-200 shadow-lg">
          <div className="max-w-4xl mx-auto px-4 py-2">
            {menuItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className="block py-3 px-2 text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </>
  );
}

export default function TopBar() {
  return (
    <Suspense fallback={null}>
      <TopBarContent />
    </Suspense>
  );
}
