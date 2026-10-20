"use client";
import { useState, useRef } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  ArrowUpRight,
  Braces,
  BookOpen,
  Github,
  LayoutDashboard,
  Layers3,
  Menu,
  X,
  Search,
} from "lucide-react";
import { Logo, Network } from "./ui";
import { docs, repo } from "@/lib/content";
export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const menuButton = useRef<HTMLButtonElement>(null);
  const path = usePathname(),
    [open, setOpen] = useState(false);
  const links = [
    { path: "/app", name: "Overview", icon: LayoutDashboard },
    { path: "/app/prep", name: "Prep Playground", icon: Layers3 },
    { path: "/app/chef", name: "Chef Playground", icon: Braces },
    { path: "/app/transactions", name: "Transactions", icon: Search },
  ];
  return (
    <div
      className="console-shell"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          menuButton.current?.focus();
        }
      }}
    >
      <aside className={`console-sidebar ${open ? "visible" : ""}`}>
        <Logo />
        <div className="sidebar-title">Developer console</div>
        <nav aria-label="Console navigation">
          {links.map(({ path: href, name, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={path === href ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              <Icon size={18} />
              {name}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Link href={docs}>
            <BookOpen size={16} />
            Quickstart
            <ArrowUpRight size={13} />
          </Link>
          <Link href={repo}>
            <Github size={16} />
            GitHub
            <ArrowUpRight size={13} />
          </Link>
          <span>
            Public-data preview <span className="version">v0.1</span>
          </span>
        </div>
      </aside>
      <div className="console-body">
        <header className="console-header">
          <button
            className="icon-button mobile-menu"
            ref={menuButton}
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          >
            {open ? <X /> : <Menu />}
          </button>
          <div className="breadcrumb">
            <span>Public demo</span>
            <span>/</span>
            <strong>
              {links.find((l) => l.path === path)?.name ?? "Console"}
            </strong>
          </div>
          <Network />
        </header>
        <main id="main" className="console-main">
          {children}
        </main>
      </div>
    </div>
  );
}
