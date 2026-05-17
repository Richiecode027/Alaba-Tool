// Variables globales
let currentSong = null;
let allSongs = [];
let setlist = [];
let draggedSetlistIndex = null;
let autoScrollActive = false;
let scrollPaused = false;
let scrollInterval = null;
let speedIndex = 1; // 0 -> x1, 1 -> x2, 2 -> x3 (default x2)
const STORAGE_KEY_SETLIST = 'alabaToolSetlist';
// Velocidades de auto-scroll (más lentas: delays mayores = desplazamiento más lento)
const SPEED_DELAYS = [600, 300, 150]; // Delays en ms para cada velocidad
// Estado para distinguir toque corto (abrir) vs arrastre/long-press
let setlistIsDragging = false;
let setlistLongPressTimer = null;
// Animación: id de la canción que se acaba de mover
let lastMovedSongId = null;

// Indicador de carga
function showLoading() {
    document.getElementById('loadingIndicator').classList.remove('hidden');
}

// Toggle programático del menú hamburguesa
function toggleHamburger(forceOpen) {
    const hamburgerMenu = document.getElementById('hamburgerMenu');
    if (!hamburgerMenu) return;
    if (typeof forceOpen === 'boolean') {
        hamburgerMenu.classList.toggle('hidden', !forceOpen);
    } else {
        hamburgerMenu.classList.toggle('hidden');
    }
}

function hideLoading() {
    document.getElementById('loadingIndicator').classList.add('hidden');
}

// Constantes
const NOTES_ENGLISH = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTES_LATIN = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];

// Cargar todas las canciones al iniciar
document.addEventListener('DOMContentLoaded', () => {
    loadSetlistFromStorage();
    loadAllSongs();
    setupEventListeners();
    renderSetlist();
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

    // Botón de velocidad (x1/x2/x3) - inicializar y configurar listener
    const speedBtn = document.getElementById('speedToggleBtn');
    if (speedBtn) {
        speedBtn.textContent = ['x1', 'x2', 'x3'][speedIndex];
        speedBtn.addEventListener('click', () => {
            cycleSpeed();
        });
    }

    // Botón hamburguesa: abrir/cerrar menú
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const hamburgerMenu = document.getElementById('hamburgerMenu');
    if (hamburgerBtn && hamburgerMenu) {
        hamburgerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            hamburgerMenu.classList.toggle('hidden');
        });

        // Cerrar menú al clic fuera
        document.addEventListener('click', (e) => {
            if (!hamburgerMenu.classList.contains('hidden')) {
                const target = e.target;
                if (!hamburgerMenu.contains(target) && target !== hamburgerBtn) {
                    hamburgerMenu.classList.add('hidden');
                }
            }
        });
    }

    // Asegurar que la página tenga un estado base para controlar el botón atrás
    try {
        history.replaceState({page: 'home'}, '', location.href);
    } catch (err) {
        // ignore
    }

    // Interceptar popstate (botón atrás) para navegar a inicio en lugar de salir de la app
    window.addEventListener('popstate', (e) => {
        const state = e.state;
        const songDetailVisible = document.getElementById('song-detail') && !document.getElementById('song-detail').classList.contains('hidden');
        if (songDetailVisible) {
            showSection('songs-list');
            // dejar un estado home en el historial para evitar salir con otro back
            try { history.replaceState({page: 'home'}, '', location.href); } catch (err) {}
        }
    });

    setupSetlistDragAndDrop();
}

