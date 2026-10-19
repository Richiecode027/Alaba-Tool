// ---------------------------------------------------------------------------
// Módulo de Usuarios (solo Administrador)
//
// - Listar, cambiar rol, cambiar nombre y quitar acceso: directo a Supabase;
//   las políticas RLS de alaba_miembros solo lo permiten a un admin y nunca
//   sobre sí mismo (el nombre propio se cambia con alaba_cambiar_mi_nombre).
// - Dar de alta y cambiar contraseñas: pasa por la función de Netlify
//   /api/admin/usuarios, porque tocar cuentas de Auth requiere la service_role key.
//
// "Quitar acceso" solo borra la fila de alaba_miembros; si después se le vuelve
// a dar de alta, recupera el acceso con la nueva contraseña.
// ---------------------------------------------------------------------------

let loadedMembers = [];

async function loadMembers() {
    const container = document.getElementById('membersList');
    container.innerHTML = '<div class="text-gray-500">Cargando usuarios...</div>';

    const { data, error } = await sb.from('alaba_miembros').select('*');

    if (error) {
        console.error('Error al cargar usuarios:', error);
        container.innerHTML = '<div class="text-red-500">Error al cargar los usuarios</div>';
        return;
    }

    loadedMembers = data.sort((a, b) => titleCollator.compare(displayName(a), displayName(b)));
    renderMembers(loadedMembers);
}

function renderMembers(members) {
    const container = document.getElementById('membersList');

    if (members.length === 0) {
        container.innerHTML = '<div class="text-gray-500">No hay usuarios todavía.</div>';
        return;
    }

    const smallButton = 'px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 text-sm';

    container.innerHTML = members.map(member => {
        const isMe = currentUser && member.user_id === currentUser.id;
        const options = Object.entries(ROLE_LABEL).map(([value, label]) =>
            `<option value="${value}" ${member.rol === value ? 'selected' : ''}>${label}</option>`
        ).join('');

        return `
        <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border border-gray-200 rounded-lg p-4">
            <div class="min-w-0">
                <p class="font-semibold text-gray-800 break-words">${escapeHtml(displayName(member))}${isMe ? ' <span class="text-sm text-gray-500 font-normal">(tú)</span>' : ''}</p>
                <p class="text-xs text-gray-500">Usuario: ${escapeHtml(member.usuario)} · Alta: ${new Date(member.creado_en).toLocaleDateString('es-MX')}</p>
            </div>
            <div class="flex flex-wrap gap-2 items-center">
                <select onchange="changeMemberRole('${member.user_id}', this)" data-previous="${member.rol}"
                        class="px-3 py-2 border border-gray-300 rounded-lg text-sm" ${isMe ? 'disabled title="No puedes cambiar tu propio rol"' : ''}>
                    ${options}
                </select>
                <button onclick="renameMember('${member.user_id}')" class="${smallButton}">Nombre</button>
                <button onclick="changeMemberPassword('${member.user_id}')" class="${smallButton}">Contraseña</button>
                ${isMe ? '' : `
                <button onclick="revokeMember('${member.user_id}')"
                        class="px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm">Quitar acceso</button>`}
            </div>
        </div>`;
    }).join('');
}

async function changeMemberRole(userId, select) {
    const rol = select.value;
    const previous = select.dataset.previous;

    showLoading();
    try {
        const { data, error } = await sb.from('alaba_miembros').update({ rol }).eq('user_id', userId).select('user_id');
        if (error) throw error;
        if (!data.length) throw new Error('No tienes permiso para cambiar este rol');
        select.dataset.previous = rol;
    } catch (error) {
        console.error('Error al cambiar rol:', error);
        alert(`No se pudo cambiar el rol: ${error.message}`);
        select.value = previous;
    } finally {
        hideLoading();
    }
}

