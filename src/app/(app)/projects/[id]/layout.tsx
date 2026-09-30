// La página del proyecto es un Client Component, así que la configuración del
// segmento va aquí. Leer un PDF con IA (importar scope) puede tardar más que el
// tiempo por defecto de las Server Actions.
export const maxDuration = 120;

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  return children;
}
