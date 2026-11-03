import type { Metadata } from 'next';
import '@xyflow/react/dist/style.css';
import './globals.css';
import { Providers } from '@/components/Providers';

export const metadata: Metadata = {
  title: 'Canvas — Brainstorm together',
  description: 'A minimal infinite brainstorming canvas.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
