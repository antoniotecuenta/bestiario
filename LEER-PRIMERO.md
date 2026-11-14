# Bestiario · cómo ponerlo en línea

Tres partes, unos 20 minutos en total. Todo es gratis.

## 1. Supabase (la nube donde se guardan tus datos)

1. Entra a supabase.com, crea una cuenta y un proyecto nuevo (región: la más cercana, por ejemplo São Paulo).
2. Ve a **SQL Editor → New query**, pega todo el contenido de `schema.sql` y dale **Run**.
3. Ve a **Project Settings → API** y copia dos cosas: la **Project URL** y la **anon public key**.
4. Abre `config.js` y reemplaza `https://TU-PROYECTO.supabase.co` y `PEGA-AQUI-TU-ANON-KEY` por esos dos valores. La anon key puede quedar pública: las reglas del paso 2 impiden que alguien lea datos que no son suyos.

## 2. GitHub Pages (la web)

1. En github.com crea un repositorio nuevo, por ejemplo `bestiario` (público, porque Pages gratis lo pide).
2. **Add file → Upload files** y arrastra todo el contenido de esta carpeta (no la carpeta en sí: `index.html` tiene que quedar en la raíz). Dale **Commit changes**.
3. **Settings → Pages → Branch: main / root → Save**. En un minuto tu web vive en `https://TU-USUARIO.github.io/bestiario/`.

## 3. Conectar los dos

1. En Supabase: **Authentication → URL Configuration**. En **Site URL** pon la dirección de tu web (`https://TU-USUARIO.github.io/bestiario/`) y agrégala también en **Redirect URLs**.
2. (Recomendado, para entrar desde la app instalada) **Authentication → Emails → Magic Link**: agrega al mensaje la línea `Tu código: {{ .Token }}`. Así puedes escribir el código en vez de abrir el enlace.
3. Abre tu web, toca la píldora de abajo («Solo en este dispositivo…»), escribe tu correo y entra.
4. Ya dentro: **Importar** y elige `bestiario-respaldo-2026-11-14.json` (te lo di aparte, con Kaladin y Termolis).
5. Cuando ya hayas entrado en todos tus dispositivos: **Authentication → Sign In / Providers → desactiva “Allow new users to sign up”**. Así nadie más puede crear cuentas en tu proyecto.

## Instalarla en el celular

Abre la web en Chrome → menú ⋮ → **Agregar a la pantalla principal / Instalar app**. Funciona sin internet y sincroniza cuando vuelve la conexión.

## Cómo funciona el guardado

- Todo se guarda primero en el dispositivo y luego se sube a la nube.
- Si usas dos dispositivos, gana la versión modificada más recientemente. Evita golpear rivales en los dos a la vez estando sin conexión.
- **Exportar** te baja un respaldo `.json` cuando quieras.

## Para hacer cambios después

Edita `index.html` y vuelve a subirlo al repositorio. Si cambias archivos y el celular no ve la versión nueva, sube el número en `sw.js` (`bestiario-v1` → `bestiario-v2`).
