// ---------------------------------------------------------------------------
// Módulo de Usuarios (solo Administrador)
//
// - Listar, cambiar rol y quitar acceso: directo a Supabase; las políticas RLS
//   de alaba_miembros solo lo permiten a un admin y nunca sobre sí mismo.
// - Dar de alta: pasa por la función de Netlify /api/admin/usuarios, porque
//   crear cuentas de Auth requiere la service_role key. Dar de alta un usuario
//   que ya existe le restablece la contraseña (sirve para contraseñas olvidadas).
//
// "Quitar acceso" solo borra la fila de alaba_miembros; si después se le vuelve
// a dar de alta, recupera el acceso con la nueva contraseña.
// ---------------------------------------------------------------------------

let loadedMembers = [];

async function loadMembers() {
    const container = document.getElementById('membersList');
    container.innerHTML = '<div class="text-gray-500">Cargando usuarios...</div>';

    const { data, error } = await sb
        .from('alaba_miembros')
        .select('user_id, usuario, rol, creado_en')
        .order('usuario');

    if (error) {
        console.error('Error al cargar usuarios:', error);
        container.innerHTML = '<div class="text-red-500">Error al cargar los usuarios</div>';
        return;
    }

    loadedMembers = data;
    renderMembers(data);
}

function renderMembers(members) {
    const container = document.getElementById('membersList');

    if (members.length === 0) {
        container.innerHTML = '<div class="text-gray-500">No hay usuarios todavía.</div>';
        return;
    }

    container.innerHTML = members.map(member => {
        const isMe = currentUser && member.user_id === currentUser.id;
        const options = Object.entries(ROLE_LABEL).map(([value, label]) =>
            `<option value="${value}" ${member.rol === value ? 'selected' : ''}>${label}</option>`
        ).join('');

        return `
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 border border-gray-200 rounded-lg p-4">
            <div class="min-w-0">
                <p class="font-semibold text-gray-800 break-all">${escapeHtml(member.usuario)}${isMe ? ' <span class="text-sm text-gray-500 font-normal">(tú)</span>' : ''}</p>
                <p class="text-xs text-gray-500">Alta: ${new Date(member.creado_en).toLocaleDateString('es-MX')}</p>
            </div>
            <div class="flex gap-2 items-center">
                <select onchange="changeMemberRole('${member.user_id}', this)" data-previous="${member.rol}"
                        class="px-3 py-2 border border-gray-300 rounded-lg text-sm" ${isMe ? 'disabled title="No puedes cambiar tu propio rol"' : ''}>
                    ${options}
                </select>
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

async function revokeMember(userId) {
    const member = loadedMembers.find(m => m.user_id === userId);
    const usuario = member ? `"${member.usuario}"` : 'este usuario';
    if (!confirm(`¿Quitar el acceso a Alaba Tool de ${usuario}?\n\nDejará de poder entrar. Puedes volver a darle de alta cuando quieras.`)) {
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

async function handleCreateMember(event) {
    event.preventDefault();

    const payload = {
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

        alert(body.creada
            ? `Usuario "${payload.usuario}" creado.\nCompártele la contraseña temporal y pídele que la cambie en "Mi cuenta".`
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