async function renameMember(userId) {
    const member = loadedMembers.find(m => m.user_id === userId);
    if (!member) return;
    const isMe = currentUser && userId === currentUser.id;

    const nombre = (prompt(`Nombre para mostrar de "${member.usuario}":`, displayName(member)) || '').trim();
    if (!nombre || nombre === displayName(member)) return;
    if (nombre.length > 60) {
        alert('El nombre puede tener como máximo 60 caracteres');
        return;
    }

    showLoading();
    try {
        if (isMe) {
            // El propio nombre va por la función (la política no deja editar la fila propia)
            const { data, error } = await sb.rpc('alaba_cambiar_mi_nombre', { p_nombre: nombre });
            if (error) throw error;
            currentDisplayName = data;
            document.getElementById('accountName').value = data;
        } else {
            const { data, error } = await sb.from('alaba_miembros').update({ nombre }).eq('user_id', userId).select('user_id');
            if (error) throw error;
            if (!data.length) throw new Error('No tienes permiso para cambiar este nombre');
        }
        loadMembers();
    } catch (error) {
        console.error('Error al cambiar nombre:', error);
        alert(`No se pudo cambiar el nombre: ${error.message}`);
    } finally {
        hideLoading();
    }
}

async function changeMemberPassword(userId) {
    const member = loadedMembers.find(m => m.user_id === userId);
    if (!member) return;

    // La propia contraseña se cambia en "Mi cuenta" (sin pasar por el servidor)
    if (currentUser && userId === currentUser.id) {
        openAccountModal();
        document.getElementById('newPassword').focus();
        return;
    }

    const password = prompt(`Nueva contraseña para ${displayName(member)} (${member.usuario}).\nEntre 8 y 72 caracteres; después compártela con esa persona:`);
    if (password === null) return;
    if (password.length < 8 || password.length > 72) {
        alert('La contraseña debe tener entre 8 y 72 caracteres');
        return;
    }

    showLoading();
    try {
        await callAdminUsers({ accion: 'contrasena', usuario: member.usuario, password });
        alert(`Contraseña de ${displayName(member)} actualizada.\nPídele que la cambie por una suya en "Mi cuenta".`);
    } catch (error) {
        console.error('Error al cambiar contraseña:', error);
        alert(`No se pudo cambiar la contraseña: ${error.message}`);
    } finally {
        hideLoading();
    }
}

async function revokeMember(userId) {
    const member = loadedMembers.find(m => m.user_id === userId);
    const nombre = member ? `"${displayName(member)}"` : 'este usuario';
    if (!confirm(`¿Quitar el acceso a Alaba Tool de ${nombre}?\n\nDejará de poder entrar. Puedes volver a darle de alta cuando quieras.`)) {
        return;
    }

    showLoading();
    try {
        const { data, error } = await sb.from('alaba_miembros').delete().eq('user_id', userId).select('user_id');
        if (error) throw error;
        if (!data.length) throw new Error('No tienes permiso para quitar este acceso');
        loadMembers();
    } catch (error) {
        console.error('Error al quitar acceso:', error);
        alert(`No se pudo quitar el acceso: ${error.message}`);
    } finally {
        hideLoading();
    }
}

// Llamada a la función de Netlify con la sesión del admin
async function callAdminUsers(payload) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('Tu sesión expiró, vuelve a iniciar sesión');

    const response = await fetch('/api/admin/usuarios', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
}

async function handleCreateMember(event) {
    event.preventDefault();

    const payload = {
        nombre: document.getElementById('memberName').value.trim(),
        usuario: normalizeUsername(document.getElementById('memberUsername').value),
        password: document.getElementById('memberPassword').value,
        rol: document.getElementById('memberRole').value
    };

    if (!USERNAME_RE.test(payload.usuario)) {
        alert('Usuario inválido: de 3 a 30 caracteres, solo letras minúsculas, números, punto, guion y guion bajo (sin espacios ni acentos).');
        return;
    }

    showLoading();
    try {
        const body = await callAdminUsers(payload);
        const nombre = payload.nombre || displayName({ usuario: payload.usuario });
        alert(body.creada
            ? `${nombre} ya tiene acceso.\nUsuario: ${payload.usuario}\nCompártele la contraseña temporal y pídele que la cambie en "Mi cuenta".`
            : `El usuario "${payload.usuario}" ya existía: se le puso la nueva contraseña y el rol elegido.`);
        document.getElementById('newMemberForm').reset();
        loadMembers();
    } catch (error) {
        console.error('Error al dar de alta:', error);
        alert(`No se pudo dar de alta: ${error.message}`);
    } finally {
        hideLoading();
    }
}
