# Integraly Ops

Herramienta interna de gestión de proyectos, tareas y archivos para Integraly
AI Solutions. Next.js + Supabase (base de datos, autenticación y
almacenamiento de archivos), pensada para desplegarse en Vercel.

- Cuentas individuales por email (enlace mágico, sin contraseñas)
- Cada proyecto tiene un encargado y developers asignados; los developers
  solo ven los proyectos donde están asignados — reforzado con Row Level
  Security en la base de datos, no solo en la interfaz
- Tareas, archivos y notas por proyecto
- Ficha de clientes
- Todo en tiempo real entre pestañas y personas (Supabase Realtime)

## 1. Crear el proyecto en Supabase

1. Ve a [supabase.com](https://supabase.com) → **New project** (el plan
   gratuito es de sobra para este uso).
2. Cuando esté listo, abre **SQL Editor** → pega el contenido entero de
   [`supabase/schema.sql`](./supabase/schema.sql) → **Run**. Esto crea todas
   las tablas, los permisos (RLS) y el bucket de archivos.
3. En **Authentication → Providers → Email**, desactiva **"Allow new users to
   sign up"**. Así solo puede entrar quien haya sido invitado desde la propia
   app (pestaña Equipo) — nadie puede auto-registrarse.
4. En **Authentication → URL Configuration**, añade la URL donde vivirá la
   app (la de Vercel, más abajo) tanto en **Site URL** como en **Redirect
   URLs** (con `/auth/callback` al final, p. ej.
   `https://tu-app.vercel.app/auth/callback`). Mientras pruebas en local,
   añade también `http://localhost:3000/auth/callback`.

### Primer arranque: crear al primer administrador

Como el auto-registro está desactivado, la primera cuenta (probablemente la
tuya, Eloi) hay que crearla a mano una única vez:

1. **Authentication → Users → Add user → Create new user**. Pon tu email,
   marca **Auto Confirm User**, y crea el usuario. Copia el **User UID** que
   te muestra.
2. Vuelve a **SQL Editor** y ejecuta (sustituyendo el UID y tu nombre):
   ```sql
   insert into profiles (id, role, full_name)
   values ('PEGA-AQUI-EL-UID', 'admin', 'Eloi Navarro');
   ```
3. Ya puedes entrar en la app con ese email pidiendo un enlace mágico desde
   `/login`. Una vez dentro, desde **Equipo** puedes invitar a Francesc,
   Gerardo, Michelle y Emanuel por email — a ellos no hace falta crearles
   nada a mano, la app les manda la invitación.

### Claves de API que vas a necesitar

En **Project Settings → API**:

- `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
- `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role secret` → `SUPABASE_SERVICE_ROLE_KEY` (**nunca** la pongas en
  una variable `NEXT_PUBLIC_*`, ni la subas a git — solo se usa en el
  servidor para enviar invitaciones)

## 2. Desarrollo en local

```bash
npm install
cp .env.example .env.local   # y rellena las 3 claves de arriba
npm run dev
```

Abre `http://localhost:3000`.

## 3. Subir a GitHub

```bash
git init
git add .
git commit -m "Integraly Ops"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/integraly-ops.git
git push -u origin main
```

(Crea antes el repositorio vacío en GitHub si no lo has hecho.)

## 4. Desplegar en Vercel

1. En [vercel.com](https://vercel.com) → **Add New → Project** → importa el
   repositorio de GitHub que acabas de crear.
2. En **Environment Variables**, añade las mismas 3 variables de
   `.env.example` con sus valores reales.
3. Deploy. Cuando termine, copia la URL que te da Vercel y vuelve al paso 1
   de Supabase para añadirla en **Site URL** / **Redirect URLs** (si no lo
   hiciste ya con la URL definitiva).
4. A partir de aquí, cada `git push` a `main` despliega una nueva versión
   automáticamente. Puedes seguir pidiéndome cambios aquí y te iré dando el
   código actualizado para hacer commit, o editarlo tú directamente.

## Estructura del proyecto

```
supabase/schema.sql        Esquema completo de la base de datos + permisos
src/lib/supabase/          Clientes de Supabase (browser, server, middleware)
src/lib/hooks/             Hooks de datos en tiempo real (proyectos, tareas…)
src/app/login, /onboarding, /auth/callback   Autenticación
src/app/(app)/...          Páginas autenticadas (dashboard, proyectos, clientes, equipo)
src/components/            Componentes de UI compartidos
```

## Notas sobre permisos

La app usa **Row Level Security** de Postgres: los permisos no dependen solo
de lo que la interfaz decide mostrar, sino de reglas en la propia base de
datos (`supabase/schema.sql`). Un developer que intente leer proyectos ajenos
directamente contra la API de Supabase, sin pasar por la interfaz, tampoco
podría — la base de datos se lo impide. Esto es más estricto que la primera
versión (el artifact de Claude), que solo filtraba en el cliente.

## Finanzas (solo propietarios)

`/finanzas` y las tablas `fin_*` son solo para propietarios (tabla `owners`,
editable únicamente desde el SQL Editor) con sesión verificada en dos pasos
(aal2): lo exige la base de datos (`can_see_finance()`). Reglas que no se
rompen: nada de `fin_*` en Realtime, sin triggers de actividad ni correos,
sin `service_role`.

Criterios de cálculo (`src/lib/finance.ts`):

- "Queda" y la línea continua del gráfico: solo lo confirmado. Lo probable va
  aparte, ponderado por su probabilidad.
- En la previsión, todas las salidas salen de `fin_scheduled`; el coste dev e
  infra de los tramos de mensualidad solo cuenta para la rentabilidad.
- Caja por fecha de cobro (`fin_invoices.paid_date`, o `date` si no hay);
  "Facturado" por fecha de factura.
- Días de pago (`payment_terms_days`): cada 30 días = un mes natural, y se
  aplican a todas las facturas pendientes del proyecto.
- Programados anuales: fila propia, como los únicos.

### Webhook de Stripe

`/api/stripe/webhook` no guarda nada por sí mismo: pasa el cuerpo y la firma a
`fin_stripe_webhook` (SQL, `security definer`, solo la puede ejecutar `anon`),
que verifica la firma con el secreto guardado en `fin_secrets` (sin acceso por
API). Eventos: `invoice.paid`, `checkout.session.completed` y
`checkout.session.async_payment_succeeded`. Vincula el cobro a la mensualidad
por Payment Link, customer o email; si no encaja, queda en
`fin_stripe_pending` y se vincula a mano desde Finanzas. Para cambiar el
secreto (SQL Editor):

```sql
insert into fin_secrets (key, value) values ('stripe_webhook_secret', 'whsec_...')
on conflict (key) do update set value = excluded.value;
```