// Mostrar/ocultar secciones
function showSection(sectionId) {
    document.querySelectorAll('.section-content').forEach(section => {
        section.classList.add('hidden');
    });

    const section = document.getElementById(sectionId);
    if (section) {
        section.classList.remove('hidden');
    }

    const mainNav = document.getElementById('mainNav');
    const hamburgerContainer = document.getElementById('hamburgerContainer');

    if (mainNav) mainNav.classList.toggle('hidden', sectionId === 'song-detail');
    if (hamburgerContainer) hamburgerContainer.classList.toggle('hidden', sectionId !== 'song-detail');

    const detailBackBtn = document.getElementById('detailBackBtn');
    if (detailBackBtn) detailBackBtn.classList.toggle('hidden', sectionId !== 'song-detail');

    // Maximizar espacio de letras en vista de canción
    const songDetailContainer = document.getElementById('songDetailContainer');
    const songDetailControls = document.getElementById('songDetailControls');
    const songContent = document.getElementById('songContent');
    if (sectionId === 'song-detail') {
        if (songDetailContainer) songDetailContainer.classList.add('fullscreen-song');
        if (songDetailControls) songDetailControls.classList.add('hidden');
        if (songContent) songContent.classList.add('fullscreen');
    } else {
        if (songDetailContainer) songDetailContainer.classList.remove('fullscreen-song');
        if (songDetailControls) songDetailControls.classList.remove('hidden');
        if (songContent) songContent.classList.remove('fullscreen');
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
    const genre = (document.getElementById('genreFilter') && document.getElementById('genreFilter').value) || '';

    // Si no hay query ni género, mostrar todo
    if (query === '' && genre === '') {
        renderSongsList(allSongs);
        return;
    }

    // Si hay texto pero menos de 3 caracteres y no hay filtro por género, no buscar aún
    if (query.length > 0 && query.length < 3 && genre === '') {
        renderSongsList(allSongs);
        return;
    }

    showLoading();
    try {
        let results = [];

        if (query.length >= 3) {
            const response = await fetch(`/api/canciones/buscar/${encodeURIComponent(query)}`);
            results = await response.json();
        } else {
            // No hay query (vacío) pero sí filtro de género -> usar todas las canciones locales
            results = allSongs.slice();
        }

        if (genre) {
            results = results.filter(s => s.genero === genre);
        }

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

    container.innerHTML = songs.map(song => {
        const alreadyAdded = setlist.some(item => item.id === song.id);
        return `
        <div class="song-item-hover bg-white border border-gray-200 rounded-lg p-4 cursor-pointer transition" onclick="viewSong(${song.id})">
            <div class="flex justify-between items-start gap-3">
                <div class="flex-1">
                    <h3 class="text-xl font-bold text-gray-800">${escapeHtml(song.titulo)}</h3>
                    ${song.autor ? `<p class="text-gray-600">Por ${escapeHtml(song.autor)}</p>` : ''}
                    <div class="flex gap-4 mt-2 text-sm flex-wrap">
                        ${song.genero ? `<span class="bg-blue-100 text-blue-800 px-2 py-1 rounded">${escapeHtml(song.genero)}</span>` : ''}
                        <span class="bg-red-100 text-red-800 px-2 py-1 rounded">Tono: ${song.tono_original}</span>
                    </div>
                </div>
                <div class="flex flex-col gap-2 items-end">
                    <button onclick="event.stopPropagation(); addSongToSetlist(${song.id})" class="px-3 py-1 ${alreadyAdded ? 'bg-gray-300 text-gray-700 cursor-not-allowed' : 'bg-green-500 text-white hover:bg-green-600'} rounded text-sm" ${alreadyAdded ? 'disabled' : ''}>
                        ${alreadyAdded ? 'Añadido' : 'Agregar'}
                    </button>
                    <button onclick="event.stopPropagation(); deleteSong(${song.id})" class="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm">
                        Eliminar
                    </button>
                </div>
            </div>
        </div>
    `;
    }).join('');
}

function loadSetlistFromStorage() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY_SETLIST);
        if (saved) {
            setlist = JSON.parse(saved);
        }
    } catch (error) {
        console.error('Error cargando el setlist desde localStorage:', error);
        setlist = [];
    }
}

function saveSetlist() {
    localStorage.setItem(STORAGE_KEY_SETLIST, JSON.stringify(setlist));
}

