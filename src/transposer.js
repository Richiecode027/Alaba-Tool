/**
 * Módulo de transposición de acordes musicales
 * Soporta notación anglosajona (C, C#, D, etc.) y latina (Do, Re, Mi, etc.)
 */

// Notas en notación anglosajona
const NOTES_ENGLISH = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Notas en notación latina
const NOTES_LATIN = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];

// Mapa para convertir bemoles a sostenidos
const FLAT_TO_SHARP = {
  'Db': 'C#',
  'Eb': 'D#',
  'Gb': 'F#',
  'Ab': 'G#',
  'Bb': 'A#'
};

const FLAT_TO_SHARP_LATIN = {
  'Dob': 'Do#',
  'Reb': 'Do#',
  'Mib': 'Re#',
  'Fab': 'Mi',
  'Solb': 'Fa#',
  'Lab': 'Sol#',
  'Sib': 'La#'
};

/**
 * Normaliza una nota a su forma de sostenido
 */
function normalizeNote(note) {
  if (FLAT_TO_SHARP[note]) {
    return FLAT_TO_SHARP[note];
  }
  return note;
}

/**
 * Normaliza una nota latina
 */
function normalizeNoteLatin(note) {
  if (FLAT_TO_SHARP_LATIN[note]) {
    return FLAT_TO_SHARP_LATIN[note];
  }
  return note;
}

/**
 * Obtiene el índice de una nota en la escala
 */
function getNoteIndex(note, isLatin = false) {
  const notes = isLatin ? NOTES_LATIN : NOTES_ENGLISH;
  return notes.indexOf(note);
}

/**
 * Obtiene la nota en una posición específica
 */
function getNote(index, isLatin = false) {
  const notes = isLatin ? NOTES_LATIN : NOTES_ENGLISH;
  return notes[index % 12];
}

/**
 * Extrae la nota raíz y el sufijo de un acorde
 * Ej: "Cm7" -> { root: "C", suffix: "m7" }
 * Ej: "G/B" -> { root: "G", suffix: "", bassNote: "B" }
 */
