"use client";

import { useChosenColor } from "@/components/app-data";
import { avatarColor, initialsFor } from "@/lib/format";

export function Avatar({
  id,
  name,
  size = 28,
  ring = false,
  color,
}: {
  id: string;
  name?: string | null;
  size?: number;
  ring?: boolean;
  /** Fuerza un color (p. ej. para previsualizar al elegirlo). */
  color?: string | null;
}) {
  const chosen = useChosenColor(id);
  return (
    <div
      title={name || undefined}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color || avatarColor(id, chosen),
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.max(10, size * 0.4),
        fontWeight: 700,
        flex: "0 0 auto",
        border: ring ? "2px solid var(--surface)" : "none",
        fontFamily: "var(--font-body)",
      }}
    >
      {initialsFor(name)}
    </div>
  );
}
