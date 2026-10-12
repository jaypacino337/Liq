import type { Metadata, Viewport } from "next";
import { Unbounded, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { Tide } from "@/components/Tide";
import "./globals.css";

const display = Unbounded({ subsets: ["latin"], variable: "--font-display", weight: ["500", "600", "700", "800"] });
const body = Space_Grotesk({ subsets: ["latin"], variable: "--font-body" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "liq — launch tokens with liquidity that can't be pulled",
  description:
    "A Solana launchpad where every token fills a bonding curve, then overflows into a permanent pool with no LP tokens. Nobody can pull the liquidity, including us.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#04060c" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <Providers>
          <Header />
          <Tide />
          <main className="shell">{children}</main>
          <footer className="footer">
            <div className="shell" style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
              <span>liq: liquidity that can&apos;t be pulled.</span>
              <span>Trading memecoins is risky. Only pour what you can afford to lose.</span>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
