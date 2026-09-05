import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";


export const metadata: Metadata = {
  title: "PaleoLens Field Engine",
  description: "Edge-AI Fossil Diagnostic Tool",
  // Remove the manifest line here
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${geistSans.className} antialiased bg-slate-950 text-slate-100 min-h-screen`}>
        {children}
      </body>
    </html>
  );
}