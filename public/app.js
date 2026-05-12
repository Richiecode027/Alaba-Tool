// Variables globales
let currentSong = null;
let allSongs = [];
let autoScrollActive = false;
let scrollPaused = false;
let scrollInterval = null;
let currentDisplayedKey = null; // Tono actualmente mostrado

// Indicador de carga
function showLoading() {
    document.getElementById('loadingIndicator').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loadingIndicator').classList.add('hidden');
}

// Constantes
const NOTES_ENGLISH = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTES_LATIN = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];

// Cargar todas las canciones al iniciar
document.addEventListener('DOMContentLoaded', () => {
    loadAllSongs();
    setupEventListeners();
});

// Configurar listeners de eventos
function setupEventListeners() {
    // Tecla Espacio para pausar/reanudar auto-scroll
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && autoScrollActive && currentSong) {
            e.preventDefault();
            togglePauseScroll();
        }
    });

    // Configurar event listener para scrollSpeed cuando se muestre
    setupScrollSpeedListener();    setupTranspositionKeyListener();}

// Configurar listener para control de velocidad
function setupScrollSpeedListener() {
    const scrollSpeedElement = document.getElementById('scrollSpeed');
    if (scrollSpeedElement) {
        scrollSpeedElement.addEventListener('change', (e) => {
            document.getElementById('speedLabel').textContent = e.target.value;
            if (autoScrollActive && !scrollPaused) {
                clearInterval(scrollInterval);
                startAutoScroll();
            }
        });
    }
}

// Configurar listener para transpositionKey (si existe)
function setupTranspositionKeyListener() {
    const transpositionKeyElement = document.getElementById('transpositionKey');
    if (transpositionKeyElement) {
        transpositionKeyElement.addEventListener('change', () => {
            if (currentSong) {
                currentDisplayedKey = transpositionKeyElement.value;
            }
        });
    }
}
    });
}

// Mostrar/ocultar secciones
function showSection(sectionId) {
    document.querySelectorAll('.section-content').forEach(section => {
        section.classList.add('hidden');
    });
    document.getElementById(sectionId).classList.remove('hidden');

    // Mostrar/ocultar controles flotantes
    const floatingControls = document.getElementById('floatingControls');
    const speedControl = document.getElementById('speedControl');

    if (sectionId === 'song-detail') {
        floatingControls.classList.remove('hidden');
        speedControl.classList.remove('hidden');
        // Asegurar que el listener de velocidad esté configurado
        setupScrollSpeedListener();
    } else {
        floatingControls.classList.add('hidden');
        speedControl.classList.add('hidden');
    }

    // Detener auto-scroll si cambiamos de sección
    if (autoScrollActive) {
        stopAutoScroll();
    }

    // Scroll al top
    window.scrollTo(0, 0);
}

// Cargar todas las canciones
async function loadAllSongs() {
    showLoading();
    try {
        const response = await fetch('/api/canciones');
        allSongs = await response.json();
        renderSongsList(allSongs);
    } catch (error) {
        console.error('Error al cargar canciones:', error);
        document.getElementById('songsList').innerHTML = '<div class="text-red-500">Error al cargar las canciones</div>';
    } finally {
        hideLoading();
    }
}

// Buscar canciones
async function handleSearch() {
    const query = document.getElementById('searchInput').value.trim();

    if (query === '') {
        renderSongsList(allSongs);
        return;
    }

    showLoading();
    try {
        const response = await fetch(`/api/canciones/buscar/${encodeURIComponent(query)}`);
        const results = await response.json();
        renderSongsList(results);
    } catch (error) {
        console.error('Error en la búsqueda:', error);
    } finally {
        hideLoading();
    }
}

