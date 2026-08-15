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
  color: string;
}

const TILES: Tile[] = [
  {
    label: "Matching Game",
    href: (id) => `/sets/${id}/match`,
    icon: Gamepad2,
    requiresAuth: false,
    // Three activities genuinely are three categories, so this is legitimate
    // categorical colour — but it now comes from the chart tokens rather than
    // three unrelated Tailwind palettes, and each tile also carries a distinct
    // icon and label, so colour is never the sole signal.
    color: "bg-chart-1/10 text-chart-1 border-chart-1/25 hover:bg-chart-1/20",
  },
  {
    label: "Review Mode",
    href: (id) => `/sets/${id}/review`,
    icon: RotateCcw,
    requiresAuth: true,
    color: "bg-chart-3/10 text-chart-3 border-chart-3/25 hover:bg-chart-3/20",
  },
  {
    label: "Quiz",
    href: (id) => `/sets/${id}/quiz`,
    icon: GraduationCap,
    requiresAuth: true,
    color: "bg-chart-4/10 text-chart-4 border-chart-4/25 hover:bg-chart-4/20",
  },
];

export function ActivityTiles({ id, userId }: ActivityTileProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
      {TILES.map((tile) => {
        const isLocked = tile.requiresAuth && !userId;

        return (
          <Link
            key={tile.label}
            href={tile.href(id)}
            className={cn(
              "flex flex-col items-center justify-center p-6 rounded-xl border transition-all group",
              isLocked ? "opacity-60 cursor-not-allowed grayscale" : "hover:scale-105 hover:shadow-md",
              tile.color
            )}
            onClick={(e) => {
              if (isLocked) {
                e.preventDefault();
                alert("Please sign in to access this activity.");
              }
            }}
          >
            <tile.icon size={40} className="mb-3 group-hover:scale-110 transition-transform" />
            <span className="font-semibold text-center">{tile.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
