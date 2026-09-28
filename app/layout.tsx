import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

/**
 * フォントは同梱する（next/font/local）。
 *
 * next/font/google は **ビルド時に fonts.googleapis.com へ取りに行く**ため、
 * 社内プロキシ越しのイメージビルドが断続的に
 * 「Failed to fetch Geist from Google Fonts」で落ちていた。
 * ファイルを app/fonts に置けば、ビルドに外部通信が要らなくなる。
 *
 * 置いてあるのは Google Fonts が配信している latin サブセットの可変フォントそのもの
 * （Geist v5 / Geist Mono v6、weight 100〜900 を 1 ファイルで賄う）。
 * 日本語はもともと Geist に字が無く、従来どおりシステムフォントにフォールバックする。
 */
const geistSans = localFont({
  src: "./fonts/Geist-latin.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/GeistMono-latin.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "grilljev",
  description: "会議の音声から業務フロー（シーケンス図）をリアルタイムに立ち上げる",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
