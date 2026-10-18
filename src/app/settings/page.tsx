'use client';

/**
 * Settings page
 * Allows users to manage their account settings, view keys, and export data
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredCredentials, clearCredentials } from '@/lib/nostr';
import { getStoredSecretKey } from '@/lib/nostr-events';
import { EVENT } from '@/lib/event';

export default function SettingsPage() {
  const router = useRouter();
  const [credentials, setCredentials] = useState<{ username: string; npub: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [nsecVisible, setNsecVisible] = useState(false);
  const [nsec, setNsec] = useState<string | null>(null);
  const [ethereumAddress, setEthereumAddress] = useState<string>('');

  // Username editing state
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [isSavingUsername, setIsSavingUsername] = useState(false);

  useEffect(() => {
    const creds = getStoredCredentials();
    if (!creds) {
      router.push('/badge');
      return;
    }

    setCredentials(creds);
    setNewUsername(creds.username);

    // Load nsec from localStorage
    const storedNsec = getStoredSecretKey();
    setNsec(storedNsec);

    // Derive Ethereum address from npub
    // For now, we'll generate a deterministic address from the npub
    // In production, this should use proper HD wallet derivation
    deriveEthereumAddress(creds.npub);

    setIsLoading(false);
  }, [router]);

  const deriveEthereumAddress = (npub: string) => {
    // Create a deterministic Ethereum-style address from npub
    // This is a placeholder - in production, use proper BIP-44 derivation
    const hash = npub.slice(5, 45); // Take part of the npub
    const address = '0x' + hash.slice(0, 40);
    setEthereumAddress(address);
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert(`${label} copied to clipboard!`);
    } catch (err) {
      alert(`Failed to copy ${label}. Please copy manually.`);
    }
  };

  const toggleNsecVisibility = () => {
    setNsecVisible(!nsecVisible);
  };

  const exportNsec = async () => {
    if (!nsec) {
      alert('Private key not found');
      return;
    }

    const confirmed = window.confirm(
      '⚠️ WARNING: Your private key will be copied to clipboard. Make sure no one can see your screen.\n\n' +
      'Never share your private key with anyone. Anyone with your private key has full control of your account.\n\n' +
      'Continue?'
    );

    if (!confirmed) return;

    try {
      await navigator.clipboard.writeText(nsec);
      alert('Private key copied to clipboard!\n\nStore it somewhere safe and secure.');
    } catch (err) {
      // Fallback: create download
      const blob = new Blob([nsec], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'opensourcevillage-private-key.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      alert('Private key downloaded to your device.\n\nStore it somewhere safe and secure.');
    }
  };

  const validateUsername = (username: string): boolean => {
    setUsernameError('');

    if (username.length < 3 || username.length > 20) {
      setUsernameError('Username must be 3-20 characters');
      return false;
    }

    if (!/^[a-z0-9_-]+$/.test(username)) {
      setUsernameError('Username can only contain lowercase letters, numbers, hyphens, and underscores');
      return false;
    }

    return true;
  };

  const saveUsername = async () => {
    if (!credentials || !validateUsername(newUsername)) {
      return;
    }

    setIsSavingUsername(true);
    setUsernameError('');

    try {
      // Check if username is available
      const checkResponse = await fetch(`/api/username?username=${encodeURIComponent(newUsername)}`);
      const checkData = await checkResponse.json();

      if (!checkData.available && newUsername !== credentials.username) {
        setUsernameError('Username is already taken');
        setIsSavingUsername(false);
        return;
      }

      // Update username in profile
      const updateResponse = await fetch(`/api/profile/${credentials.username}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUsername }),
      });

      const updateData = await updateResponse.json();

      if (!updateData.success) {
        setUsernameError(updateData.error || 'Failed to update username');
        setIsSavingUsername(false);
        return;
      }

      // Update localStorage
      localStorage.setItem('osv_username', newUsername);
      setCredentials({ ...credentials, username: newUsername });
      setIsEditingUsername(false);
      alert('Username updated successfully!');
    } catch (err) {
      console.error('Failed to update username:', err);
      setUsernameError('Failed to update username');
    } finally {
      setIsSavingUsername(false);
    }
  };

  const exportData = async () => {
    if (!credentials) return;

    try {
      // Fetch user's profile data
      const profileResponse = await fetch(`/api/profile/${credentials.username}`);
      const profileData = await profileResponse.json();

      // Fetch user's offers
      const offersResponse = await fetch(`/api/offers?author=${credentials.npub}`);
      const offersData = await offersResponse.json();

      // Fetch user's RSVPs
      const rsvpsResponse = await fetch(`/api/rsvp?npub=${credentials.npub}`);
      const rsvpsData = await rsvpsResponse.json();

      // Compile all data
      const exportData = {
        exportDate: new Date().toISOString(),
        profile: profileData.profile || {},
        offers: offersData.offers || [],
        rsvps: rsvpsData.rsvps || [],
        credentials: {
          username: credentials.username,
          npub: credentials.npub,
        },
      };

      // Create download
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `opensourcevillage-data-${credentials.username}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      alert('Your data has been exported successfully!');
    } catch (err) {
      console.error('Failed to export data:', err);
      alert('Failed to export data. Please try again.');
    }
  };

  const handleLogout = () => {
    const confirmed = window.confirm(
      "Log out? You'll need your badge serial number and password to log back in."
    );

    if (confirmed) {
      clearCredentials();
      router.push('/');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading settings...</div>
      </div>
    );
  }

  if (!credentials) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Settings Content */}
      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* Account Section */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Account</h2>

          <div className="space-y-4">
            {/* Username */}
            <div>
              <label className="text-sm text-gray-600 mb-1 block">Username</label>
              {!isEditingUsername ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3 py-2 bg-gray-50 rounded-lg text-sm font-medium text-gray-900">
                    @{credentials.username}
                  </div>
                  <button
                    onClick={() => setIsEditingUsername(true)}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium transition"
                  >
                    Edit
                  </button>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value.toLowerCase())}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm text-gray-900 placeholder-gray-400"
                      placeholder="username"
                    />
                    <button
                      onClick={saveUsername}
                      disabled={isSavingUsername}
                      className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium transition disabled:opacity-50"
                    >
                      {isSavingUsername ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={() => {
                        setIsEditingUsername(false);
                        setNewUsername(credentials.username);
                        setUsernameError('');
                      }}
                      className="text-gray-600 hover:text-gray-900 px-3 py-2 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                  {usernameError && (
                    <p className="text-xs text-red-600 mt-1">{usernameError}</p>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    3-20 characters, lowercase letters, numbers, hyphens, and underscores only
                  </p>
                </div>
              )}
            </div>

            {/* NPub (Public Key) */}
            <div>
              <label className="text-sm text-gray-600 mb-1 block">NPub (Public Key)</label>
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-gray-900 bg-gray-100 px-3 py-2 rounded-lg flex-1 truncate">
                  {credentials.npub}
                </code>
                <button
                  onClick={() => copyToClipboard(credentials.npub, 'NPub')}
                  className="text-blue-600 hover:text-blue-700 text-sm font-medium whitespace-nowrap"
                >
                  Copy
                </button>
              </div>
            </div>

            {/* NSec (Private Key) */}
            {nsec && (
              <div>
                <label className="text-sm text-gray-600 mb-1 block">NSec (Private Key)</label>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type={nsecVisible ? 'text' : 'password'}
                    value={nsec}
                    readOnly
                    className="text-sm font-mono text-gray-900 bg-gray-100 px-3 py-2 rounded-lg flex-1"
                  />
                  <button
                    onClick={toggleNsecVisibility}
                    className="text-gray-600 hover:text-gray-900 p-2"
                    title={nsecVisible ? 'Hide' : 'Show'}
                  >
                    {nsecVisible ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
                <button
                  onClick={exportNsec}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  Export Private Key
                </button>
                <p className="text-xs text-orange-600 mt-1">
                  ⚠️ Keep your private key safe. Never share it with anyone.
                </p>
              </div>
            )}

            {/* Ethereum Address */}
            <div>
              <label className="text-sm text-gray-600 mb-1 block">Ethereum Address (Gnosis Chain)</label>
              <div className="flex items-center gap-2 mb-2">
                <code className="text-sm font-mono text-gray-900 bg-gray-100 px-3 py-2 rounded-lg flex-1 truncate">
                  {ethereumAddress}
                </code>
                <button
                  onClick={() => copyToClipboard(ethereumAddress, 'Ethereum address')}
                  className="text-blue-600 hover:text-blue-700 text-sm font-medium whitespace-nowrap"
                >
                  Copy
                </button>
              </div>
              <a
                href={`https://gnosisscan.io/address/${ethereumAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:text-blue-700 font-medium inline-flex items-center gap-1"
              >
                View on Gnosis Scan
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          </div>
        </div>

        {/* Data Section */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Data</h2>

          <button
            onClick={exportData}
            className="w-full text-left p-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
          >
            <p className="font-medium text-gray-900">Export My Data</p>
            <p className="text-sm text-gray-600 mt-1">
              Download all your profile data, offers, and RSVP history
            </p>
          </button>
        </div>

        {/* About Section */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">About</h2>

          <div className="space-y-3">
            <div>
              <p className="font-medium text-gray-900">{EVENT.name}</p>
              <p className="text-sm text-gray-600">{EVENT.datesLabel}</p>
            </div>

            <div className="flex gap-3">
              <a
                href="https://opensourcevillage.org"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                Website
              </a>
              <a
                href="https://github.com/commonshub/app.opensourcevillage.org"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                GitHub
              </a>
            </div>
          </div>
        </div>

        {/* Log Out */}
        <button
          onClick={handleLogout}
          className="w-full bg-red-600 text-white font-semibold py-3 px-4 rounded-lg hover:bg-red-700 transition"
        >
          Log Out
        </button>
      </main>
    </div>
  );
}
