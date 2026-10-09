import type { Metadata } from 'next';

import '@fontsource/jost/500.css';
import '@fontsource/jost/600.css';
import '@fontsource/open-sans/400.css';
import '@fontsource/open-sans/600.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/600.css';
import './globals.css';

const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const metadataBase = new URL(
  productionHost ? `https://${productionHost}` : 'http://localhost:3000',
);

export const metadata: Metadata = {
  metadataBase,
  title: 'InkBeacon',
  description:
    'A beacon of light in a “content” world where reading is hard-to-navigate. Read, highlight and turn what you study into Mermaid maps.',
  openGraph: {
    title: 'InkBeacon',
    description: 'Read, highlight, build maps.',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'InkBeacon — read, highlight, build maps',
      },
    ],
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'InkBeacon',
    description: 'Read, highlight, build maps.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('studio:theme');var d=t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light'}catch(e){}})();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
