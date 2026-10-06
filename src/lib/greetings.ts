// Saludos de la pantalla de Inicio, según la hora local de quien entra y el día
// de la semana. {name} = nombre de pila de quien ha iniciado sesión. Para
// añadir frases, basta con sumarlas a la lista que toque.

type Slot = "madrugada" | "temprano" | "manana" | "mediodia" | "tarde" | "noche";

const BY_SLOT: Record<Slot, string[]> = {
  // 0:00 – 5:59
  madrugada: [
    "¿Tan tarde por aquí, {name}?",
    "Modo búho activado, {name} 🦉",
    "{name}, mañana también existe 🌙",
    "Las mejores ideas salen a estas horas, ¿eh, {name}?",
    "Ni los servidores están despiertos, {name}",
  ],
  // 6:00 – 8:59
  temprano: [
    "Un café y a currar en Integraly ☕",
    "Madrugando, {name}. Eso es actitud",
    "Buenos días, {name}. El día es tuyo",
    "Primero en llegar, {name} 🏁",
  ],
  // 9:00 – 12:59
  manana: [
    "Buenos días, {name} ☀️",
    "¿Qué sacamos adelante hoy, {name}?",
    "A por la mañana, {name}",
    "Mañana productiva a la vista, {name}",
  ],
  // 13:00 – 15:59
  mediodia: [
    "¿Ya has comido, {name}? 🍽️",
    "Sobremesa productiva, {name}",
    "Buenas tardes, {name}",
    "Recargando pilas para la tarde, {name} 🔋",
  ],
  // 16:00 – 19:59
  tarde: [
    "Buenas tardes, {name}",
    "Último empujón del día, {name} 💪",
    "La tarde rinde, {name}",
    "¿Cerramos algo hoy, {name}?",
  ],
  // 20:00 – 23:59
  noche: [
    "Buenas noches, {name} 🌙",
    "¿Echando horas extra, {name}?",
    "¿Una última vuelta antes de cerrar, {name}?",
    "Cerrando el día con buena nota, {name}",
  ],
};

const WEEKEND = [
  "¿En fin de semana, {name}? Eso es compromiso",
  "Hoy no se curra… salvo tú, {name} 🫡",
  "Finde y en Integraly. Respeto, {name}",
];

const MONDAY_MORNING = ["Lunes, {name}. Café doble ☕☕", "Arrancamos semana, {name} 🚀"];
const FRIDAY_AFTERNOON = ["Viernes por la tarde, {name}. Ya casi 🍻", "Último empujón de la semana, {name}"];

function slotFor(hour: number): Slot {
  if (hour < 6) return "madrugada";
  if (hour < 9) return "temprano";
  if (hour < 13) return "manana";
  if (hour < 16) return "mediodia";
  if (hour < 20) return "tarde";
  return "noche";
}

function pick<T>(list: T[]) {
  return list[Math.floor(Math.random() * list.length)];
}

export function pickGreeting({ name, now = new Date() }: { name: string; now?: Date }) {
  const hour = now.getHours();
  const day = now.getDay(); // 0 = domingo
  const slot = slotFor(hour);

  // De madrugada manda la hora; si no, lo especial (finde, lunes, viernes)
  // gana peso, mezclado con los saludos normales.
  const pool = [...BY_SLOT[slot]];
  if (slot !== "madrugada") {
    if (day === 0 || day === 6) pool.push(...WEEKEND, ...WEEKEND);
    else if (day === 1 && hour < 13) pool.push(...MONDAY_MORNING, ...MONDAY_MORNING);
    else if (day === 5 && hour >= 15) pool.push(...FRIDAY_AFTERNOON, ...FRIDAY_AFTERNOON);
  }

  return pick(pool).replaceAll("{name}", name);
}
