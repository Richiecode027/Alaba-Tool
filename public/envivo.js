// ---------------------------------------------------------------------------
// Modo En vivo: los músicos ven exactamente lo que ve el líder
//
// El líder (Editor o Administrador) transmite qué canción tiene abierta, en
// qué tono y por dónde va. Los músicos que entran a "En vivo" lo siguen sin
// tocar la pantalla: cambia la canción, el tono y la posición junto con él.
//
// Usa Supabase Realtime (broadcast + presence) en un canal PRIVADO; las
// políticas de supabase/migration-2-en-vivo.sql dejan escuchar a cualquier
// miembro y transmitir solo a editores y administradores.
//
// La posición se comparte por LÍNEA de la canción ("línea 12, a 40 %"), no en
// píxeles, para que coincida aunque cada pantalla tenga otro tamaño de letra o
// las líneas se partan distinto.
// ---------------------------------------------------------------------------

const LIVE_TOPIC = 'alaba:en-vivo';
const LIVE_SEND_EVERY_MS = 250;    // máx. 4 mensajes/s mientras el líder se mueve
const LIVE_HEARTBEAT_MS = 3000;    // estado completo periódico (para quien entra tarde)
const LIVE_LEADER_LOST_MS = 10000; // sin noticias del líder → avisar al músico
const LIVE_SCROLL_ANIM_MS = 260;   // suavizado del desplazamiento en los músicos

const live = {
    mode: null,             // 'leader' | 'follower' | null
    channel: null,
    clientId: (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2),
    startedAt: 0,
    lastSent: 0,
    sendTimer: null,
    heartbeat: null,
    lastAnchor: null,       // líder: última posición conocida de la canción abierta
    leaderId: null,         // músico: a quién está siguiendo
    leader: null,           // músico: { leaderId, startedAt } del líder vigente
    shown: null,            // músico: { songId, tono } que tiene en pantalla
    pending: null,          // músico: último estado recibido mientras cargaba otro
    loading: false,
    lastStateAt: 0,
    watchdog: null,
    scrollAnim: null,
};

// ---------------------------------------------------------------------------
// Canal
// ---------------------------------------------------------------------------
async function openLiveChannel() {
    // Los canales privados autentican con el token de la sesión
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('Tu sesión expiró, vuelve a iniciar sesión');
    sb.realtime.setAuth(session.access_token);

    return sb.channel(LIVE_TOPIC, {
        config: { private: true, broadcast: { self: false }, presence: { key: live.clientId } }
    });
}

function stopLive() {
    if (live.mode === 'leader' && live.channel) {
        live.channel.send({ type: 'broadcast', event: 'fin', payload: { leaderId: live.clientId } });
    }
    clearInterval(live.heartbeat);
    clearInterval(live.watchdog);
    clearTimeout(live.sendTimer);
    cancelAnimationFrame(live.scrollAnim);
    if (live.channel) sb.removeChannel(live.channel);

    Object.assign(live, {
        mode: null, channel: null, heartbeat: null, watchdog: null, sendTimer: null,
        lastAnchor: null, leaderId: null, leader: null, shown: null, pending: null, loading: false
    });
    document.getElementById('liveBadge').classList.add('hidden');
    document.body.classList.remove('live-leading');
    updateLeadButton();
    releaseWakeLockIfIdle();
}

// ---------------------------------------------------------------------------
// Líder
// ---------------------------------------------------------------------------
async function toggleLeading() {
    if (live.mode === 'leader') {
        stopLive();
    } else {
        await startLeading();
    }
}

async function startLeading() {
    if (!can('editor') || !currentSong) return;
    stopLive();

    try {
        // Primero solo escucha: si alguien más está dirigiendo, se pregunta
        // antes de transmitir nada (para no quitarle el mando por accidente)
        live.mode = 'connecting';
        live.channel = await openLiveChannel();

        let resolveSync;
        const firstSync = new Promise(resolve => { resolveSync = resolve; });
        let resolveJoin, rejectJoin, joined = false;
        const subscribed = new Promise((resolve, reject) => { resolveJoin = resolve; rejectJoin = reject; });

        live.channel
            .on('broadcast', { event: 'estado' }, ({ payload }) => {
                // Otro líder tomó el control después que yo: le cedo el mando
                if (live.mode === 'leader' && payload.leaderId !== live.clientId &&
                    isNewerLeader(payload, { leaderId: live.clientId, startedAt: live.startedAt })) {
                    stopLive();
                    alert(`${payload.leaderName} tomó el control del modo En vivo. Dejaste de dirigir.`);
                }
            })
            .on('presence', { event: 'sync' }, () => { resolveSync(); updateLiveBadge(); })
            .on('presence', { event: 'join' }, () => sendLiveState(true)) // quien entra ve todo de inmediato
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    joined = true;
                    resolveJoin();
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    if (joined) {
                        liveConnectionFailed();
                    } else {
                        rejectJoin(new Error('no se pudo conectar al canal (¿falta ejecutar supabase/migration-2-en-vivo.sql?)'));
                    }
                }
            });

        await subscribed;
        // Supabase solo manda la lista de presentes a quien ya se registró en ella,
        // así que primero se registra como "observador" (no cuenta como músico)
        await live.channel.track({ usuario: currentDisplayName, lider: false, conectando: true });
        await Promise.race([firstSync, new Promise(resolve => setTimeout(resolve, 3000))]);
        if (live.mode !== 'connecting') return; // se canceló mientras tanto

        const otherLeader = currentLiveLeaderName();
        if (otherLeader && !confirm(`${otherLeader} está dirigiendo en vivo.\n\n¿Quieres tomar el control? Los músicos pasarán a ver tu pantalla.`)) {
            stopLive();
            return;
        }

        live.mode = 'leader';
        live.startedAt = Date.now();
        await live.channel.track({ usuario: currentDisplayName, lider: true });
        sendLiveState(true);
        live.heartbeat = setInterval(() => sendLiveState(true), LIVE_HEARTBEAT_MS);

        document.getElementById('liveBadge').classList.remove('hidden');
        document.body.classList.add('live-leading');
        updateLiveBadge();
        updateLeadButton();
        requestWakeLock();
    } catch (error) {
        console.error('Error al iniciar En vivo:', error);
        stopLive();
        alert(`No se pudo iniciar el modo En vivo: ${error.message}`);
    }
}

