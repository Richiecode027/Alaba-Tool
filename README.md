# Alaba Tool - Gestor de Cifrados Musicales

Una aplicación web completa para gestionar, visualizar y transponer cifrados musicales (chord charts). Construida con Node.js, Express y PostgreSQL.

## Características principales

✨ **Funcionalidades:**
- ✅ CRUD completo de canciones (Crear, Leer, Actualizar, Eliminar)
- ✅ Almacenamiento de cifrados con formato marcado: `[G]Te loamos [C]oh Dios`
- ✅ Visualización de canciones con acordes resaltados en color rojo
- ✅ Transposición de acordes a cualquier tonalidad
- ✅ Soporte para notación anglosajona (C, D, E, F, G, A, B) y latina (Do, Re, Mi, Fa, Sol, La, Si)
- ✅ Reconocimiento inteligente de todos los tipos de acordes:
  - Alteraciones: # (sostenido), b (bemol)
  - Calidad: m (menor), maj/Maj (mayor con séptima mayor)
  - Séptimas: 7, maj7, m7, 7b5, m7b5
  - Suspensiones: sus2, sus4
  - Aumentados/Disminuidos: dim, dim7, aug
  - Añadidos: add9, add11, add13
  - Extendidos: 9, 11, 13, 6, 6/9
  - Combinados: m9, maj9, m11, maj11, m13
  - Slash chords: G/B, C/E, D/F#
- ✅ Búsqueda de canciones por título o autor
- ✅ Vista de impresión limpia (sin botones)
- ✅ Modo de presentación con auto-scroll:
  - Control de velocidad con slider
  - Pausa/reanudación con Espacio
  - Ocultamiento de navegación para maximizar espacio
- ✅ Interfaz responsiva con Tailwind CSS

## Stack tecnológico

- **Backend:** Node.js + Express.js
- **Base de datos:** PostgreSQL
- **Frontend:** HTML5 + CSS3 (Tailwind CDN) + JavaScript Vanilla
- **Configuración:** dotenv para variables de entorno

## Requisitos previos

- Node.js (v14 o superior)
- npm o yarn
- PostgreSQL (v12 o superior)
- Los datos de conexión a PostgreSQL:
  - Host: `localhost`
  - Puerto: `5432`
  - Usuario: `postgres`
  - Contraseña: `Master_027`

## Instalación

### 1. Clonar o descargar el proyecto

```bash
cd "Alaba Tool"
```

### 2. Instalar dependencias

```bash
npm install
```

Esto instalará:
- `express` - Framework web
- `pg` - Driver de PostgreSQL
- `dotenv` - Manejo de variables de entorno

### 3. Configurar la base de datos

El archivo `.env` ya está configurado con los valores por defecto:
```
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=Master_027
DB_NAME=alaba_tool_db
PORT=3000
NODE_ENV=development
```

Si necesitas cambiar estos valores, edita el archivo `.env` antes de continuar.

### 4. Inicializar la base de datos

```bash
npm run init-db
```

Este script:
- ✅ Crea la base de datos `alaba_tool_db` si no existe
- ✅ Crea la tabla `canciones`
- ✅ Inserta 3 canciones de ejemplo

Esperado:
```
Conectado a PostgreSQL
Base de datos alaba_tool_db ya existe (o "creada exitosamente")
Conectado a alaba_tool_db
Tabla "canciones" creada o ya existe
Insertando datos de ejemplo...
Datos de ejemplo insertados exitosamente
Inicialización completada exitosamente
```

## Uso

### Iniciar la aplicación

```bash
npm start
```

O en modo desarrollo:

```bash
npm run dev
```

La aplicación estará disponible en: **http://localhost:3000**

## Estructura de carpetas

```
Alaba Tool/
├── public/
│   ├── index.html          # Interfaz web principal
│   ├── app.js              # Lógica JavaScript del frontend
│   └── style.css           # Estilos personalizados
├── src/
│   ├── server.js           # Servidor Express principal
│   ├── database.js         # Configuración de conexión a BD
│   ├── routes.js           # Rutas API RESTful
│   ├── transposer.js       # Motor de transposición de acordes
│   └── initDatabase.js     # Script de inicialización
├── .env                    # Variables de entorno
├── package.json            # Dependencias del proyecto
└── README.md              # Este archivo
```

