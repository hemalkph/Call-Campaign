import type { Metadata } from "next";
import { Noto_Sans, Noto_Sans_Sinhala } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const latin = Noto_Sans({ variable: "--font-latin", subsets: ["latin"] });
const sinhala = Noto_Sans_Sinhala({ variable: "--font-sinhala", subsets: ["sinhala"] });

export const metadata: Metadata = {
  title: { default: "Call Campaign", template: "%s · Call Campaign" },
  description: "Calling and WhatsApp follow-up for Pasindu Athukorala ICT class",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${latin.variable} ${sinhala.variable} h-full antialiased`}>
      <body className="min-h-full">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