// Renderizar lista de canciones
function renderSongsList(songs) {
    const container = document.getElementById('songsList');

    if (songs.length === 0) {
        container.innerHTML = '<div class="text-gray-500 text-center py-8">No se encontraron canciones</div>';
        return;
    }

    container.innerHTML = songs.map(song => `
        <div class="song-item-hover bg-white border border-gray-200 rounded-lg p-4 cursor-pointer transition" onclick="viewSong(${song.id})">
            <div class="flex justify-between items-start">
                <div class="flex-1">
                    <h3 class="text-xl font-bold text-gray-800">${escapeHtml(song.titulo)}</h3>
                    ${song.autor ? `<p class="text-gray-600">Por ${escapeHtml(song.autor)}</p>` : ''}
                    <div class="flex gap-4 mt-2 text-sm">
                        ${song.genero ? `<span class="bg-blue-100 text-blue-800 px-2 py-1 rounded">${escapeHtml(song.genero)}</span>` : ''}
                        <span class="bg-red-100 text-red-800 px-2 py-1 rounded">Tono: ${song.tono_original}</span>
                    </div>
                </div>
                <button onclick="event.stopPropagation(); deleteSong(${song.id})" class="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm">
                    Eliminar
                </button>
            </div>
        </div>
    `).join('');
}

// Ver una canción
async function viewSong(id) {
    showLoading();
    try {
        const response = await fetch(`/api/canciones/${id}`);
        currentSong = await response.json();

        // Establecer el tono actual
        currentDisplayedKey = currentSong.tono_original;
        document.getElementById('transpositionKey').value = currentSong.tono_original;
        document.getElementById('targetKey').value = currentSong.tono_original;

        // Mostrar la canción
        displaySongDetail();
        showSection('song-detail');
    } catch (error) {
        console.error('Error al cargar canción:', error);
        alert('Error al cargar la canción');
    } finally {
        hideLoading();
    }
}

// Mostrar detalle de la canción
function displaySongDetail() {
    if (!currentSong) return;

    document.getElementById('detailTitle').textContent = currentSong.titulo;
    document.getElementById('detailAuthor').textContent = currentSong.autor ? `Por ${currentSong.autor} • Género: ${currentSong.genero} • Tono: ${currentSong.tono_original}` : `Género: ${currentSong.genero} • Tono: ${currentSong.tono_original}`;

    // Renderizar contenido con acordes resaltados
    const formattedContent = formatSongContent(currentSong.contenido);
    document.getElementById('songContent').innerHTML = formattedContent;
}

// Formatear contenido de la canción con acordes coloreados
function formatSongContent(content) {
    return content
        .replace(/\[([^\]]+)\]/g, '<span class="chord">[$1]</span>')
        .replace(/\n/g, '<br>');
}

// Transponer canción
async function applyTransposition() {
    if (!currentSong) return;

    const fromKey = document.getElementById('transpositionKey').value;
    const toKey = document.getElementById('targetKey').value;

    if (fromKey === toKey) {
        return; // No hay cambio
    }

    showLoading();
    try {
        const response = await fetch('/api/transponer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contenido: currentSong.contenido,
                tono_original: fromKey,
                tono_nuevo: toKey,
                isLatin: false
            })
        });

        if (response.ok) {
            const data = await response.json();

            currentSong.contenido = data.contenido;
            currentSong.tono_original = toKey;
            document.getElementById('transpositionKey').value = toKey;
            document.getElementById('targetKey').value = toKey;
            displaySongDetail();
        } else {
            const errorText = await response.text();
            console.error('Error HTTP:', response.status, response.statusText);
            console.error('Respuesta del servidor:', errorText);
            alert(`Error al transponer (${response.status}): ${errorText}`);
        }
    } catch (error) {
        console.error('Error de red:', error);
        alert(`Error de conexión: ${error.message}`);
    } finally {
        hideLoading();
    }
}

// Transponer un tono arriba
async function transposeUp() {
    if (!currentSong || !currentDisplayedKey) return;

    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const currentIndex = notes.indexOf(currentDisplayedKey);
    const newIndex = (currentIndex + 1) % 12;
    const newKey = notes[newIndex];

    await transposeToKey(newKey);
}

