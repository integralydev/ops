import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MfaGate } from "@/components/finance/MfaGate";
import { FinanceApp } from "@/components/finance/FinanceApp";

// Finanzas: solo propietarios. A quien no lo es, la ruta le responde 404 (no
// "sin permiso": ni siquiera se insinúa que existe). La protección real está
// en la base de datos: RLS con is_owner() y sesión verificada en dos pasos.
export const dynamic = "force-dynamic";

export default async function FinanzasPage() {
  const supabase = await createClient();
  const { data: owner } = await supabase.rpc("is_owner");
  if (owner !== true) notFound();
  return (
    <MfaGate>
      <FinanceApp />
    </MfaGate>
  );
}
