# Servicio seguro de La Cucharita

Este Worker permite que solo la cuenta GitHub `mburbanot` publique cambios en `la-cucharita-recetas.json`. El token con permisos de escritura permanece como secreto de Cloudflare; nunca se envía al navegador.

## Preparación

Necesitas una cuenta de Cloudflare y Node.js/npm para ejecutar Wrangler.

1. Crea un token fine-grained de GitHub para el propietario `mburbanot`, limitado al repositorio `Recetario`, con permiso **Contents: Read and write**. No lo compartas ni lo añadas a archivos del proyecto.
2. En una terminal, entra en `cloudflare-worker`, inicia sesión en Cloudflare y despliega el Worker por primera vez:

   ```powershell
   npx wrangler login
   npx wrangler deploy
   ```

3. En la salida, copia la URL `*.workers.dev`. Crea una aplicación OAuth en GitHub, en **Settings → Developer settings → OAuth Apps**:
   - Homepage URL: `https://mburbanot.github.io/Recetario/`
   - Authorization callback URL: la URL del Worker seguida de `/auth/callback`.
4. En `wrangler.toml`, configura `GITHUB_OAUTH_CLIENT_ID` con el Client ID de GitHub y `GITHUB_OAUTH_CALLBACK_URL` con la URL de retorno exacta.
5. Guarda las credenciales como secretos del Worker. Wrangler solicitará cada valor en la terminal:

   ```powershell
   npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET
   npx wrangler secret put GITHUB_CONTENTS_TOKEN
   npx wrangler secret put SESSION_SECRET
   ```

   `SESSION_SECRET` debe ser aleatorio y tener al menos 32 caracteres. Puedes generar uno con:

   ```powershell
   node -p "require('node:crypto').randomBytes(32).toString('base64url')"
   ```

6. Vuelve a desplegar el Worker. En `api-config.js`, configura la URL `*.workers.dev` que copiaste, sin una barra final, y publica los archivos estáticos del sitio para activar la conexión.

## Límites y comportamiento

- La sesión de administración dura dos horas y solo se concede al usuario GitHub configurado en `ADMIN_GITHUB_LOGIN`.
- El Worker comprueba el origen del sitio, valida cada receta y limita el catálogo a 900 KB para mantener las actualizaciones dentro de un tamaño manejable.
- Si dos cambios compiten, la segunda actualización se rechaza para que no sobrescriba silenciosamente la primera. Recarga el sitio y vuelve a intentarlo.
- Las recetas se sirven públicamente desde GitHub Pages; una actualización puede tardar un breve tiempo en reflejarse por caché.
