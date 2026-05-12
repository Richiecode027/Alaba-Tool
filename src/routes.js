const express = require('express');
const router = express.Router();
const db = require('./database');
const transposer = require('./transposer');

// Obtener todas las canciones
router.get('/canciones', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM canciones ORDER BY fecha_creacion DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener canciones:', error);
    res.status(500).json({ error: 'Error al obtener canciones' });
  }
});

// Obtener una canción por ID
router.get('/canciones/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT * FROM canciones WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Canción no encontrada' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al obtener canción:', error);
    res.status(500).json({ error: 'Error al obtener canción' });
  }
});

// Buscar canciones por título o autor
router.get('/canciones/buscar/:query', async (req, res) => {
  try {
    const { query } = req.params;
    const searchTerm = `%${query}%`;
    
    const result = await db.query(
      'SELECT * FROM canciones WHERE LOWER(titulo) LIKE LOWER($1) OR LOWER(autor) LIKE LOWER($2) ORDER BY fecha_creacion DESC',
      [searchTerm, searchTerm]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error al buscar canciones:', error);
    res.status(500).json({ error: 'Error al buscar canciones' });
  }
});

// Crear una nueva canción
router.post('/canciones', async (req, res) => {
  try {
    const { titulo, autor, genero, tono_original, contenido } = req.body;

    if (!titulo || !tono_original || !contenido || !genero) {
      return res.status(400).json({ error: 'Faltan campos requeridos: título, género, tono original y contenido' });
    }

    const result = await db.query(
      'INSERT INTO canciones (titulo, autor, genero, tono_original, contenido) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [titulo, autor || null, genero, tono_original, contenido]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error al crear canción:', error);
    res.status(500).json({ error: 'Error al crear canción' });
  }
});

// Actualizar una canción
router.put('/canciones/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { titulo, autor, genero, tono_original, contenido } = req.body;

    if (!titulo || !tono_original || !contenido || !genero) {
      return res.status(400).json({ error: 'Faltan campos requeridos: título, género, tono original y contenido' });
    }

    const result = await db.query(
      'UPDATE canciones SET titulo = $1, autor = $2, genero = $3, tono_original = $4, contenido = $5, fecha_actualizacion = CURRENT_TIMESTAMP WHERE id = $6 RETURNING *',
      [titulo, autor || null, genero, tono_original, contenido, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Canción no encontrada' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al actualizar canción:', error);
    res.status(500).json({ error: 'Error al actualizar canción' });
  }
});

// Eliminar una canción
router.delete('/canciones/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query('DELETE FROM canciones WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Canción no encontrada' });
    }

    res.json({ mensaje: 'Canción eliminada exitosamente' });
  } catch (error) {
    console.error('Error al eliminar canción:', error);
    res.status(500).json({ error: 'Error al eliminar canción' });
  }
});

// Transponer una canción a una nueva tonalidad
router.post('/transponer', async (req, res) => {
  try {
    const { contenido, tono_original, tono_nuevo, isLatin } = req.body;

    if (!contenido || !tono_original || !tono_nuevo) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos' });
    }

    const transposed = transposer.transposeSong(contenido, tono_original, tono_nuevo, isLatin || false);
    res.json({ contenido: transposed });
  } catch (error) {
    console.error('Error al transponer:', error);
    res.status(500).json({ error: 'Error al transponer canción' });
  }
});

// Convertir entre notaciones
router.post('/convertir-notacion', async (req, res) => {
  try {
    const { contenido, a_latina } = req.body;

    if (!contenido) {
      return res.status(400).json({ error: 'Contenido requerido' });
    }

    const converted = a_latina 
      ? transposer.convertToLatin(contenido)
      : transposer.convertToEnglish(contenido);

    res.json({ contenido: converted });
  } catch (error) {
    console.error('Error al convertir notación:', error);
    res.status(500).json({ error: 'Error al convertir notación' });
  }
});

// Obtener los acordes únicos de una canción
router.post('/acordes-unicos', async (req, res) => {
  try {
    const { contenido } = req.body;

    if (!contenido) {
      return res.status(400).json({ error: 'Contenido requerido' });
    }

    const chords = transposer.extractChords(contenido);
    res.json({ acordes: chords });
  } catch (error) {
    console.error('Error al extraer acordes:', error);
    res.status(500).json({ error: 'Error al extraer acordes' });
  }
});

module.exports = router;
