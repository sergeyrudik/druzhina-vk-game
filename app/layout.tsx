import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://sergeyrudik-druzhina-vk-game-3412.twc1.net"),
  title: "Дружина — защита города",
  description: "Собирай дружину, объединяй бойцов и защити древний город от десяти волн чудищ.",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    locale: "ru_RU",
    url: "/",
    title: "Дружина — защита города",
    description: "Собирай дружину, объединяй бойцов и защити древний город от десяти волн чудищ.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Дружина — защита города" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Дружина — защита города",
    description: "Собирай дружину, объединяй бойцов и защити древний город от десяти волн чудищ.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
