import type { Metadata } from "next";

// V18.9.2 (contre-audit F07) : les pages HTML sont rendues DYNAMIQUEMENT.
// La CSP appliquée porte un nonce généré PAR REQUÊTE (src/proxy.ts) ; un HTML
// prérendu au build figerait des scripts sans nonce et serait bloqué par la
// politique. Le service est un ERP interne authentifié : aucun coût de
// prérendu statique public à préserver.
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "GoCmd | SODEPI — Gestion des commandes, achats et stocks",
  description:
    "GoCmd, ERP interne SODEPI : commandes, achats, approvisionnements, matières premières et stocks.",
  keywords: ["ERP", "gestion de stock", "matières premières", "produits semi-finis", "commandes", "fabrication"],
  icons: {
    icon: "/branding/favicon.ico",
    shortcut: "/branding/favicon.ico",
    apple: "/branding/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
      </body>
    </html>
  );
}