// Nombre de quien está dirigiendo ahora (otro dispositivo), o null
function currentLiveLeaderName() {
    const others = Object.entries(live.channel.presenceState())
        .filter(([key]) => key !== live.clientId)
        .flatMap(([, metas]) => metas)
        .filter(meta => meta.lider);
    return others.length ? others[0].usuario : null;
}

// Posición actual: primera línea visible y qué fracción de ella ya pasó
function liveScrollAnchor() {
    const container = document.getElementById('songContent');
    const lines = container.querySelectorAll('.song-line');
    // Si el líder volvió a la lista para escoger otra canción, se mantiene la última posición
    if (!lines.length || container.offsetParent === null) {
        return live.lastAnchor || { line: 0, frac: 0, atEnd: false };
    }
    const top = container.getBoundingClientRect().top;
    const atEnd = container.scrollTop > 0 && container.scrollTop >= container.scrollHeight - container.clientHeight - 2;
    let anchor = { line: 0, frac: 0, atEnd };
    for (let i = 0; i < lines.length; i++) {
        const rect = lines[i].getBoundingClientRect();
        if (rect.bottom > top + 1) {
            anchor = { line: i, frac: +((top - rect.top) / (rect.height || 1)).toFixed(3), atEnd };
            break;
        }
    }
    live.lastAnchor = anchor;
    return anchor;
}

function sendLiveState(force = false) {
    if (live.mode !== 'leader' || !live.channel || !currentSong) return;

    const wait = LIVE_SEND_EVERY_MS - (Date.now() - live.lastSent);
    if (!force && wait > 0) {
        // Limitar la frecuencia, pero siempre mandar la última posición
        clearTimeout(live.sendTimer);
        live.sendTimer = setTimeout(() => sendLiveState(true), wait);
        return;
    }
    clearTimeout(live.sendTimer);
    live.lastSent = Date.now();
    live.channel.send({
        type: 'broadcast',
        event: 'estado',
        payload: {
            leaderId: live.clientId,
            leaderName: currentDisplayName,
            startedAt: live.startedAt,
            songId: currentSong.id,
            tono: currentSong.tono_original,
            ...liveScrollAnchor()
        }
    });
}

// Llamados desde app.js
function liveSongChanged() {
    if (live.mode !== 'leader') return;
    live.lastAnchor = null;
    sendLiveState(true);
}

function liveLeaderScrolled() {
    if (live.mode === 'leader') sendLiveState();
}

function updateLiveBadge() {
    if (live.mode !== 'leader' || !live.channel) return;
    const musicians = Object.values(live.channel.presenceState()).flat().filter(p => !p.lider && !p.conectando).length;
    document.getElementById('liveListeners').textContent =
        musicians === 1 ? '1 músico' : `${musicians} músicos`;
}

function updateLeadButton() {
    const btn = document.getElementById('leadLiveBtn');
    if (btn) btn.textContent = live.mode === 'leader' ? '■ Terminar en vivo' : '● Dirigir en vivo';
}

// ---------------------------------------------------------------------------
// Músico
// ---------------------------------------------------------------------------
async function startFollowing() {
    stopLive();
    if (autoScrollActive) stopAutoScroll();

    live.mode = 'follower';
    document.getElementById('liveTitle').textContent = 'En vivo';
    document.getElementById('liveContent').innerHTML = '';
    setLiveStatus('Conectando…');
    showSection('en-vivo');
    requestWakeLock();

    try {
        live.channel = await openLiveChannel();
        live.channel
            .on('broadcast', { event: 'estado' }, ({ payload }) => receiveLiveState(payload))
            .on('broadcast', { event: 'fin' }, ({ payload }) => {
                if (payload.leaderId === live.leaderId) {
                    live.leaderId = null;
                    live.leader = null; // el siguiente que dirija, aunque haya empezado antes, se acepta
                    setLiveStatus('El líder terminó la sesión en vivo. Esperando a que alguien dirija…');
                }
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await live.channel.track({ usuario: currentDisplayName, lider: false });
                    if (!live.leaderId) setLiveStatus('Esperando a que el líder empiece a dirigir…');
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    liveConnectionFailed();
                }
            });

        live.watchdog = setInterval(() => {
            if (live.leaderId && Date.now() - live.lastStateAt > LIVE_LEADER_LOST_MS) {
                setLiveStatus('Sin señal del líder… (revisa la conexión)');
            }
        }, 2000);
    } catch (error) {
        console.error('Error al entrar a En vivo:', error);
        setLiveStatus(`No se pudo conectar: ${error.message}`);
    }
}