function renderSetlist() {
    const container = document.getElementById('setlistItems');
    if (!container) return;

    if (setlist.length === 0) {
        container.innerHTML = '<div class="text-gray-500">Tu set list está vacío. Agrega canciones desde la lista de canciones.</div>';
        return;
    }

    container.innerHTML = setlist.map((song, index) => `
        <div class="setlist-item ${song.id === lastMovedSongId ? 'just-moved' : ''}" draggable="true" data-index="${index}" data-id="${song.id}">
            <div class="flex justify-between items-start gap-4">
                <div class="flex-1">
                    <h3 class="text-lg font-semibold text-gray-800">${escapeHtml(song.titulo)}</h3>
                    <p class="text-sm text-gray-600">${song.autor ? `Por ${escapeHtml(song.autor)}` : 'Autor desconocido'}</p>
                    <div class="flex gap-2 mt-2 text-xs text-gray-500 flex-wrap">
                        ${song.genero ? `<span class="px-2 py-1 bg-blue-100 rounded">${escapeHtml(song.genero)}</span>` : ''}
                        <span class="px-2 py-1 bg-red-100 rounded">Tono: ${song.tono_original}</span>
                    </div>
                </div>
                <div class="flex flex-col gap-2 items-end">
                    <button onclick="viewSong(${song.id})" class="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm">Ver</button>
                    <button onclick="removeSongFromSetlist(${index})" class="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm">Eliminar</button>
                </div>
            </div>
        </div>
    `).join('');
}

function addSongToSetlist(id) {
    const existing = setlist.some(item => item.id === id);
    if (existing) {
        return;
    }

    const song = allSongs.find(s => s.id === id) || (currentSong && currentSong.id === id ? currentSong : null);
    if (!song) {
        alert('No se pudo agregar la canción al set list. Intenta nuevamente.');
        return;
    }

    setlist.push(song);
    saveSetlist();
    renderSetlist();
    renderSongsList(allSongs);
}

function removeSongFromSetlist(index) {
    setlist.splice(index, 1);
    saveSetlist();
    renderSetlist();
    renderSongsList(allSongs);
}

function clearSetlist() {
    if (!confirm('¿Deseas vaciar todo el set list?')) {
        return;
    }
    setlist = [];
    saveSetlist();
    renderSetlist();
    renderSongsList(allSongs);
}

function setupSetlistDragAndDrop() {
    const container = document.getElementById('setlistItems');
    if (!container) return;

    container.addEventListener('dragstart', (event) => {
        const item = event.target.closest('.setlist-item');
        if (!item) return;
        draggedSetlistIndex = Number(item.dataset.index);
        event.dataTransfer.effectAllowed = 'move';
        item.classList.add('dragging');
    });

    container.addEventListener('dragend', (event) => {
        const item = event.target.closest('.setlist-item');
        if (item) {
            item.classList.remove('dragging');
        }
        draggedSetlistIndex = null;
    });

    container.addEventListener('dragover', (event) => {
        event.preventDefault();
    });

    container.addEventListener('drop', (event) => {
        event.preventDefault();
        const targetItem = event.target.closest('.setlist-item');
        if (!targetItem || draggedSetlistIndex === null) return;

        let targetIndex = Number(targetItem.dataset.index);
        if (isNaN(targetIndex)) return;

        const movedSong = setlist.splice(draggedSetlistIndex, 1)[0];
        if (draggedSetlistIndex < targetIndex) {
            targetIndex -= 1;
        }
        setlist.splice(targetIndex, 0, movedSong);
        // Marcar cuál canción se movió para dar feedback visual
        lastMovedSongId = movedSong.id;
        saveSetlist();
        renderSetlist();
        // Limpiar la marca después de la animación
        setTimeout(() => {
            lastMovedSongId = null;
            renderSetlist();
        }, 700);
    });
    
    // Click corto: abrir canción (si no se está arrastrando)
    container.addEventListener('click', (e) => {
        if (setlistIsDragging) {
            e.preventDefault();
            return;
        }
        const item = e.target.closest('.setlist-item');
        if (!item) return;
        const id = item.dataset.id;
        if (id) {
            viewSong(Number(id));
        }
    });

    // Soporte táctil: detectar toque sostenido (long-press) para activar modo arrastre y evitar que un toque corto abra la canción
    container.addEventListener('touchstart', (e) => {
        const item = e.target.closest('.setlist-item');
        if (!item) return;
        clearTimeout(setlistLongPressTimer);
        setlistLongPressTimer = setTimeout(() => {
            setlistIsDragging = true;
            draggedSetlistIndex = Number(item.dataset.index);
            item.classList.add('dragging');
            // marcar como draggable por si el navegador lo soporta
            item.setAttribute('draggable', 'true');
        }, 350); // 350ms para long-press
    }, {passive: true});

    container.addEventListener('touchend', (e) => {
        clearTimeout(setlistLongPressTimer);
        // si estaba en modo arrastre, esperar un pequeño lapso antes de resetear para evitar clicks falsos
        if (setlistIsDragging) {
            setTimeout(() => { setlistIsDragging = false; }, 100);
        }
    });

    container.addEventListener('touchmove', (e) => {
        // si se mueve el dedo, cancelar el long-press (no abrir la canción)
        clearTimeout(setlistLongPressTimer);
    }, {passive: true});
}

