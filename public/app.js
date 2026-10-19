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

// ---------------------------------------------------------------------------
// Supabase: sesión y roles
// La seguridad real la imponen las políticas RLS (supabase/schema.sql); ocultar
// botones aquí es solo para que cada rol vea lo que puede usar.
// ---------------------------------------------------------------------------
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const SONGS_TABLE = 'alaba_canciones';
const ROLE_LEVEL = { lector: 1, editor: 2, admin: 3 };
const ROLE_LABEL = { lector: 'Lector', editor: 'Editor', admin: 'Administrador' };
let currentUser = null;
let currentRole = null;

function can(minRole) {
    return (ROLE_LEVEL[currentRole] || 0) >= ROLE_LEVEL[minRole];
}

// Muestra/oculta los elementos marcados con data-rol según el rol actual
function applyRolePermissions() {
    document.querySelectorAll('[data-rol]').forEach(el => {
        el.classList.toggle('hidden', !can(el.dataset.rol));
    });
}

function showLoginScreen(message) {
    document.getElementById('app').classList.add('hidden');
    document.getElementById('hamburgerContainer').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
    const noAccess = Boolean(message);
    document.getElementById('loginForm').classList.toggle('hidden', noAccess);
    document.getElementById('noAccessPanel').classList.toggle('hidden', !noAccess);
    document.getElementById('noAccessMessage').textContent = message || '';
}

// Usuarios: se entra con nombre de usuario; en Supabase Auth es <usuario>@USER_DOMAIN
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

function normalizeUsername(value) {
    return (value || '').trim().toLowerCase();
}

function usernameToEmail(username) {
    return `${username}@${USER_DOMAIN}`;
}

function usernameFromEmail(email) {
    return (email || '').split('@')[0];
}

// Tras iniciar sesión: averiguar el rol en Alaba Tool y arrancar la app
async function startApp(user) {
    currentUser = user;
    const { data, error } = await sb.from('alaba_miembros').select('rol, usuario').eq('user_id', user.id).maybeSingle();

    if (error || !data) {
        currentRole = null;
        showLoginScreen(error
            ? 'No se pudo verificar tu acceso. Intenta de nuevo en un momento.'
            : `El usuario "${usernameFromEmail(user.email)}" no tiene acceso a Alaba Tool. Pide a un administrador que te dé de alta.`);
        return;
    }

    currentRole = data.rol;
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('accountUsername').textContent = data.usuario;
    document.getElementById('accountRole').textContent = ROLE_LABEL[currentRole];
    applyRolePermissions();
    showSection('songs-list');
    renderSetlist();
    loadAllSongs();
}

async function handleLogin(event) {
    event.preventDefault();
    const errorEl = document.getElementById('loginError');
    errorEl.classList.add('hidden');

    const username = normalizeUsername(document.getElementById('loginUsername').value);
    if (!USERNAME_RE.test(username)) {
        errorEl.textContent = 'Usuario o contraseña incorrectos';
        errorEl.classList.remove('hidden');
        return;
    }

    showLoading();
    try {
        const { data, error } = await sb.auth.signInWithPassword({
            email: usernameToEmail(username),
            password: document.getElementById('loginPassword').value
        });
        if (error) throw error;
        document.getElementById('loginPassword').value = '';
        await startApp(data.user);
    } catch (error) {
        errorEl.textContent = error.message === 'Invalid login credentials'
            ? 'Usuario o contraseña incorrectos'
            : `No se pudo iniciar sesión: ${error.message}`;
        errorEl.classList.remove('hidden');
    } finally {
        hideLoading();
    }
}

async function logout() {
    closeAccountModal();
    if (autoScrollActive) stopAutoScroll();
    await sb.auth.signOut();
    currentUser = null;
    currentRole = null;
    currentSong = null;
    allSongs = [];
    showLoginScreen();
}

// Modal "Mi cuenta": datos de sesión y cambio de contraseña
function openAccountModal() {
    document.getElementById('accountModal').classList.remove('hidden');
}
function closeAccountModal() {
    document.getElementById('accountModal').classList.add('hidden');
    document.getElementById('changePasswordForm').reset();
}

