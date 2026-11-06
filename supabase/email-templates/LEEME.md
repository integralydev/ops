# Correos de Supabase con la marca de Integraly

Supabase manda tres correos: el enlace para entrar desde el login, el de cambiar la contraseña y la invitación del equipo. El de invitación al portal del cliente ya no pasa por Supabase, lo mandamos nosotros por Resend.

Para que salgan como **Integraly** y no como Supabase, hay que hacer dos cosas, las dos en el panel de Supabase.

## 1. Que salgan por nuestro correo (Resend)
Supabase → **Project Settings → Authentication → SMTP Settings** → activar **Enable custom SMTP**:

| Campo | Valor |
|---|---|
| Sender email | `hello@integralyaisolutions.com` |
| Sender name | `Integraly` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | la API key de Resend (la misma del OPS; está en Resend → API Keys) |

Ahí mismo, subir **Email OTP Expiration** a `86400` (24 h).

## 2. Que lleven nuestro texto y logo
Supabase → **Authentication → Emails → Templates**. En cada plantilla, pegar el asunto y el HTML del archivo:

| Plantilla de Supabase | Asunto | Archivo |
|---|---|---|
| Magic Link | `Tu enlace para entrar en Integraly` | `enlace-de-acceso.html` |
| Reset Password | `Crea tu contraseña nueva de Integraly` | `cambiar-contrasena.html` |
| Invite user | `Te damos acceso al OPS de Integraly` | `invitacion-equipo.html` |
