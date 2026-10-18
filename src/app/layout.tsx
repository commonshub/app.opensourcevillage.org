import type { Metadata, Viewport } from "next";
import "./globals.css";
import WalletSetup from "@/components/WalletSetup";
import NostrStatus from "@/components/NostrStatus";
import DebugInfo from "@/components/DebugInfo";
import TopBar from "@/components/TopBar";
import Footer from "@/components/Footer";
import FloatingActionMenu from "@/components/FloatingActionMenu";
import OfflineIndicator from "@/components/OfflineIndicator";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import { getRelayUrls, getServerNpub } from "@/lib/nostr-server";
import { EVENT } from "@/lib/event";

export const metadata: Metadata = {
  title: "Open Source Village",
  description: `Mobile webapp for ${EVENT.name} attendees, ${EVENT.datesLabel}`,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Get relay URLs and server npub from server environment
  const relayUrls = getRelayUrls();
  const serverNpub = getServerNpub();

  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__OSV_RELAY_URLS__ = ${JSON.stringify(relayUrls)}; window.__OSV_SERVER_NPUB__ = ${JSON.stringify(serverNpub)};`,
          }}
        />
      </head>
      <body className="antialiased bg-gray-50 min-h-screen flex flex-col">
        <ServiceWorkerRegistration />
        <OfflineIndicator />
        <WalletSetup />
        <NostrStatus />
        <TopBar />
        <DebugInfo />
        <main className="flex-1">
          {children}
        </main>
        <FloatingActionMenu />
        <Footer />
      </body>
    </html>
  );
}