## API REST

### Obtener todas las canciones
```
GET /api/canciones
```

### Obtener una canción por ID
```
GET /api/canciones/:id
```

### Buscar canciones
```
GET /api/canciones/buscar/:query
```

### Crear una canción
```
POST /api/canciones
Body: {
  "titulo": "Te Loamos",
  "autor": "Jesús Adrián Romero",
  "genero": "Alabanza",
  "tono_original": "G",
  "contenido": "[G]Te loamos [C]oh Dios"
}
```

### Actualizar una canción
```
PUT /api/canciones/:id
Body: { ... mismo que POST ... }
```

### Eliminar una canción
```
DELETE /api/canciones/:id
```

### Transponer acordes
```
POST /api/transponer
Body: {
  "contenido": "[G]Te loamos [C]oh Dios",
  "tono_original": "G",
  "tono_nuevo": "A",
  "isLatin": false
}
```

### Convertir notación
```
POST /api/convertir-notacion
Body: {
  "contenido": "[G]Canción [C]bonita",
  "a_latina": true
}
```

### Extraer acordes únicos
```
POST /api/acordes-unicos
Body: {
  "contenido": "[G]Canción [C]bonita [G]de nuevo"
}
Response: {
  "acordes": ["G", "C"]
}
```

## Estructura de la base de datos

### Tabla: canciones

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | SERIAL PRIMARY KEY | Identificador único |
| titulo | VARCHAR(255) NOT NULL | Título de la canción |
| autor | VARCHAR(255) NOT NULL | Autor de la canción |
| genero | VARCHAR(100) | Género musical |
| tono_original | VARCHAR(10) NOT NULL | Tonalidad original (C, D, E, etc.) |
| contenido | TEXT NOT NULL | Letra con acordes marcados [ACORDE] |
| fecha_creacion | TIMESTAMP | Fecha de creación (auto) |
| fecha_actualizacion | TIMESTAMP | Última actualización (auto) |

## Cómo usar la aplicación

### 1. **Ver canciones**
   - Ir a la sección "Canciones"
   - Se muestra una lista con todas las canciones
   - Haz clic en una canción para verla en detalle

### 2. **Crear una nueva canción**
   - Ir a "Nueva Canción"
   - Rellenar todos los campos:
     - Título, Autor, Género (opcional)
     - Tono Original (C, D, E, etc.)
     - Letra con acordes usando formato: `[ACORDE]`
   - Hacer clic en "Crear Canción"

### 3. **Ver una canción en detalle**
   - Hacer clic en una canción de la lista
   - Se muestra con acordes resaltados en rojo
   - Se puede ver el título, autor, género y tono

### 4. **Transponer una canción**
   - En la vista de detalle:
     - Seleccionar el "Tono Actual" (debe ser el original)
     - Seleccionar el "Transposar a" (nueva tonalidad)
     - Hacer clic en "Aplicar"
   - Los acordes se trasponerán automáticamente
   - El sufijo del acorde se mantiene intacto

### 5. **Cambiar notación**
   - En la vista de detalle:
     - Seleccionar "Notación" (Inglés o Latina)
     - Hacer clic en "Aplicar"
   - Los acordes cambiarán:
     - De: C, D, E, F, G, A, B
     - A: Do, Re, Mi, Fa, Sol, La, Si

### 6. **Auto-scroll (Modo Presentación)**
   - En la vista de detalle, ir a "Modo Presentación"
   - Hacer clic en "▶ Iniciar Auto-Scroll"
   - La navegación se ocultará para maximizar espacio
   - Usar el slider para ajustar la velocidad
   - Presionar Espacio para pausar/reanudar
   - Hacer clic en "▶ Reanudar" para detener

### 7. **Buscar canciones**
   - En la lista de canciones, usar la barra de búsqueda
   - Buscar por título o autor
   - Hacer clic en "Limpiar" para ver todas

