/**
 * Ruta interna segura para redirigir después de entrar (?next=...).
 * Solo rutas del propio OPS: nada de "//otra.web", "/\otra.web" ni URLs
 * absolutas, que el navegador convertiría en un salto a otro dominio.
 */
export function safeNext(param: string | null | undefined, fallback: string): string {
  if (!param || !param.startsWith("/") || param.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f]/.test(param)) return fallback;
  try {
    const base = "https://ops.invalid";
    const u = new URL(param, base);
    if (u.origin !== base) return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
