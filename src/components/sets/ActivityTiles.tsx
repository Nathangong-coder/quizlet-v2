"use client";

import React from "react";
import Link from "next/link";
import { Gamepad2, RotateCcw, GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";

interface ActivityTileProps {
  id: string;
  userId?: string;
}

interface Tile {
  label: string;
  href: (id: string) => string;
  icon: React.ElementType;
  requiresAuth: boolean;
}

/**
 * One shared surface for all three tiles.
 *
 * They used to carry three different chart hues. Three activities really are
 * three categories, so that was defensible colour — but these sit at the top of
 * the set page now, and three saturated blocks there read as three unrelated
 * statuses rather than one row of things you can do. The icon and the label
 * still tell them apart, which is what colour was doing anyway.
 */
const TILE_SURFACE =
  "bg-card text-foreground border-border shadow-[var(--shadow-sm)] hover:border-primary/60 hover:shadow-[var(--shadow-md)]";

const TILES: Tile[] = [
  {
    label: "Matching Game",
    href: (id) => `/sets/${id}/match`,
    icon: Gamepad2,
    requiresAuth: false,
  },
  {
    label: "Review Mode",
    href: (id) => `/sets/${id}/review`,
    icon: RotateCcw,
    requiresAuth: true,
  },
  {
    label: "Quiz",
    href: (id) => `/sets/${id}/quiz`,
    icon: GraduationCap,
    requiresAuth: true,
  },
];

export function ActivityTiles({ id, userId }: ActivityTileProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-6">
      {TILES.map((tile) => {
        const isLocked = tile.requiresAuth && !userId;

        // A locked tile is not a link. It used to render as one and then
        // preventDefault into `alert()` — a blocking browser modal, announced
        // to nobody, on an element that advertised itself as navigable.
        if (isLocked) {
          return (
            <div
              key={tile.label}
              aria-disabled="true"
              title="Sign in to use this activity"
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg border px-3 py-3 text-sm",
                "opacity-60 cursor-not-allowed",
                TILE_SURFACE,
              )}
            >
              <tile.icon size={16} className="shrink-0" aria-hidden="true" />
              <span className="font-medium truncate">{tile.label}</span>
              <span className="text-xs text-muted-foreground">(sign in)</span>
            </div>
          );
        }

        return (
          <Link
            key={tile.label}
            href={tile.href(id)}
            className={cn(
              "flex items-center justify-center gap-2 rounded-lg border px-3 py-3 text-sm transition-[border-color,box-shadow]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              TILE_SURFACE,
            )}
          >
            <tile.icon size={16} className="shrink-0" aria-hidden="true" />
            <span className="font-medium truncate">{tile.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