// Ver una canción
async function viewSong(id) {
    showLoading();
    try {
        const response = await fetch(`/api/canciones/${id}`);
        currentSong = await response.json();
        // Mostrar la canción
        displaySongDetail();
        showSection('song-detail');
        // Añadir entrada de historial para interceptar botón atrás del teléfono
        try {
            history.pushState({page: 'song', songId: id}, '', '#song-' + id);
        } catch (err) {
            // ignore
        }
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

    // Mostrar solo el título; quitar autor/género/tono del encabezado
    document.getElementById('detailTitle').textContent = currentSong.titulo;
    const authorEl = document.getElementById('detailAuthor');
    if (authorEl) authorEl.textContent = '';

    // Renderizar contenido con acordes resaltados
    const formattedContent = formatSongContent(currentSong.contenido);
    document.getElementById('songContent').innerHTML = formattedContent;
}

// Formatear contenido de la canción con acordes coloreados
function formatSongContent(content) {
    return content
        .replace(/\[([^\]]+)\]/g, '<span class="chord">$1</span>')
        .replace(/\n/g, '<br>');
}


// Transponer un tono arriba
async function transposeUp() {
    if (!currentSong) return;
    const currentKey = currentSong.tono_original;
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const currentIndex = notes.indexOf(currentKey);
    const newIndex = (currentIndex + 1) % 12;
    const newKey = notes[newIndex];

    await transposeToKey(newKey);
}

// Transponer un tono abajo
async function transposeDown() {
    if (!currentSong) return;
    const currentKey = currentSong.tono_original;
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const currentIndex = notes.indexOf(currentKey);
    const newIndex = (currentIndex - 1 + 12) % 12;
    const newKey = notes[newIndex];

    await transposeToKey(newKey);
}

// Función auxiliar para transponer a una tonalidad específica
async function transposeToKey(newKey) {
    if (!currentSong) return;
    const currentKey = currentSong.tono_original;

    if (currentKey === newKey) {
        return; // No hay cambio
    }

    showLoading();
    try {
        const response = await fetch('/api/transponer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contenido: currentSong.contenido,
                tono_original: currentKey,
                tono_nuevo: newKey,
                isLatin: false
            })
        });

        if (response.ok) {
            const data = await response.json();

            currentSong.contenido = data.contenido;
            currentSong.tono_original = newKey;
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
    const autoBtn = document.getElementById('autoToggleBtn');
    if (autoBtn) autoBtn.textContent = '⏸';

    const scrollContent = document.getElementById('songContent');
    const delay = SPEED_DELAYS[speedIndex];

    scrollInterval = setInterval(() => {
        if (!scrollPaused) {
            scrollContent.scrollBy(0, 3);
        }
    }, delay);
}

function stopAutoScroll() {
    autoScrollActive = false;
    scrollPaused = false;
    clearInterval(scrollInterval);
    const autoBtn = document.getElementById('autoToggleBtn');
    if (autoBtn) autoBtn.textContent = '▶';
}

function togglePauseScroll() {
    scrollPaused = !scrollPaused;
    const autoBtn = document.getElementById('autoToggleBtn');
    if (autoBtn) autoBtn.textContent = scrollPaused ? '▶' : '⏸';
}

function cycleSpeed() {
    speedIndex = (speedIndex + 1) % 3;
    const btn = document.getElementById('speedToggleBtn');
    if (btn) btn.textContent = ['x1', 'x2', 'x3'][speedIndex];
    if (autoScrollActive && !scrollPaused) {
        clearInterval(scrollInterval);
        startAutoScroll();
    }
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
