import type { Metadata } from "next";
import { Pixelify_Sans } from "next/font/google";
import "./globals.css";

const pixelifySans = Pixelify_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "moondat",
  description: "send anything to the moon!",
};

export default function RootLayout({
  children,
}: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body
        className={`${pixelifySans.className} min-h-full flex flex-col`}
      >
        {children}
      </body>
    </html>
  );
}