### 8. **Editar una canción**
   - Ver la canción en detalle
   - Hacer clic en "✏️ Editar"
   - Modificar los campos necesarios
   - Hacer clic en "💾 Guardar Cambios"

### 9. **Imprimir una canción**
   - Ver la canción en detalle
   - Hacer clic en "🖨️ Imprimir"
   - Se abrirá el cuadro de impresión del navegador
   - Solo se imprimirán los acordes y la letra

### 10. **Eliminar una canción**
   - En la lista: hacer clic en "Eliminar" junto a la canción
   - O en la vista de detalle: hacer clic en "🗿 Eliminar"
   - Confirmar la eliminación

## Ejemplos de canciones

### Ejemplo 1: Variedad de acordes simples
```
[Em]Oh Señor de [Bm]paz,
[G]Tu nombre es [D]gloria,
[Em]En tus manos [Bm]está
[G]Mi vida y mi [D]historia.
```

### Ejemplo 2: Acordes con sufijos complejos
```
[Cmaj7]Gracia soberana,
[F#m7]Don divinal,
[Gmaj9]Fuente de vida,
[D7sus4]Paz celestial.
```

### Ejemplo 3: Slash chords
```
[G/B]Acorde con bajo,
[C/E]En la canción,
[D/F#]Sonido hermoso,
[A/C#]De mi corazón.
```

### Ejemplo 4: Acordes extendidos
```
[Cm9]Sonido sofisticado,
[Fadd11]Con mucha clase,
[Bb6/9]Melodía bonita,
[Emaug]De verdad se abrasa.
```

## Algoritmo de transposición

El motor de transposición soporta:

1. **Escala cromática:** C, C#, D, D#, E, F, F#, G, G#, A, A#, B
2. **Notación con bemoles:** Db, Eb, Gb, Ab, Bb (convertidas internamente a #)
3. **Preservación de sufijo:** Solo se transpone la nota raíz:
   - `Cm7` en G transportado a A = `Am7`
   - `F#m9` transportado a B = `Bm9`
4. **Slash chords:** Se transponen tanto la nota raíz como el bajo:
   - `G/B` transportado a A = `A/C#`
   - `D/F#` transportado a E = `E/G#`
5. **Notación latina:** Funciona igual pero con Do, Re, Mi, etc.

## Solución de problemas

### Error: "Error: connect ECONNREFUSED"
- **Problema:** PostgreSQL no está corriendo
- **Solución:** Inicia PostgreSQL en tu sistema

### Error: "FATAL: database alaba_tool_db does not exist"
- **Problema:** La base de datos no se ha inicializado
- **Solución:** Ejecuta `npm run init-db`

### Error: "password authentication failed"
- **Problema:** Credenciales incorrectas en .env
- **Solución:** Verifica el usuario y contraseña de PostgreSQL

### Puerto 3000 ya en uso
- **Problema:** Otra aplicación usa el puerto 3000
- **Solución:** Cambia PORT en `.env` a otro puerto (ej: 3001)

### Los acordes no se transponen correctamente
- **Problema:** Formato de acorde no reconocido
- **Solución:** Usa solo acordes válidos en formato `[NOTA]` o `[NOTA#]` o `[NOTAb]`

## Notas de desarrollo

- Todos los sufijos de acordes se mantienen intactos durante la transposición
- Se soportan múltiples formatos de acordes simultáneamente
- La conversión entre notaciones es bidireccional
- Los datos se guardan automáticamente en PostgreSQL
- El frontend no requiere build step, es vanilla JavaScript

## Mejoras futuras posibles

- [ ] Agregar metrónomo integrado
- [ ] Exportar a PDF con mejor formato
- [ ] Grabar audio de referencia
- [ ] Sincronización en tiempo real para varias usuarios
- [ ] Análisis de progresiones de acordes
- [ ] Aplicación móvil nativa
- [ ] Integración con Spotify/YouTube

## Licencia

MIT

## Soporte

Para reportar problemas o sugerencias, por favor abre un issue o contacta al desarrollador.

---

¡Disfruta usando Alaba Tool! 🎵
