"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/Avatar";
import { ColorPickerModal } from "@/components/ColorPickerModal";
import { AppDataProvider, useAppData } from "@/components/app-data";
import { Toaster } from "@/components/toast";
import { ROLE_LABELS, type Role } from "@/lib/database.types";

function NavItem({
  href,
  icon,
  label,
  onNavigate,
}: {
  href: string;
  icon: string;
  label: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
  return (
    <Link href={href} className={"nav-item" + (active ? " active" : "")} onClick={onNavigate} title={label}>
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
    </Link>
  );
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const { me, isAdmin, isStaff, isComercial, hasSales } = useAppData();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showColor, setShowColor] = useState(false);

  function toggleTheme() {
    const root = document.documentElement;
    const dark = root.dataset.theme !== "dark";
    if (dark) root.dataset.theme = "dark";
    else delete root.dataset.theme;
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {}
  }

  // Menú lateral plegado/desplegado: se guarda en <html data-sidebar> (el CSS
  // hace el resto) y en localStorage; layout.tsx lo aplica antes de pintar.
  function toggleSidebar() {
    const root = document.documentElement;
    const collapsed = root.dataset.sidebar !== "collapsed";
    if (collapsed) root.dataset.sidebar = "collapsed";
    else delete root.dataset.sidebar;
    try {
      localStorage.setItem("sidebar", collapsed ? "collapsed" : "expanded");
    } catch {}
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <div className={"sidebar" + (open ? " open" : "")}>
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-integraly.png" alt="Integraly" className="brand-logo theme-light-only" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-integraly-dark.png" alt="Integraly" className="brand-logo theme-dark-only" />
          <div className="brand-sub" style={{ marginTop: 0 }}>Ops</div>
        </div>
        <div className="nav-section">General</div>
        {/* El rol comercial solo entra en Comercial */}
        {!isComercial && (
          <>
            <NavItem href="/dashboard" icon="🏠" label="Inicio" onNavigate={() => setOpen(false)} />
            <NavItem href="/projects" icon="📁" label="Proyectos" onNavigate={() => setOpen(false)} />
          </>
        )}
        {hasSales && <NavItem href="/comercial" icon="🎯" label="Comercial" onNavigate={() => setOpen(false)} />}
        {isStaff && (
          <>
            <div className="nav-section">Administración</div>
            <NavItem href="/clients" icon="🧾" label="Clientes" onNavigate={() => setOpen(false)} />
            {isAdmin && <NavItem href="/team" icon="👥" label="Equipo" onNavigate={() => setOpen(false)} />}
          </>
        )}
        <div className="sidebar-foot">
          <button className="nav-item sidebar-toggle" onClick={toggleSidebar} title="Plegar / desplegar el menú">
            <span className="nav-icon">
              <span className="when-expanded">«</span>
              <span className="when-collapsed">»</span>
            </span>
            <span className="nav-label">Plegar menú</span>
          </button>
          <button className="nav-item" onClick={toggleTheme} title="Modo claro / oscuro">
            <span className="nav-icon">
              <span className="theme-light-only">☾</span>
              <span className="theme-dark-only">☀</span>
            </span>
            <span className="theme-light-only nav-label">Modo oscuro</span>
            <span className="theme-dark-only nav-label">Modo claro</span>
          </button>
          <Link href="/set-password" className="nav-item" onClick={() => setOpen(false)} title="Contraseña">
            <span className="nav-icon">🔑</span>
            <span className="nav-label">Contraseña</span>
          </Link>
          <div className="me-row">
            <button className="avatar-btn" title="Cambiar tu color" onClick={() => setShowColor(true)}>
              <Avatar id={me.id} name={me.full_name} size={30} />
            </button>
            <div className="me-info" style={{ minWidth: 0, flex: 1 }}>
              <div className="me-name">{me.full_name || "Tú"}</div>
              <div className="me-role">{ROLE_LABELS[me.role]}</div>
            </div>
            <button
              className="icon-btn"
              title="Cerrar sesión"
              onClick={handleSignOut}
              style={{ color: "var(--sidebar-ink-dim)" }}
            >
              ⏻
            </button>
          </div>
        </div>
      </div>
      <div className="main">
        <button
          className="mobile-menu-btn"
          style={{ position: "fixed", top: 14, left: 14, zIndex: 45 }}
          onClick={() => setOpen((o) => !o)}
        >
          ☰
        </button>
        {children}
      </div>
      <Toaster />
      {showColor && <ColorPickerModal userId={me.id} onClose={() => setShowColor(false)} />}
    </div>
  );
}

export default function AppShell({
  me,
  children,
}: {
  me: { id: string; email: string; full_name: string | null; role: Role };
  children: React.ReactNode;
}) {
  return (
    <AppDataProvider me={me}>
      <ShellInner>{children}</ShellInner>
    </AppDataProvider>
  );
}