function parseChord(chord) {
  // Patrón para acordes con bajo (slash chords)
  const slashMatch = chord.match(/^([A-G][#b]?)(.*?)\/(.*?)$/);
  if (slashMatch) {
    return {
      root: slashMatch[1],
      suffix: slashMatch[2],
      bassNote: slashMatch[3]
    };
  }

  // Patrón para acordes normales
  const match = chord.match(/^([A-G][#b]?)(.*)$/);
  if (match) {
    return {
      root: match[1],
      suffix: match[2],
      bassNote: null
    };
  }

  return null;
}

/**
 * Extrae la nota raíz y el sufijo de un acorde en notación latina
 */
function parseChordLatin(chord) {
  // Patrón para acordes con bajo
  const slashMatch = chord.match(/^(Do#?|Reb|Re#?|Mib|Mi|Fab|Fa#?|Solb|Sol#?|Lab|La#?|Sib|Si)(.*?)\/(.*?)$/);
  if (slashMatch) {
    return {
      root: slashMatch[1],
      suffix: slashMatch[2],
      bassNote: slashMatch[3]
    };
  }

  // Patrón para acordes normales
  const match = chord.match(/^(Do#?|Reb|Re#?|Mib|Mi|Fab|Fa#?|Solb|Sol#?|Lab|La#?|Sib|Si)(.*)$/);
  if (match) {
    return {
      root: match[1],
      suffix: match[2],
      bassNote: null
    };
  }

  return null;
}

/**
 * Convierte una nota de notación anglosajona a latina
 */
function convertNoteToLatin(note) {
  const index = NOTES_ENGLISH.indexOf(note);
  if (index === -1) return note;
  return NOTES_LATIN[index];
}

/**
 * Convierte una nota de notación latina a anglosajona
 */
function convertNoteToEnglish(note) {
  const index = NOTES_LATIN.indexOf(note);
  if (index === -1) return note;
  return NOTES_ENGLISH[index];
}

/**
 * Transpone un acorde a una nueva tonalidad
 * @param {string} chord - Acorde a transportar (ej: "Cm7")
 * @param {number} semitones - Número de semitonos a transportar (puede ser negativo)
 * @param {boolean} isLatin - Si es true, asume entrada en notación latina
 * @returns {string} - Acorde transportado
 */
function transposeChord(chord, semitones, isLatin = false) {
  const parsed = isLatin ? parseChordLatin(chord) : parseChord(chord);
  
  if (!parsed) {
    return chord;
  }

  // Normalizar la nota raíz
  const normalizedRoot = isLatin ? 
    normalizeNoteLatin(parsed.root) : 
    normalizeNote(parsed.root);

  // Obtener el índice y transportar
  const currentIndex = getNoteIndex(normalizedRoot, isLatin);
  if (currentIndex === -1) {
    return chord;
  }

  const newIndex = (currentIndex + semitones + 120) % 12;
  const newRoot = getNote(newIndex, isLatin);

  // Transportar la nota del bajo si existe
  let transposedBass = '';
  if (parsed.bassNote) {
    const normalizedBass = isLatin ?
      normalizeNoteLatin(parsed.bassNote) :
      normalizeNote(parsed.bassNote);
    
    const bassIndex = getNoteIndex(normalizedBass, isLatin);
    if (bassIndex !== -1) {
      const newBassIndex = (bassIndex + semitones + 120) % 12;
      const newBass = getNote(newBassIndex, isLatin);
      transposedBass = `/${newBass}`;
    }
  }

  // Reconstruir el acorde preservando el sufijo
  return newRoot + parsed.suffix + transposedBass;
}

/**
 * Transpone una nota desde un tono a otro
 * @param {string} fromNote - Nota original
 * @param {string} toNote - Nota destino
 * @param {boolean} isLatin - Si es true, usa notación latina
 * @returns {number} - Número de semitonos a transportar
 */
function getSemitonesBetween(fromNote, toNote, isLatin = false) {
  const from = isLatin ? normalizeNoteLatin(fromNote) : normalizeNote(fromNote);
  const to = isLatin ? normalizeNoteLatin(toNote) : normalizeNote(toNote);

  const fromIndex = getNoteIndex(from, isLatin);
  const toIndex = getNoteIndex(to, isLatin);

  if (fromIndex === -1 || toIndex === -1) {
    return 0;
  }

  const semitones = toIndex - fromIndex;
  return semitones;
}

/**
 * Transpone una canción completa con acordes marcados
 * Formato: [G]Te loamos [C]oh Dios
 * @param {string} content - Contenido con acordes marcados entre corchetes
 * @param {string} fromNote - Tonalidad original
 * @param {string} toNote - Tonalidad destino
 * @param {boolean} isLatin - Si es true, usa notación latina
 * @returns {string} - Contenido transportado
 */
function transposeSong(content, fromNote, toNote, isLatin = false) {
  const semitones = getSemitonesBetween(fromNote, toNote, isLatin);
  
  // Reemplazar todos los acordes entre corchetes
  return content.replace(/\[([^\]]+)\]/g, (match, chord) => {
    const transposed = transposeChord(chord, semitones, isLatin);
    return `[${transposed}]`;
  });
}

/**
 * Convierte el contenido de notación anglosajona a latina
 */
function convertToLatin(content) {
  return content.replace(/\[([^\]]+)\]/g, (match, chord) => {
    const parsed = parseChord(chord);
    if (!parsed) return match;

    const newRoot = convertNoteToLatin(parsed.root);
    let newBass = '';
    if (parsed.bassNote) {
      newBass = `/${convertNoteToLatin(parsed.bassNote)}`;
    }

    return `[${newRoot}${parsed.suffix}${newBass}]`;
  });
}

/**
 * Convierte el contenido de notación latina a anglosajona
 */
function convertToEnglish(content) {
  return content.replace(/\[([^\]]+)\]/g, (match, chord) => {
    const parsed = parseChordLatin(chord);
    if (!parsed) return match;

    const newRoot = convertNoteToEnglish(parsed.root);
    let newBass = '';
    if (parsed.bassNote) {
      newBass = `/${convertNoteToEnglish(parsed.bassNote)}`;
    }

    return `[${newRoot}${parsed.suffix}${newBass}]`;
  });
}

/**
 * Extrae todos los acordes únicos de un contenido
 */
function extractChords(content) {
  const chords = new Set();
  const regex = /\[([^\]]+)\]/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    chords.add(match[1]);
  }

  return Array.from(chords);
}

module.exports = {
  transposeChord,
  transposeSong,
  getSemitonesBetween,
  convertToLatin,
  convertToEnglish,
  extractChords,
  NOTES_ENGLISH,
  NOTES_LATIN,
  parseChord,
  parseChordLatin
};
