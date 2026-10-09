import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "goey-toast/styles.css";
import "./globals.css";
import { AuthProvider } from "@/lib/contexts/AuthContext";
import ToastProvider from "@/components/providers/ToastProvider";
import ResilienceProvider from "@/components/resilience/ResilienceProvider";
import DeviceActivationGate from "@/components/device/DeviceActivationGate";
import CashDrawerSettingsSync from "@/features/printer/components/CashDrawerSettingsSync";
import UpdateProvider from "@/features/updater/components/UpdateProvider";
import PayOSReconciliationMonitor from "@/features/payments/components/PayOSReconciliationMonitor";

const inter = Inter({
  subsets: ["latin", "vietnamese"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Hệ Thống POS",
  description: "Hệ thống bán hàng Local-First với đồng bộ thời gian thực",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" data-scroll-behavior="smooth">
      <body className={`${inter.className} antialiased`}>
        <UpdateProvider>
          <ResilienceProvider>
            <DeviceActivationGate>
              <AuthProvider>{children}<PayOSReconciliationMonitor /><CashDrawerSettingsSync /></AuthProvider>
            </DeviceActivationGate>
          </ResilienceProvider>
        </UpdateProvider>
        <ToastProvider />
        <Script
          type="module"
          src="https://unpkg.com/ionicons@7.1.0/dist/ionicons/ionicons.esm.js"
          strategy="lazyOnload"
        />
        <Script
          noModule
          src="https://unpkg.com/ionicons@7.1.0/dist/ionicons/ionicons.js"
          strategy="lazyOnload"
        />
      </body>
    </html>
  );
}
