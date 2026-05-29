# Configuracion de Firebase

## 1. Crear proyecto

1. Entra a Firebase Console.
2. Crea un proyecto.
3. Agrega una app web.
4. Copia los valores de configuracion.

## 2. Variables de entorno

Para desarrollo local, crea un archivo `.env` en la raiz del proyecto usando `.env.example` como base:

```env
VITE_FIREBASE_API_KEY=tu_api_key
VITE_FIREBASE_AUTH_DOMAIN=tu_proyecto.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=tu_project_id
VITE_FIREBASE_STORAGE_BUCKET=tu_proyecto.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=tu_messaging_sender_id
VITE_FIREBASE_APP_ID=tu_app_id
```

Despues reinicia Vite:

```bash
npm.cmd run dev
```

No subas el archivo `.env` a GitHub. Ya esta ignorado por `.gitignore`.

## 3. Variables en Vercel

Cuando subas el proyecto a GitHub y lo conectes con Vercel, no necesitas subir `.env`.

En Vercel:

1. Abre tu proyecto.
2. Ve a Settings > Environment Variables.
3. Agrega las mismas variables de `.env.example`:

```env
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

4. Coloca el valor correspondiente a cada una.
5. Marca los ambientes donde quieres usarlas: Production, Preview y Development.
6. Guarda los cambios.
7. Haz Redeploy del proyecto.

Vite solo expone al navegador las variables que empiezan con `VITE_`. Por eso todas las variables de Firebase tienen ese prefijo.

## 4. Activar login

En Firebase Console:

1. Authentication
2. Sign-in method
3. Activa Email/Password

## 5. Crear el primer Dueño

Como no hay registro publico, crea el primer usuario manualmente:

1. Authentication > Users > Add user
2. Copia el UID del usuario creado
3. Firestore Database > users > crea un documento con ese UID
4. Agrega estos campos:

```js
name: "Nombre del Dueño"
email: "correo@tienda.com"
role: "Dueño"
active: true
```

Luego ese Dueño podra entrar a la app y crear cuentas para Socio, Encargados y Trabajador.

## 6. Reglas de Firestore

Copia el contenido de `firestore.rules` en:

Firestore Database > Rules

Estas reglas permiten que solo el Dueño administre usuarios y que las ventas/inventario guarden quien hizo cada accion.

## Nota importante

En una app sin backend, Firebase Auth no puede impedir al 100% que alguien intente crear un usuario si conoce la configuracion publica del proyecto. La seguridad real se aplica en Firestore: una cuenta sin documento en `users` y sin rango no podra usar el sistema ni leer/escribir datos.

La configuracion web de Firebase no se trata como una clave privada. Aun asi, debes proteger Firestore con reglas, activar solo los metodos de login que uses y configurar los dominios autorizados en Firebase Authentication.