// Transponer un tono abajo
async function transposeDown() {
    if (!currentSong || !currentDisplayedKey) return;

    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const currentIndex = notes.indexOf(currentDisplayedKey);
    const newIndex = (currentIndex - 1 + 12) % 12;
    const newKey = notes[newIndex];

    await transposeToKey(newKey);
}

// Función auxiliar para transponer a una tonalidad específica
async function transposeToKey(newKey) {
    if (!currentSong || !currentDisplayedKey) return;

    if (currentDisplayedKey === newKey) {
        return; // No hay cambio
    }

    showLoading();
    try {
        const response = await fetch('/api/transponer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contenido: currentSong.contenido,
                tono_original: currentDisplayedKey,
                tono_nuevo: newKey,
                isLatin: false
            })
        });

        if (response.ok) {
            const data = await response.json();

            currentSong.contenido = data.contenido;
            currentDisplayedKey = newKey;
            document.getElementById('transpositionKey').value = newKey;
            document.getElementById('targetKey').value = newKey;
            displaySongDetail();
        } else {
            const errorText = await response.text();
            console.error('Error HTTP:', response.status, response.statusText);
            console.error('Respuesta del servidor:', errorText);
            alert(`Error al transponer (${response.status}): ${errorText}`);
        }
    } catch (error) {
        console.error('Error de red:', error);
        alert(`Error de conexión: ${error.message}`);
    } finally {
        hideLoading();
    }
}
}

// Auto-scroll
function toggleAutoScroll() {
    if (!currentSong) {
        alert('Por favor, selecciona una canción primero');
        return;
    }

    if (autoScrollActive) {
        stopAutoScroll();
    } else {
        startAutoScroll();
    }
}

function startAutoScroll() {
    autoScrollActive = true;
    scrollPaused = false;

    document.getElementById('autoScrollBtn').classList.add('hidden');
    document.getElementById('pauseScrollBtn').classList.remove('hidden');
    document.getElementById('mainNav').classList.add('hidden');

    const scrollContent = document.getElementById('songContent');
    const speed = parseInt(document.getElementById('scrollSpeed').value);
    const delay = 100 - (speed * 9); // Convertir velocidad a delay

    scrollInterval = setInterval(() => {
        if (!scrollPaused) {
            scrollContent.scrollBy(0, 2);
        }
    }, delay);
}

function stopAutoScroll() {
    autoScrollActive = false;
    scrollPaused = false;
    clearInterval(scrollInterval);

    document.getElementById('autoScrollBtn').classList.remove('hidden');
    document.getElementById('pauseScrollBtn').classList.add('hidden');
    document.getElementById('mainNav').classList.remove('hidden');
}

function togglePauseScroll() {
    scrollPaused = !scrollPaused;
    const btn = document.getElementById('pauseScrollBtn');
    btn.textContent = scrollPaused ? '▶ Reanudar' : '⏸ Pausar';
}

// Crear canción
async function handleCreateSong(event) {
    event.preventDefault();

    const song = {
        titulo: document.getElementById('titulo').value,
        autor: document.getElementById('autor').value || null,
        genero: document.getElementById('genero').value,
        tono_original: document.getElementById('tonoOriginal').value,
        contenido: document.getElementById('contenido').value
    };

    showLoading();
    try {
        const response = await fetch('/api/canciones', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(song)
        });

        if (response.ok) {
            alert('Canción creada exitosamente');
            document.getElementById('newSongForm').reset();
            loadAllSongs();
            showSection('songs-list');
        } else {
            // Mostrar información detallada del error
            const errorText = await response.text();
            console.error('Error HTTP:', response.status, response.statusText);
            console.error('Respuesta del servidor:', errorText);
            alert(`Error al crear la canción (${response.status}): ${errorText}`);
        }
    } catch (error) {
        console.error('Error de red:', error);
        alert(`Error de conexión: ${error.message}`);
    } finally {
        hideLoading();
    }
}

