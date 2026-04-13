"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { SMS_LINK } from "@/lib/constants";

export function Navbar() {
  const [visible, setVisible] = useState(true);
  const lastY = useRef(0);
  const [atTop, setAtTop] = useState(true);

  useEffect(() => {
    function onScroll() {
      const y = window.scrollY;
      setAtTop(y < 10);
      if (y < lastY.current - 5) {
        setVisible(true);
      } else if (y > lastY.current + 5 && y > 80) {
        setVisible(false);
      }
      lastY.current = y;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
        visible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0",
        atTop
          ? "bg-transparent"
          : "bg-background/75 backdrop-blur-sm border-b border-foreground/6"
      )}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 h-16">
        <a
          href="/"
          className={cn(
            "font-logo text-xl tracking-wide transition-colors duration-300",
            atTop ? "text-white" : "text-foreground"
          )}
        >
          SPOT
        </a>
        <nav
          className={cn(
            "hidden sm:flex items-center gap-6 text-sm transition-colors duration-300",
            atTop ? "text-white/70" : "text-muted-foreground"
          )}
        >
          <a
            href="#how"
            className={cn(
              "transition-colors",
              atTop ? "hover:text-white" : "hover:text-foreground"
            )}
          >
            How it works
          </a>
          <a
            href="#faq"
            className={cn(
              "transition-colors",
              atTop ? "hover:text-white" : "hover:text-foreground"
            )}
          >
            FAQ
          </a>
        </nav>
        <a
          href={SMS_LINK}
          className={cn(
            "rounded-full px-5 h-8 gap-1.5 inline-flex items-center text-sm font-medium transition-all duration-300",
            atTop
              ? "bg-white text-black hover:bg-white/90"
              : "bg-primary text-primary-foreground hover:bg-primary/80"
          )}
        >
          <MessageSquare className="size-3.5" />
          Text Spot
        </a>
      </div>
    </header>
  );
}
