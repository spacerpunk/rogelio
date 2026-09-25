"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/projects", label: "Proyectos" },
  { href: "/clients", label: "Clientes" },
];

export function AppHeader() {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme !== "light";
  const themeLabel = isDark ? "Modo claro" : "Modo oscuro";

  return (
    <header className="sticky top-0 z-40 flex h-11 shrink-0 items-center gap-4 border-b bg-background/95 px-4 backdrop-blur">
      <Link href="/projects" className="text-sm font-semibold tracking-tight">
        Roger That <span className="text-muted-foreground">Studio</span>
      </Link>
      <nav className="flex items-center gap-1">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-2.5 py-1 text-sm transition-colors",
                active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={themeLabel}
              onClick={() => setTheme(isDark ? "light" : "dark")}
            >
              {isDark ? <SunIcon /> : <MoonIcon />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{themeLabel}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
