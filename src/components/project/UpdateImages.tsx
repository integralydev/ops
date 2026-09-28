"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export const UPDATES_BUCKET = "project-files";

// Miniaturas de las capturas de una actualización. El bucket es privado, así
// que pedimos URLs firmadas (válidas 1 h) y al hacer clic se abre a tamaño real.
export function UpdateImages({ paths, size = 96 }: { paths: string[]; size?: number }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = paths.join("|");

  useEffect(() => {
    if (!paths.length) return;
    let alive = true;
    createClient()
      .storage.from(UPDATES_BUCKET)
      .createSignedUrls(paths, 3600)
      .then(({ data }) => {
        if (!alive || !data) return;
        const map: Record<string, string> = {};
        data.forEach((d) => {
          if (d.path && d.signedUrl) map[d.path] = d.signedUrl;
        });
        setUrls(map);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!paths.length) return null;

  return (
    <div className="update-images">
      {paths.map((p) =>
        urls[p] ? (
          <a key={p} href={urls[p]} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={urls[p]} alt="Captura" style={{ width: size, height: size }} />
          </a>
        ) : (
          <span key={p} className="update-img-placeholder" style={{ width: size, height: size }} />
        ),
      )}
    </div>
  );
}