async function handleChangePassword(event) {
    event.preventDefault();
    const password = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (password.length < 8) {
        alert('La contraseña debe tener al menos 8 caracteres');
        return;
    }
    if (password !== confirmPassword) {
        alert('Las contraseñas no coinciden');
        return;
    }

    showLoading();
    try {
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw error;
        alert('Contraseña actualizada');
        closeAccountModal();
    } catch (error) {
        alert(`No se pudo cambiar la contraseña: ${error.message}`);
    } finally {
        hideLoading();
    }
}

// Arranque: restaurar sesión guardada o mostrar login
document.addEventListener('DOMContentLoaded', async () => {
    loadSetlistFromStorage();
    setupEventListeners();

    sb.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT' && currentUser) {
            currentUser = null;
            currentRole = null;
            showLoginScreen();
        }
    });

    const { data: { session } } = await sb.auth.getSession();
    if (session) {
        await startApp(session.user);
    } else {
        showLoginScreen();
    }
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

// Modal "Sobre el autor"
function openAuthorModal() {
    document.getElementById('authorModal').classList.remove('hidden');
}
function closeAuthorModal() {
    document.getElementById('authorModal').classList.add('hidden');
}
document.addEventListener('click', (e) => {
    if (e.target.id === 'authorModal') closeAuthorModal();
});

// Mostrar/ocultar secciones
function showSection(sectionId) {
    const section = document.getElementById(sectionId);
    // Secciones restringidas por rol (data-requiere="editor" | "admin")
    if (section && section.dataset.requiere && !can(section.dataset.requiere)) {
        return;
    }

    document.querySelectorAll('.section-content').forEach(s => {
        s.classList.add('hidden');
    });

    if (section) {
        section.classList.remove('hidden');
    }

    if (sectionId === 'usuarios') {
        loadMembers();
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
        const { data, error } = await sb.from(SONGS_TABLE).select('*').order('fecha_creacion', { ascending: false });
        if (error) throw error;
        allSongs = data;
        handleSearch(); // respeta la búsqueda/filtro que el usuario tenga escritos
    } catch (error) {
        console.error('Error al cargar canciones:', error);
        document.getElementById('songsList').innerHTML = '<div class="text-red-500">Error al cargar las canciones</div>';
    } finally {
        hideLoading();
    }
}

