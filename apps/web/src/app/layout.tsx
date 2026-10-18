import type { Metadata } from "next";
import localFont from "next/font/local";
const sans = localFont({
  src: "../../../../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2",
  variable: "--font-sans",
  display: "swap",
});
const mono = localFont({
  src: "../../../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2",
  variable: "--font-mono",
  display: "swap",
  preload: false,
});
import "./globals.css";
import { DevTools } from "@/components/dev-tools";
export const metadata: Metadata = {
  title: {
    default: "Zeer — Zcash data. Ready to build.",
    template: "%s | Zeer",
  },
  description:
    "Public Zcash data for developers. Query blocks with Prep. Build application APIs with Chef.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
        {process.env.NODE_ENV === "development" ? <DevTools /> : null}
      </body>
    </html>
  );
}
