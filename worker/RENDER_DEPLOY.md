# Desplegar el worker en Render

El repositorio incluye `render.yaml` en la raíz. Render lo utiliza para crear un **Background Worker** privado que construye `worker/Dockerfile`, instala FFmpeg y mantiene escuchando la cola de Supabase.

## Pasos

1. Abre https://dashboard.render.com/blueprints/new
2. Conecta GitHub y selecciona `admperdilnet-netizen/AI`.
3. Render detectará `render.yaml`. Revisa el servicio `dominican-clipper-ffmpeg`.
4. Cuando solicite `SUPABASE_SERVICE_ROLE_KEY`, pega la clave secreta de servidor de Supabase (Project Settings → API Keys → secret/service_role). Nunca la pongas en GitHub, en `index.html), ni en el navegador.
5. Pulsa **Apply** para crear el servicio.
6. Espera a que el build y deploy terminen. En los logs debe aparecer: `Dominican Clipper FFmpeg worker started`.

## Supabase Auth

En Supabase → Authentication → Sign In / Providers, activa **Anonymous sign-ins**. La página crea una sesión temporal de visitante para proteger cada trabajo y sus archivos.

## Plan y costes

El Blueprint comienza con el plan gratuito de Render si está disponible para tu cuenta/servicio. El procesamiento de video consume CPU y memoria; para videos grandes o uso frecuente puede ser necesario cambiar el plan desde Render. Revisa el precio que muestra Render antes de confirmar cualquier cambio de plan.

## Comprobación

1. Abre Dominican Clipper, carga un video propio y selecciona los fragmentos.
2. Pulsa **Crear clips en servidor**.
3. El trabajo debe pasar de `queued` a `processing` y luego a `done`.
4. Descarga el MP4 desde el enlace que aparece en la página.

Si permanece en `queued`, revisa que el worker esté desplegado y que las dos variables de entorno estén configuradas. Si falla, consulta los logs de Render y el mensaje del trabajo en la página.

El worker actual limita cada clip a 180 segundos. Los videos fuente se guardan en Storage; configura también las cuotas de Storage y una política de retención/limpieza para evitar acumular originales y resultados.
