# Levántate

App web (instalable como app en el móvil u ordenador) que te avisa cuando llevas demasiado tiempo sentado y otra vez cuando ya puedes volver a sentarte.

## Funciones

- **Ciclo sentado → de pie** con aviso por notificación, sonido y vibración en cada cambio.
- **Pautas basadas en estudios médicos**:
  | Pauta | Sentado | De pie / moviéndote | Fuente |
  |---|---|---|---|
  | Recomendado (por defecto) | 30 min | 5 min | Universidad de Columbia, Diaz et al. 2023 |
  | Cornell 20-8-2 | 20 min | 8 de pie + 2 moviéndote | Ergonomía de la Universidad de Cornell |
  | Mínimo | 50 min | 10 min | No superar 60 min seguidos sentado |
  | Personalizado | a tu gusto | a tu gusto | |
- **Ejercicios sugeridos** durante cada pausa (estiramientos, sentadillas, caminar, beber agua…).
- **Regla 20-20-20** opcional para descansar la vista.
- **Horario laboral**: se pausa sola fuera de tu horario y se reanuda al volver.
- **Estadísticas**: pausas hechas, minutos de pie, objetivo diario y gráfica de los últimos 7 días.
- Pausar, saltar fase, y el estado se conserva si recargas la página.
- Funciona sin conexión (PWA) y con modo oscuro automático.

> Es una ayuda, no un consejo médico. Si tienes alguna patología consulta con tu médico.

## Uso

Abre la web publicada en GitHub Pages, pulsa **Empezar** y acepta las notificaciones. La pestaña debe seguir abierta (puede estar en segundo plano). Desde el menú del navegador puedes **instalarla como app**.

## Publicación (GitHub Pages)

1. En el repositorio: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
2. Elige la rama con la app y la carpeta **/ (root)**, y guarda.
3. En un par de minutos estará en `https://hectorlagocarrera.github.io/levantarse/`. Cada push a esa rama la actualiza.

## Avisos con el móvil bloqueado (servidor gratuito en Cloudflare)

iOS congela las webs cuando bloqueas el iPhone, así que los avisos a su hora los envía un pequeño servidor
(`worker/`, Cloudflare Workers + Durable Objects, gratis) mediante notificaciones push. La app le manda su ciclo
y el servidor calcula los mismos cambios de fase con `schedule.js`, el mismo código que usa la app.

Configuración (una sola vez):

1. Crea una cuenta gratuita en https://dash.cloudflare.com/sign-up y entra en **Workers & Pages**
   (si te pide elegir un subdominio `*.workers.dev`, elige uno).
2. Copia tu **Account ID** (aparece en la página de Workers & Pages, columna derecha).
3. Crea un token: **My Profile → API Tokens → Create Token → plantilla «Edit Cloudflare Workers»** → Continue → Create.
4. En GitHub: **Settings → Secrets and variables → Actions → New repository secret** y crea:
   - `CLOUDFLARE_API_TOKEN` con el token.
   - `CLOUDFLARE_ACCOUNT_ID` con el Account ID.
5. En la pestaña **Actions**, ejecuta «Publicar servidor de avisos» (**Run workflow**).
6. Pon la dirección que aparece al final (`https://levantarse-push.<tu-subdominio>.workers.dev`) en `config.js`.

En el iPhone (iOS 16.4 o posterior): abre la web en Safari → **Compartir → Añadir a pantalla de inicio**, abre la app
desde ese icono, pulsa **Empezar** y acepta las notificaciones. En Ajustes, «Probar con el móvil bloqueado» envía un
aviso de prueba a los 10 segundos.

Notas:
- Los avisos de vista 20-20-20 y el «ahora muévete» de Cornell solo suenan con la app abierta.
- Con el móvil bloqueado suena el sonido de notificación de iOS; el sonido elegido en la app solo se oye con la app abierta.
- Sin horario laboral, el servidor se detiene solo tras 14 horas por si olvidas pararlo.

## Desarrollo local

La app no necesita compilación: es HTML, CSS y JavaScript puro.

```bash
python3 -m http.server 8000
# abre http://localhost:8000

# pruebas de la lógica de ciclos
node worker/test/schedule.test.mjs

# servidor de avisos en local
cd worker && npx wrangler dev
```
