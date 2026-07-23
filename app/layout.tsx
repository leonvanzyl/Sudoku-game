import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Orbitron, Space_Grotesk } from "next/font/google";
import MotionProvider from "@/components/MotionProvider";
import "./globals.css";

const orbitron = Orbitron({
  variable: "--font-orbitron",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800", "900"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NEON SUDOKU — Multiplayer",
  description:
    "Real-time multiplayer sudoku. Solve together in co-op or race your friends on the same puzzle.",
};

export const viewport: Viewport = {
  themeColor: "#04050d",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${orbitron.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <div className="bg-scene" aria-hidden>
          <div className="starfield" />
          <div className="starfield starfield-2" />
          <div className="aurora aurora-a" />
          <div className="aurora aurora-b" />
          <div className="aurora aurora-c" />
          <div className="bg-vignette" />
        </div>
        <div className="relative z-10 flex min-h-dvh flex-col">
          <MotionProvider>{children}</MotionProvider>
        </div>
      </body>
    </html>
  );
}
