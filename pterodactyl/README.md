# Meowcord en Pterodactyl Panel

Esta carpeta contiene la configuración necesaria para desplegar y ejecutar **Meowcord** en el panel de control **Pterodactyl**.

---

## 1. Workflow de GitHub Actions (Docker Hub de GitHub / GHCR)

El archivo `.github/workflows/docker-publish.yml` se encarga de compilar y publicar automáticamente las imágenes de Docker en **GitHub Container Registry (GHCR)**:

- **Imagen del Servidor:** `ghcr.io/<tu-usuario-o-organizacion>/meowcord:latest`
- **Imagen SFU WebRTC (opcional):** `ghcr.io/<tu-usuario-o-organizacion>/meowcord-sfu:latest`

### Disparadores automáticos:
- Cada `push` a la rama `main`.
- Creación de etiquetas de versión (ejemplo: `v0.1.0`).
- Disparador manual desde la pestaña **Actions** en GitHub (**Run workflow**).

### Permisos necesarios en GitHub:
Por defecto, GitHub Actions utiliza el token automático `${{ secrets.GITHUB_TOKEN }}` con permisos de escritura en paquetes (`packages: write`). Asegúrate de que en tu repositorio:
`Settings` -> `Actions` -> `General` -> `Workflow permissions` esté configurado en **"Read and write permissions"**.

---

## 2. Cómo importar el Egg en Pterodactyl

1. Descarga el archivo [`egg-meowcord.json`](file:///pterodactyl/egg-meowcord.json).
2. Accede a tu panel de administración de Pterodactyl (**Admin Panel**).
3. Dirígete a la sección **Nests**.
4. Selecciona un Nest existente (o crea uno nuevo, por ejemplo `Meowcord` o `Discord Servers`).
5. Haz clic en el botón superior derecho **Import Egg**.
6. Selecciona el archivo `egg-meowcord.json` y guarda.

---

## 3. Configuración del Servidor en Pterodactyl

Al crear un servidor usando este Egg, configura los siguientes parámetros esenciales:

### A. Imagen de Docker
En la opción **Docker Image** del servidor, indica la ruta de la imagen construida por tu GitHub Action:
```
ghcr.io/<tu-usuario>/meowcord:latest
```
*(Asegúrate de que el paquete en GitHub sea público o que tu nodo de Pterodactyl tenga acceso al registro)*.

### B. Base de Datos (PostgreSQL)
Meowcord requiere una base de datos PostgreSQL.
- Puedes utilizar la pestaña **Databases** de Pterodactyl para crear una base de datos PostgreSQL en el mismo nodo.
- Copia la cadena de conexión e ingrésala en la variable `DATABASE`:
  ```
  postgres://usuario:contraseña@host:5432/basededatos
  ```
- *Nota: Meowcord aplicará automáticamente todas las tablas y migraciones iniciales durante el primer arranque.*

### C. Dominio / URL Pública (`DOMAIN`)
- Ingresa el dominio o la IP y puerto público desde donde los usuarios accederán a la web y API:
  - Con dominio y SSL: `https://chat.tudominio.com`
  - Con IP directa y puerto: `http://123.45.67.89:3001`
- **Importante:** No incluyas una barra final `/`.

### D. Asignación de Puertos
- Asigna el puerto principal al servidor en Pterodactyl (ej. `3001`). Meowcord lo vinculará automáticamente.
- Si vas a activar el servidor de voz WebRTC (`ENABLE_SFU=true`), añade una asignación de puerto adicional **UDP** (ej. `50000`) y colócalo en la variable `WRTC_PORT`.

---

## 4. Persistencia de Archivos y Primer Inicio

El contenedor y el script de inicio están adaptados para Pterodactyl:
- **Primer inicio:** Meowcord descargará y preparará los componentes del cliente web automáticamente. Puede tardar entre 1 y 2 minutos dependiendo de tu conexión.
- **Siguientes arranques:** La caché del cliente se almacena de forma persistente en `/home/container/client`, por lo que el servidor arrancará en cuestión de segundos.
- **Estructura en el Explorador de Archivos de Pterodactyl:**
  - `/home/container/data/config.json`: Configuración generada de Meowcord.
  - `/home/container/data/jwt.key`: Clave criptográfica para tokens y sesiones.
  - `/home/container/storage/`: Todos los avatares, banners, stickers y archivos subidos.
  - `/home/container/client/`: Caché optimizada del cliente web.