// Editar canción
async function editCurrentSong() {
    if (!currentSong) return;

    document.getElementById('editSongId').value = currentSong.id;
    document.getElementById('editTitulo').value = currentSong.titulo;
    document.getElementById('editAutor').value = currentSong.autor || '';
    document.getElementById('editGenero').value = currentSong.genero;
    document.getElementById('editTonoOriginal').value = currentSong.tono_original;
    document.getElementById('editContenido').value = currentSong.contenido;

    showSection('edit-song');
}

// Actualizar canción
async function handleUpdateSong(event) {
    event.preventDefault();

    const id = document.getElementById('editSongId').value;
    const song = {
        titulo: document.getElementById('editTitulo').value,
        autor: document.getElementById('editAutor').value || null,
        genero: document.getElementById('editGenero').value,
        tono_original: document.getElementById('editTonoOriginal').value,
        contenido: document.getElementById('editContenido').value
    };

    showLoading();
    try {
        const response = await fetch(`/api/canciones/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(song)
        });

        if (response.ok) {
            currentSong = await response.json();
            alert('Canción actualizada exitosamente');
            displaySongDetail();
            showSection('song-detail');
            loadAllSongs();
        } else {
            const errorText = await response.text();
            console.error('Error HTTP:', response.status, response.statusText);
            console.error('Respuesta del servidor:', errorText);
            alert(`Error al actualizar la canción (${response.status}): ${errorText}`);
        }
    } catch (error) {
        console.error('Error de red:', error);
        alert(`Error de conexión: ${error.message}`);
    } finally {
        hideLoading();
    }
}
}

// Eliminar canción
async function deleteSong(id) {
    if (!confirm('¿Estás seguro de que deseas eliminar esta canción?')) {
        return;
    }

    showLoading();
    try {
        const response = await fetch(`/api/canciones/${id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            alert('Canción eliminada exitosamente');
            loadAllSongs();
        } else {
            const errorText = await response.text();
            console.error('Error HTTP:', response.status, response.statusText);
            console.error('Respuesta del servidor:', errorText);
            alert(`Error al eliminar la canción (${response.status}): ${errorText}`);
        }
    } catch (error) {
        console.error('Error de red:', error);
        alert(`Error de conexión: ${error.message}`);
    } finally {
        hideLoading();
    }
}

// Eliminar canción actual
async function deleteCurrentSong() {
    if (!currentSong) return;

    if (!confirm(`¿Estás seguro de que deseas eliminar "${currentSong.titulo}"?`)) {
        return;
    }

    showLoading();
    try {
        const response = await fetch(`/api/canciones/${currentSong.id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            alert('Canción eliminada exitosamente');
            currentSong = null;
            loadAllSongs();
            showSection('songs-list');
        } else {
            const errorText = await response.text();
            console.error('Error HTTP:', response.status, response.statusText);
            console.error('Respuesta del servidor:', errorText);
            alert(`Error al eliminar la canción (${response.status}): ${errorText}`);
        }
    } catch (error) {
        console.error('Error de red:', error);
        alert(`Error de conexión: ${error.message}`);
    } finally {
        hideLoading();
    }
}

// Imprimir canción
function printSong() {
    if (!currentSong) return;

    const printWindow = window.open('', '', 'height=600,width=800');
    const content = document.getElementById('songDetailContainer').innerHTML;

    printWindow.document.write(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>${currentSong.titulo}</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 2cm; }
                .print-hidden { display: none !important; }
                h1 { margin: 0 0 0.5em 0; }
                p { margin: 0 0 2em 0; color: #666; }
                .chord-display { white-space: pre-wrap; line-height: 1.8; }
                .chord { color: #000; font-weight: bold; }
            </style>
        </head>
        <body>
            <h1>${currentSong.titulo}</h1>
            <p>Por ${currentSong.autor} • ${currentSong.genero || ''} • Tono: ${currentSong.tono_original}</p>
            <div class="chord-display">${formatSongContent(currentSong.contenido)}</div>
        </body>
        </html>
    `);

    printWindow.document.close();
    setTimeout(() => {
        printWindow.print();
    }, 250);
}

// Función auxiliar: escapar HTML
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
