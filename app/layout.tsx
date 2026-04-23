import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Orbitron, Space_Grotesk, VT323 } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const orbitron = Orbitron({
  variable: "--font-orbitron",
  subsets: ["latin"],
  weight: ["500", "700", "800", "900"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const vt323 = VT323({
  variable: "--font-vt323",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Listening Lore",
  description:
    "Listening Lore turns Spotify history into a vivid, on-demand dashboard for moods, trends, and forgotten favorites.",
};

const themeInitScript = `
(function () {
  try {
    var stored = window.localStorage.getItem('soundscope-theme');
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
  } catch (error) {
    document.documentElement.dataset.theme = 'light';
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-6VE9KFC8P6"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());

            gtag('config', 'G-6VE9KFC8P6');
          `}
        </Script>
      </head>
      <body className={`${orbitron.variable} ${spaceGrotesk.variable} ${vt323.variable} font-sans antialiased`}>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
