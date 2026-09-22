import type { Metadata } from 'next';
import '@/styles/globals.css';
import { LanguageProvider } from '@/i18n/context';

export const metadata: Metadata = {
  title: 'B2B Cigarette Wholesale Ordering Platform',
  description: 'Premium wholesale cigarette ordering system.',
  keywords: 'wholesale, tobacco, ordering platform, B2B, cigarettes',
  authors: [{ name: 'Mirsardor' }]
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className="dark">
      <head>
        <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📦</text></svg>" />
      </head>
      <body className="antialiased min-h-screen bg-background text-foreground">
        <LanguageProvider>
          {children}
        </LanguageProvider>
      </body>
    </html>
  );
}
