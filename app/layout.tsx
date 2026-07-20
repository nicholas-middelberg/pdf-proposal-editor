import type { Metadata } from 'next';
import './globals.css';

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
      <body>{children}</body>
    </html>
  );
}
