import { Link, useRouterState } from "@tanstack/react-router";
import { Sparkles, Menu, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "Home", to: "/" as const },
  { label: "Features", to: "/#features" as const },
  { label: "Candidates", to: "/#candidates" as const },
  { label: "Companies", to: "/#companies" as const },
  { label: "Colleges", to: "/#colleges" as const },
  { label: "Pricing", to: "/#pricing" as const },
  { label: "About", to: "/#about" as const },
  { label: "Contact", to: "/#contact" as const },
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hash = useRouterState({ select: (s) => s.location.hash });

  const isActive = (to: string) => {
    if (to === "/") return pathname === "/" && !hash;
    if (to.startsWith("/#")) return `#${hash}` === to.slice(1) || (pathname === "/" && `/#${hash}` === to);
    return pathname === to;
  };

  return (
    <header className="sticky top-0 z-40">
      <div className="glass-strong border-b border-border/60">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-6">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-brand shadow-glow">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-display text-lg font-bold tracking-tight">Mirracle</span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex">
            {NAV.map((item) => (
              <a
                key={item.label}
                href={item.to}
                className={cn(
                  "relative rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                  isActive(item.to) && "tab-highlight",
                )}
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            <Button variant="ghost" asChild>
              <Link to="/portals">Login</Link>
            </Button>
            <Button variant="outline" className="border-primary/30 text-primary hover:bg-primary-soft">
              Book Demo
            </Button>
            <Button
              asChild
              className="bg-gradient-brand text-primary-foreground shadow-soft transition-transform hover:-translate-y-0.5 hover:opacity-95"
            >
              <Link to="/portals">Get Started</Link>
            </Button>
          </div>

          <button
            className="rounded-lg p-2 text-foreground lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {open && (
          <div className="border-t border-border/60 px-4 py-4 lg:hidden">
            <nav className="flex flex-col gap-1">
              {NAV.map((item) => (
                <a
                  key={item.label}
                  href={item.to}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground",
                    isActive(item.to) && "tab-highlight",
                  )}
                >
                  {item.label}
                </a>
              ))}
              <div className="mt-3 flex flex-col gap-2">
                <Button variant="outline" asChild>
                  <Link to="/portals">Login</Link>
                </Button>
                <Button asChild className="bg-gradient-brand text-primary-foreground">
                  <Link to="/portals">Get Started</Link>
                </Button>
              </div>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
