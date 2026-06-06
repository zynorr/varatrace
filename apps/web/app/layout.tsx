import type { ReactNode } from "react";
import { ThemeProvider } from "../components/ThemeProvider";

export const metadata = {
  title: "VaraTrace — async message debugger for Vara",
  description: "Reconstruct and visualize the async message tree behind any Vara interaction.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Blocking inline script prevents flash of wrong theme before React hydrates */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            try {
              var t = localStorage.getItem("varatrace-theme");
              if (!t) { t = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; }
              document.documentElement.setAttribute("data-theme", t);
            } catch(e) {}
          })();
        `}} />
        <style dangerouslySetInnerHTML={{ __html: `
          /* ===== CSS Variables ===== */
          :root {
            --bg-primary: #ffffff;
            --bg-secondary: #f8fafc;
            --bg-tertiary: #f1f5f9;
            --bg-hover: #e2e8f0;
            --bg-success: #f0fdf4;
            --bg-fail: #fef2f2;
            --bg-code: #f8fafc;
            --bg-controls: #ffffff;

            --text-primary: #0f172a;
            --text-secondary: #475569;
            --text-tertiary: #64748b;
            --text-muted: #94a3b8;

            --border-primary: #e2e8f0;
            --border-secondary: #f1f5f9;
            --border-input: #cbd5e1;

            --color-indigo: #6366f1;
            --color-green: #16a34a;
            --color-red: #dc2626;
            --color-red-bg: #fef2f2;
            --color-red-border: #fecaca;
            --color-red-text: #991b1b;

            --edge-color: #94a3b8;
            --edge-inferred: #a5b4fc;
            --edge-fail: #dc2626;

            --node-shadow: 0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04);
            --node-shadow-hover: 0 4px 12px rgba(15,23,42,0.1);
            --node-shadow-fail: 0 0 0 3px rgba(220,38,38,0.12), 0 2px 6px rgba(15,23,42,0.08);
            --header-shadow: 0 1px 3px rgba(0,0,0,0.04);
            --controls-shadow: 0 1px 4px rgba(0,0,0,0.08);

            --spinner-track: #e2e8f0;
            --sample-btn-bg: #ffffff;
            --sample-btn-border: #e2e8f0;
            --sample-btn-text: #334155;
            --fail-banner-bg: linear-gradient(135deg, #fef2f2, #fff5f5);
            --fail-banner-shadow: 0 1px 3px rgba(220,38,38,0.08);
          }

          [data-theme="dark"] {
            --bg-primary: #1e293b;
            --bg-secondary: #0f172a;
            --bg-tertiary: #334155;
            --bg-hover: #475569;
            --bg-success: #052e16;
            --bg-fail: #450a0a;
            --bg-code: #1e293b;
            --bg-controls: #1e293b;

            --text-primary: #f1f5f9;
            --text-secondary: #cbd5e1;
            --text-tertiary: #94a3b8;
            --text-muted: #64748b;

            --border-primary: #334155;
            --border-secondary: #1e293b;
            --border-input: #475569;

            --color-indigo: #818cf8;
            --color-green: #4ade80;
            --color-red: #f87171;
            --color-red-bg: #450a0a;
            --color-red-border: #7f1d1d;
            --color-red-text: #fca5a5;

            --edge-color: #64748b;
            --edge-inferred: #818cf8;
            --edge-fail: #f87171;

            --node-shadow: 0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2);
            --node-shadow-hover: 0 4px 12px rgba(0,0,0,0.4);
            --node-shadow-fail: 0 0 0 3px rgba(248,113,113,0.2), 0 2px 6px rgba(0,0,0,0.3);
            --header-shadow: 0 1px 3px rgba(0,0,0,0.2);
            --controls-shadow: 0 1px 4px rgba(0,0,0,0.3);

            --spinner-track: #334155;
            --sample-btn-bg: #1e293b;
            --sample-btn-border: #334155;
            --sample-btn-text: #cbd5e1;
            --fail-banner-bg: linear-gradient(135deg, #450a0a, #3b0a0a);
            --fail-banner-shadow: 0 1px 3px rgba(248,113,113,0.15);
          }
        ` }} />
      </head>
      <body style={{
        margin: 0,
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
        color: "var(--text-primary)",
        background: "var(--bg-secondary)",
      }}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