// Normaliza texto para buscar sin distinguir mayúsculas ni acentos ("senor" encuentra "Señor")
function normalizeForSearch(text) {
    return (text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Buscar canciones (en memoria: todas las canciones ya están cargadas)
function handleSearch() {
    const query = normalizeForSearch(document.getElementById('searchInput').value.trim());
    const genre = document.getElementById('genreFilter').value;

    const results = allSongs.filter(song =>
        (!genre || song.genero === genre) &&
        (!query ||
            normalizeForSearch(song.titulo).includes(query) ||
            normalizeForSearch(song.autor).includes(query))
    );

    renderSongsList(results);
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
                        <span class="bg-red-100 text-red-800 px-2 py-1 rounded">Tono: ${escapeHtml(song.tono_original)}</span>
                    </div>
                </div>
                <div class="flex flex-col gap-2 items-end">
                    <button onclick="event.stopPropagation(); addSongToSetlist(${song.id})" class="px-3 py-1 ${alreadyAdded ? 'bg-gray-300 text-gray-700 cursor-not-allowed' : 'bg-green-500 text-white hover:bg-green-600'} rounded text-sm" ${alreadyAdded ? 'disabled' : ''}>
                        ${alreadyAdded ? 'Añadido' : 'Agregar'}
                    </button>
                    ${can('editor') ? `
                    <button onclick="event.stopPropagation(); deleteSong(${song.id})" class="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm">
                        Eliminar
                    </button>` : ''}
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
                        <span class="px-2 py-1 bg-red-100 rounded">Tono: ${escapeHtml(song.tono_original)}</span>
                    </div>
                </div>
                <div class="flex flex-col gap-2 items-end">
                    <button onclick="event.stopPropagation(); viewSong(${song.id})" class="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm">Ver</button>
                    <button onclick="event.stopPropagation(); removeSongFromSetlist(${index})" class="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm">Eliminar</button>
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
    handleSearch();
}

function removeSongFromSetlist(index) {
    setlist.splice(index, 1);
    saveSetlist();
    renderSetlist();
    handleSearch();
}

function clearSetlist() {
    if (!confirm('¿Deseas vaciar todo el set list?')) {
        return;
    }
    setlist = [];
    saveSetlist();
    renderSetlist();
    handleSearch();
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

        if (draggedSetlistIndex === targetIndex) return;
        const movedSong = setlist.splice(draggedSetlistIndex, 1)[0];
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
        const { data, error } = await sb.from(SONGS_TABLE).select('*').eq('id', id).single();
        if (error) throw error;
        currentSong = data;
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

// Formatear contenido de la canción con los acordes ENCIMA de la letra
// IMPORTANTE: cada línea se escapa ANTES de insertar acordes para evitar XSS
// almacenado (la letra es contenido controlado por el usuario).
function formatSongContent(content) {
    // \r\n (Windows) → \n, si no cada \r se vería como una línea extra
    return String(content ?? '').replace(/\r\n?/g, '\n').split('\n').map(renderSongLine).join('');
}

// Una línea de la canción. Cada acorde va encima del texto que le sigue, como
// en un cancionero. Cada palabra es un bloque aparte (acorde arriba, letra
// abajo) para que la línea pueda partirse en pantallas angostas sin que los
// acordes se desalineen.
function renderSongLine(line) {
    const escaped = escapeHtml(line);
    if (!/\[[^\]]+\]/.test(escaped)) {
        return `<div class="song-line">${escaped || '&nbsp;'}</div>`;
    }

    const parts = escaped.split(/\[([^\]]+)\]/); // [texto, acorde, texto, acorde, texto…]
    const textsAfterChords = parts.filter((_, i) => i > 0 && i % 2 === 0);

    // Línea de solo acordes (intro, interludio), con etiqueta opcional ("Intro: ")
    if (textsAfterChords.every(t => !t.trim())) {
        const chords = parts.filter((_, i) => i % 2 === 1).map(c => `<span class="chord">${c}</span>`).join(' ');
        const label = parts[0].trim() ? `${parts[0].trim()} ` : '';
        return `<div class="song-line chords-only">${label}${chords}</div>`;
    }

    const segments = [];
    const addSegments = (chord, text) => {
        const words = (text.match(/\S*\s*/g) || []).filter(Boolean);
        if (!words.length) {
            if (chord) segments.push(songSegment(chord, ''));
            return;
        }
        words.forEach((word, i) => segments.push(songSegment(i === 0 ? chord : '', word)));
    };
    addSegments('', parts[0]); // texto antes del primer acorde
    for (let i = 1; i < parts.length; i += 2) {
        addSegments(parts[i], parts[i + 1]);
    }
    return `<div class="song-line">${segments.join('')}</div>`;
}

function songSegment(chord, text) {
    return `<span class="seg"><span class="chord">${chord}</span><span class="lyric">${text}</span></span>`;
}


// Mapa de bemoles a sostenidos para normalizar la raíz del tono
const FLAT_TO_SHARP = { 'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#' };

// Desplaza un tono `delta` semitonos preservando el sufijo (m, maj7, etc.)
// Ej: shiftKey('Em', 1) -> 'Fm'  |  shiftKey('Bb', -1) -> 'A'
function shiftKey(key, delta) {
    const match = (key || '').match(/^([A-G][#b]?)(.*)$/);
    if (!match) return key;

    const root = FLAT_TO_SHARP[match[1]] || match[1];
    const suffix = match[2];
    const index = NOTES_ENGLISH.indexOf(root);
    if (index === -1) return key;

    const newRoot = NOTES_ENGLISH[(index + delta + 12) % 12];
    return newRoot + suffix;
}

// Transponer un tono arriba
async function transposeUp() {
    if (!currentSong) return;
    await transposeToKey(shiftKey(currentSong.tono_original, 1));
}

// Transponer un tono abajo
async function transposeDown() {
    if (!currentSong) return;
    await transposeToKey(shiftKey(currentSong.tono_original, -1));
}

// Transponer a una tonalidad específica (en el navegador, sin red).
// Solo cambia la vista: la canción guardada no se modifica salvo que un
// editor la guarde después desde "Editar".
async function transposeToKey(newKey) {
    if (!currentSong) return;
    const currentKey = currentSong.tono_original;

    if (currentKey === newKey) {
        return; // No hay cambio
    }

    currentSong.contenido = Transposer.transposeSong(currentSong.contenido, currentKey, newKey);
    currentSong.tono_original = newKey;
    displaySongDetail();
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
        const { error } = await sb.from(SONGS_TABLE).insert(song);
        if (error) throw error;

        alert('Canción creada exitosamente');
        document.getElementById('newSongForm').reset();
        loadAllSongs();
        showSection('songs-list');
    } catch (error) {
        console.error('Error al crear canción:', error);
        alert(`Error al crear la canción: ${error.message}`);
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
        const { data, error } = await sb.from(SONGS_TABLE).update(song).eq('id', id).select();
        if (error) throw error;
        if (!data.length) throw new Error('No tienes permiso o la canción ya no existe');

        currentSong = data[0];
        alert('Canción actualizada exitosamente');
        displaySongDetail();
        showSection('song-detail');
        loadAllSongs();
    } catch (error) {
        console.error('Error al actualizar canción:', error);
        alert(`Error al actualizar la canción: ${error.message}`);
    } finally {
        hideLoading();
    }
}

// Elimina una canción en la BD y del set list. Devuelve true si se eliminó.
async function removeSong(id) {
    showLoading();
    try {
        const { data, error } = await sb.from(SONGS_TABLE).delete().eq('id', id).select('id');
        if (error) throw error;
        if (!data.length) throw new Error('No tienes permiso o la canción ya no existe');

        setlist = setlist.filter(item => item.id !== id);
        saveSetlist();
        renderSetlist();
        alert('Canción eliminada exitosamente');
        loadAllSongs();
        return true;
    } catch (error) {
        console.error('Error al eliminar canción:', error);
        alert(`Error al eliminar la canción: ${error.message}`);
        return false;
    } finally {
        hideLoading();
    }
}

// Eliminar canción (desde la lista)
async function deleteSong(id) {
    if (!confirm('¿Estás seguro de que deseas eliminar esta canción?')) {
        return;
    }
    await removeSong(id);
}

// Eliminar canción actual
async function deleteCurrentSong() {
    if (!currentSong) return;

    if (!confirm(`¿Estás seguro de que deseas eliminar "${currentSong.titulo}"?`)) {
        return;
    }

    if (await removeSong(currentSong.id)) {
        currentSong = null;
        showSection('songs-list');
    }
}

// Imprimir canción
function printSong() {
    if (!currentSong) return;

    const printWindow = window.open('', '', 'height=600,width=800');

    // Escapar todos los campos antes de inyectarlos en el HTML de impresión.
    const tituloEsc = escapeHtml(currentSong.titulo);
    const metaParts = [
        currentSong.autor ? `Por ${escapeHtml(currentSong.autor)}` : null,
        currentSong.genero ? escapeHtml(currentSong.genero) : null,
        `Tono: ${escapeHtml(currentSong.tono_original)}`
    ].filter(Boolean);

    printWindow.document.write(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>${tituloEsc}</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 2cm; }
                .print-hidden { display: none !important; }
                h1 { margin: 0 0 0.5em 0; }
                p { margin: 0 0 2em 0; color: #666; }
                .chord-display { line-height: 1.8; }
                .chord { color: #000; font-weight: bold; }
                .song-line { line-height: 1.35; margin-bottom: 0.15em; break-inside: avoid; }
                .seg { display: inline-flex; flex-direction: column; vertical-align: bottom; }
                .seg .chord { padding-right: 0.35em; min-height: 1.25em; }
                .seg .lyric { white-space: pre; }
                .chords-only .chord { margin-right: 0.6em; }
            </style>
        </head>
        <body>
            <h1>${tituloEsc}</h1>
            <p>${metaParts.join(' • ')}</p>
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
    return String(unsafe ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
