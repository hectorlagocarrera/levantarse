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

1. En el repositorio: **Settings → Pages → Source: GitHub Actions**.
2. Cada push a `main` despliega automáticamente con `.github/workflows/pages.yml` (también se puede lanzar a mano desde la pestaña *Actions*).
3. La URL será `https://<usuario>.github.io/levantarse/`.

## Desarrollo local

No necesita compilación: es HTML, CSS y JavaScript puro.

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```
