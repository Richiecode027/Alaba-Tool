const { Client } = require('pg');
require('dotenv').config();

// Helper: construye config de conexión preferiendo DATABASE_URL.
function buildConfig(databaseOverride) {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('.railway.internal')
        ? false
        : { rejectUnauthorized: false }
    };
  }
  return {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: databaseOverride
  };
}

async function initDatabase() {
  try {
    let dbClient;

    if (process.env.DATABASE_URL) {
      // Producción (Railway): la base ya existe, solo creamos la tabla.
      console.log('Usando DATABASE_URL (entorno de producción)');
      dbClient = new Client(buildConfig());
      await dbClient.connect();
      console.log('Conectado a Postgres');
    } else {
      // Local: nos conectamos primero a la BD por defecto para crear la nuestra.
      const client = new Client(buildConfig('postgres'));
      await client.connect();
      console.log('Conectado a PostgreSQL');

      const dbName = process.env.DB_NAME;
      const checkDbQuery = `SELECT 1 FROM pg_database WHERE datname = '${dbName}'`;
      const result = await client.query(checkDbQuery);

      if (result.rows.length === 0) {
        console.log(`Creando base de datos ${dbName}...`);
        await client.query(`CREATE DATABASE ${dbName}`);
        console.log(`Base de datos ${dbName} creada exitosamente`);
      } else {
        console.log(`Base de datos ${dbName} ya existe`);
      }

      await client.end();

      dbClient = new Client(buildConfig(dbName));
      await dbClient.connect();
      console.log(`Conectado a ${dbName}`);
    }

    // Crear tabla de canciones
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS canciones (
        id SERIAL PRIMARY KEY,
        titulo VARCHAR(255) NOT NULL,
        autor VARCHAR(255),
        genero VARCHAR(100),
        tono_original VARCHAR(10) NOT NULL,
        contenido TEXT NOT NULL,
        fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await dbClient.query(createTableQuery);
    console.log('Tabla "canciones" creada o ya existe');

    // Migración: si la tabla ya existía con autor NOT NULL, lo aflojamos.
    // (Idempotente: si ya está nullable, este ALTER no hace nada.)
    await dbClient.query('ALTER TABLE canciones ALTER COLUMN autor DROP NOT NULL');
    console.log('Columna "autor" ahora permite NULL');

    // Verificar si hay datos
    const countQuery = await dbClient.query('SELECT COUNT(*) FROM canciones');
    const count = countQuery.rows[0].count;

    if (count === 0) {
      console.log('Insertando datos de ejemplo...');
      
      const sampleSongs = [
        {
          titulo: 'Te Loamos',
          autor: 'Jesús Adrián Romero',
          genero: 'Alabanza',
          tono_original: 'G',
          contenido: '[G]Te loamos oh [D]Dios,\n[Em]Por tu amor sin [A]fin,\n[D]Te adoramos, [G]Dios,\n[C]Nuestro Rey, [A]Señor.\n\n[G]Tus manos formaron [D]el mundo,\n[Em]Tu amor nos [A]sustenta,\n[D]En ti encontramos [G]paz,\n[C]Nuestro todo [A]eres tú.'
        },
        {
          titulo: 'Gracia Soberana',
          autor: 'Himno Clásico',
          genero: 'Himno',
          tono_original: 'C',
          contenido: '[C]Gracia soberana, [F]don divinal,\n[C]Fuente de vida, [G]paz celestial,\n[Am]Mi alma rendida a [D]tu potestad,\n[G]En ti confío por [C]la eternidad.\n\n[C]Cada mañana tu [F]gracia está aquí,\n[C]Día a día tú [G]cuidas de mí,\n[Am]Cuando mis fuerzas [D]llegan a fallar,\n[G]En tu poder puedo [C]descansar.'
        },
        {
          titulo: 'Oh Señor de Paz',
          autor: 'Autor Desconocido',
          genero: 'Contemplativo',
          tono_original: 'Em',
          contenido: '[Em]Oh Señor de [Bm]paz,\n[G]Tu nombre es [D]gloria,\n[Em]En tus manos [Bm]está\n[G]Mi vida y mi [D]historia.\n\n[Em]Cuando tiembla mi [Bm]corazón,\n[G]Tú eres mi [D]fortaleza,\n[Em]En la tormenta [Bm]vencedor,\n[G]Tu amor me [D]embelesa.'
        }
      ];

      for (const song of sampleSongs) {
        const insertQuery = `
          INSERT INTO canciones (titulo, autor, genero, tono_original, contenido)
          VALUES ($1, $2, $3, $4, $5)
        `;
        await dbClient.query(insertQuery, [
          song.titulo,
          song.autor,
          song.genero,
          song.tono_original,
          song.contenido
        ]);
      }
      console.log('Datos de ejemplo insertados exitosamente');
    } else {
      console.log(`La tabla ya contiene ${count} canción(es)`);
    }

    await dbClient.end();
    console.log('Inicialización completada exitosamente');

  } catch (error) {
    console.error('Error durante la inicialización:', error);
    process.exit(1);
  }
}

initDatabase();
