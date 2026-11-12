# Dominican Clipper — FFmpeg export worker

Este contenedor procesa la cola `public.export_jobs` y genera MP4 en el bucket privado `clips`. Supabase Edge Functions no renderizan video; este proceso necesita un host que admita Docker y FFmpeg.

## Variables de entorno

- `SUPABASE_URL`: URL del proyecto Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: clave secreta `service_role` del proyecto. **Solo en el servidor; nunca en index.html, GitHub Pages ni el navegador.**
- `WORKER_POLL_MS` (opcional): espera entre consultas cuando la cola está vacía; predeterminado 3000 ms.

## Ejecutar con Docker

```bash
docker build -t dominican-clipper-worker ./worker
docker run --restart unless-stopped \
  -e SUPABASE_URL="https://PROJECT.supabase.co" \
  -e SUPABASE_SERVICE_ROLE_KEY="SECRET_SERVER_KEY" \
  dominican-clipper-worker
```

Despliega la carpeta `worker/` como un servicio de tipo **Background Worker** que soporte Docker. Configura las dos variables secretas en el panel del proveedor. No pongas la clave secreta en el repositorio.

## Contrato de la cola

El worker reclama un trabajo mediante `rpc('claim_job')`. Cada fila debe tener `source_path` dentro de la carpeta UUID del usuario y `params.start` / `params.end` en segundos. Admite clips de 1 a 180 segundos. El resultado se guarda en `clips/{user_id}/{job_id}.mp4`.

El formato vertical usa 1080×1920 y conserva el fotograma completo sobre un fondo ampliado y desenfocado. Para `params.aspect = "original"` se conserva la relación de aspecto original.

## Requisitos

- Ejecutar la migración `dominican_clipper_server_exports` en Supabase.
- En Supabase Dashboard → Authentication → Sign In / Providers, activar **Anonymous sign-ins**. La web crea una sesión anónima si no existe una sesión de usuario.
- El límite real de subida depende de Storage → Settings → Global file size limit y del plan. El valor configurado en el bucket no puede superar el límite global.
- El worker debe permanecer activo. Si no está desplegado, los trabajos quedarán en estado `queued`.
