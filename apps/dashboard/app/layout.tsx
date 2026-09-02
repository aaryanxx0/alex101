import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Alex101 — Browser Minecraft Bot',
  description: 'Control Alex101, a Minecraft Java bot, from your browser.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-root">{children}</div>
      </body>
    </html>
  );
}