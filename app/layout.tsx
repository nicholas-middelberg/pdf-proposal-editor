import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Serif } from 'next/font/google';
import './globals.css';

// Three type roles, used strictly (visual redesign): serif for
// document/proposal body text, sans for app chrome, mono for labels/
// metadata/utility buttons. Google doesn't publish a static 450 weight for
// Plex Sans, so 400/500/600 stands in for the mock's 400/450/500/600.
const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
});
const plexSerif = IBM_Plex_Serif({
  subsets: ['latin'],
  weight: ['400', '500'],
  style: ['normal', 'italic'],
  variable: '--font-serif',
});
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'AI Proposal Editor',
  description:
    'Upload a construction proposal PDF and edit it paragraph-by-paragraph with AI.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${plexSans.variable} ${plexSerif.variable} ${plexMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
