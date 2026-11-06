import type { IconName } from "@/components/Icon";

// Recorrido visual de un proyecto (mismo lenguaje que el portal de cliente):
// cada estado tiene su icono, su tono y su posición en el camino.
export type Tone = "p" | "ok" | "w" | "g" | "in";

export const CLIENT_PATH = [
  { value: "descubrimiento", short: "Conocer" },
  { value: "propuesta", short: "Prueba" },
  { value: "presupuesto", short: "Presupuesto" },
  { value: "desarrollo", short: "Desarrollo" },
  { value: "testing", short: "Testing" },
  { value: "mantenimiento", short: "En producción" },
] as const;

export const LAB_PATH = [
  { value: "idea", short: "Idea" },
  { value: "construccion", short: "Construcción" },
  { value: "validacion", short: "Validación" },
  { value: "escalado", short: "Escalado" },
] as const;

const LOOK: Record<string, { icon: IconName; tone: Tone }> = {
  descubrimiento: { icon: "spark", tone: "p" },
  propuesta: { icon: "flask", tone: "p" },
  presupuesto: { icon: "file", tone: "p" },
  desarrollo: { icon: "code", tone: "in" },
  testing: { icon: "check", tone: "in" },
  mantenimiento: { icon: "pulse", tone: "ok" },
  pausado: { icon: "pause", tone: "w" },
  cerrado: { icon: "check", tone: "g" },
  idea: { icon: "bulb", tone: "p" },
  construccion: { icon: "code", tone: "in" },
  validacion: { icon: "users", tone: "in" },
  escalado: { icon: "rocket", tone: "ok" },
  aparcado: { icon: "pause", tone: "g" },
};

export function phaseLook(status: string) {
  return LOOK[status] || { icon: "folder" as IconName, tone: "g" as Tone };
}

/** Posición en el camino (0-based) o -1 si está fuera (pausado, cerrado, aparcado). */
export function phaseIndex(status: string, lab: boolean) {
  const path = lab ? LAB_PATH : CLIENT_PATH;
  return path.findIndex((x) => x.value === status);
}