function leaveLive() {
    stopLive();
    showSection('songs-list');
}

// Si dos líderes coinciden, manda el que empezó después; en empate exacto,
// desempata el identificador (así todos llegan a la misma conclusión).
function isNewerLeader(a, b) {
    if (a.startedAt !== b.startedAt) return a.startedAt > b.startedAt;
    return a.leaderId > b.leaderId;
}

function receiveLiveState(state) {
    if (live.mode !== 'follower') return;
    // Mensajes rezagados del líder anterior (mientras cede el control) se ignoran,
    // salvo que el líder vigente lleve rato sin señal (se le apagó el celular)
    const leaderSilent = Date.now() - live.lastStateAt > LIVE_LEADER_LOST_MS;
    if (live.leader && state.leaderId !== live.leader.leaderId && !isNewerLeader(state, live.leader) && !leaderSilent) return;
    live.leader = { leaderId: state.leaderId, startedAt: state.startedAt };
    live.lastStateAt = Date.now();
    live.leaderId = state.leaderId;
    setLiveStatus(`Siguiendo a ${state.leaderName}`);

    // Si llega un estado mientras se carga otra canción, solo importa el último
    live.pending = state;
    if (!live.loading) processLiveStates();
}

async function processLiveStates() {
    live.loading = true;
    try {
        while (live.pending && live.mode === 'follower') {
            const state = live.pending;
            live.pending = null;
            await applyLiveState(state);
        }
    } finally {
        live.loading = false;
    }
}

async function applyLiveState(state) {
    const container = document.getElementById('liveContent');
    const sameSong = live.shown && live.shown.songId === state.songId;

    if (!sameSong || live.shown.tono !== state.tono) {
        const song = await loadLiveSong(state.songId);
        if (!song || live.mode !== 'follower') return;

        const contenido = song.tono_original === state.tono
            ? song.contenido
            : Transposer.transposeSong(song.contenido, song.tono_original, state.tono);
        document.getElementById('liveTitle').textContent = song.titulo;
        document.getElementById('liveContent').innerHTML = formatSongContent(contenido);
        live.shown = { songId: state.songId, tono: state.tono };
        if (!sameSong) container.scrollTop = 0;
        scrollLiveTo(container, state, false); // canción nueva: saltar directo
        return;
    }
    scrollLiveTo(container, state, true);
}

async function loadLiveSong(id) {
    const cached = allSongs.find(s => s.id === id);
    if (cached) return cached;
    const { data, error } = await sb.from(SONGS_TABLE).select('*').eq('id', id).maybeSingle();
    if (error || !data) {
        setLiveStatus('No se pudo cargar la canción del líder');
        return null;
    }
    allSongs.push(data);
    return data;
}

function scrollLiveTo(container, state, smooth) {
    const max = container.scrollHeight - container.clientHeight;
    let target;
    if (state.atEnd) {
        target = max;
    } else {
        const lines = container.querySelectorAll('.song-line');
        const line = lines[Math.min(state.line, lines.length - 1)];
        if (!line) return;
        const rect = line.getBoundingClientRect();
        const lineTop = rect.top - container.getBoundingClientRect().top + container.scrollTop;
        target = lineTop + state.frac * rect.height;
    }
    target = Math.max(0, Math.min(max, target));

    cancelAnimationFrame(live.scrollAnim);
    const from = container.scrollTop;
    if (!smooth || Math.abs(target - from) < 1) {
        container.scrollTop = target;
        return;
    }
    const start = performance.now();
    const step = (now) => {
        const t = Math.min(1, (now - start) / LIVE_SCROLL_ANIM_MS);
        const eased = 1 - Math.pow(1 - t, 2);
        container.scrollTop = from + (target - from) * eased;
        if (t < 1) live.scrollAnim = requestAnimationFrame(step);
    };
    live.scrollAnim = requestAnimationFrame(step);
}

function setLiveStatus(text) {
    document.getElementById('liveStatus').textContent = text;
}

function liveConnectionFailed() {
    const wasLeader = live.mode === 'leader';
    stopLive();
    const message = 'No se pudo conectar al modo En vivo. Si es la primera vez, falta ejecutar supabase/migration-2-en-vivo.sql.';
    if (wasLeader) {
        alert(message);
    } else {
        setLiveStatus(message); // el músico sigue en la pantalla En vivo, con el aviso
    }
}
