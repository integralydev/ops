import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Integraly Ops",
  description: "Gestión operativa de proyectos, tareas y archivos de Integraly AI Solutions",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Aplica el tema guardado antes de pintar, para evitar un parpadeo */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var d=document.documentElement;if(localStorage.getItem("theme")==="dark")d.dataset.theme="dark";if(localStorage.getItem("sidebar")==="collapsed")d.dataset.sidebar="collapsed"}catch(e){}`,
          }}
        />
      </head>
      {/* suppressHydrationWarning: extensiones del navegador (p. ej. ColorZilla) añaden atributos al <body> */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
