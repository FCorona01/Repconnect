import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'RepConnect',
    template: '%s · RepConnect',
  },
  description:
    'RepConnect connects businesses with independent sales representatives, ' +
    'fractional sales professionals and commission-based sales talent.',
  robots: { index: false, follow: false }, // opened up at launch, not before
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
