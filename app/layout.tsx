import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Дружина — защита города",
  description: "Собирай дружину, объединяй бойцов и защити древний город от десяти волн чудищ.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
