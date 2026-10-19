"""
Alaba Tool · importador de canciones desde .docx (exportados de Google Drive)

Convierte el formato "acordes en la línea de arriba":

        C                 Am          C
        Cristo me ama, bien lo sé,

al formato de la app:

        [C]Cristo me ama, [Am]bien lo [C]sé,

Como los documentos usan fuentes proporcionales (Arial, Calibri…), contar
espacios no sirve: se mide el ancho real de cada carácter con la fuente y el
tamaño del documento (Pillow + las fuentes de Windows) y cada acorde se coloca
sobre el carácter de la letra que queda debajo de él.

Uso:
    python -I scripts/importar-canciones.py <carpeta con .docx> <Himno|Canto> [<carpeta> <genero> ...]

Genera en importar/:
    canciones.json        todo lo convertido (para revisar o reprocesar)
    importar.sql          INSERTs listos para el SQL Editor de Supabase
    reporte.md            resumen: importadas, duplicadas, omitidas y avisos
"""

import json
import re
import sys
import unicodedata
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from PIL import ImageFont

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'

# ---------------------------------------------------------------------------
# Fuentes: nombre de fuente → archivo de Windows (normal, negrita)
# ---------------------------------------------------------------------------
FONT_DIR = Path('C:/Windows/Fonts')
FONT_FILES = {
    'arial': ('arial.ttf', 'arialbd.ttf'),
    'calibri': ('calibri.ttf', 'calibrib.ttf'),
    'calibri light': ('calibril.ttf', 'calibrib.ttf'),
    'times new roman': ('times.ttf', 'timesbd.ttf'),
    'courier new': ('cour.ttf', 'courbd.ttf'),
    'verdana': ('verdana.ttf', 'verdanab.ttf'),
    'tahoma': ('tahoma.ttf', 'tahomabd.ttf'),
    'georgia': ('georgia.ttf', 'georgiab.ttf'),
    'trebuchet ms': ('trebuc.ttf', 'trebucbd.ttf'),
    'cambria': ('cambria.ttc', 'cambriab.ttf'),
    'segoe ui': ('segoeui.ttf', 'segoeuib.ttf'),
    'consolas': ('consola.ttf', 'consolab.ttf'),
}
MEASURE_SIZE = 100  # se mide a 100 px y se escala al tamaño real (más precisión)
_font_cache = {}


def load_font(name, bold):
    key = ((name or 'arial').lower(), bold)
    if key not in _font_cache:
        normal, negrita = FONT_FILES.get(key[0], FONT_FILES['arial'])
        path = FONT_DIR / (negrita if bold else normal)
        if not path.exists():
            path = FONT_DIR / normal
        if not path.exists():
            path = FONT_DIR / 'arial.ttf'
        _font_cache[key] = ImageFont.truetype(str(path), MEASURE_SIZE)
    return _font_cache[key]


def text_width(text, font_name, bold, size_pt):
    return load_font(font_name, bold).getlength(text) * size_pt / MEASURE_SIZE


# ---------------------------------------------------------------------------
# Acordes
# ---------------------------------------------------------------------------
LATIN_TO_EN = {'do': 'C', 're': 'D', 'mi': 'E', 'fa': 'F', 'sol': 'G', 'la': 'A', 'si': 'B'}
SUFFIX = r'(?:maj|min|m|M|dim|aug|sus|add|°|º|ø|\+|-)?\d{0,2}(?:(?:sus|add|maj|b|#|\+|-)\d{1,2})*(?:\(\w{1,4}\))?'
CHORD_EN = re.compile(rf'^([A-G])([#b]?)({SUFFIX})(?:/([A-G])([#b]?))?$')
CHORD_LATIN = re.compile(rf'^(Do|Re|Mi|Fa|Sol|La|Si)([#b]?)({SUFFIX})(?:/(Do|Re|Mi|Fa|Sol|La|Si)([#b]?))?$')
# Tokens que pueden acompañar a los acordes en su línea sin ser letra
CHORD_LINE_NOISE = re.compile(r'^(?:\|+|/+|-+|\.+|x\d+|\(x\d+\)|%|\*+)$', re.IGNORECASE)
FLAT_TO_SHARP = {'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B', 'Fb': 'E'}


def parse_chord(token):
    """Devuelve (acorde en notación inglesa, era_latino) o None si no es acorde."""
    m = CHORD_EN.match(token)
    if m:
        return token, False
    m = CHORD_LATIN.match(token)
    if m:
        root = LATIN_TO_EN[m.group(1).lower()] + m.group(2)
        bass = (LATIN_TO_EN[m.group(4).lower()] + m.group(5)) if m.group(4) else None
        return root + m.group(3) + (f'/{bass}' if bass else ''), True
    return None


def key_from_chord(chord):
    """Tono a partir de un acorde: raíz (en sostenidos) + 'm' si es menor."""
    m = CHORD_EN.match(chord)
    if not m:
        return None
    root = m.group(1) + m.group(2)
    root = FLAT_TO_SHARP.get(root, root)
    suffix = m.group(3)
    minor = suffix.startswith('m') and not suffix.startswith('maj')
    return root + ('m' if minor else '')


# ---------------------------------------------------------------------------
# Lectura del .docx: líneas con la posición x (en puntos) de cada carácter
# ---------------------------------------------------------------------------
class DocxStyle:
    def __init__(self, zf):
        self.font = 'Arial'
        self.size = 11.0
        self.minor_font = 'Calibri'
        self.major_font = 'Calibri Light'
        try:
            theme = ET.fromstring(zf.read('word/theme/theme1.xml'))
            minor = theme.find(f'.//{A}minorFont/{A}latin')
            major = theme.find(f'.//{A}majorFont/{A}latin')
            if minor is not None:
                self.minor_font = minor.get('typeface') or self.minor_font
            if major is not None:
                self.major_font = major.get('typeface') or self.major_font
        except KeyError:
            pass
        try:
            styles = ET.fromstring(zf.read('word/styles.xml'))
            defaults = styles.find(f'{W}docDefaults/{W}rPrDefault/{W}rPr')
            if defaults is not None:
                self.font, self.size = self.apply_rpr(defaults, self.font, self.size)
            normal = styles.find(f"{W}style[@{W}styleId='Normal']/{W}rPr")
            if normal is not None:
                self.font, self.size = self.apply_rpr(normal, self.font, self.size)
        except KeyError:
            pass

    def apply_rpr(self, rpr, font, size):
        fonts = rpr.find(f'{W}rFonts')
        if fonts is not None:
            if fonts.get(f'{W}ascii'):
                font = fonts.get(f'{W}ascii')
            elif fonts.get(f'{W}asciiTheme'):
                font = self.major_font if 'major' in fonts.get(f'{W}asciiTheme') else self.minor_font
        sz = rpr.find(f'{W}sz')
        if sz is not None and sz.get(f'{W}val'):
            size = float(sz.get(f'{W}val')) / 2
        return font, size


def read_docx_lines(path):
    """Lista de líneas; cada línea es una lista de (carácter, x_inicio, ancho) en puntos."""
    with zipfile.ZipFile(path) as zf:
        style = DocxStyle(zf)
        body = ET.fromstring(zf.read('word/document.xml')).find(f'{W}body')

    lines = []
    for p in body.iter(f'{W}p'):
        ppr = p.find(f'{W}pPr')
        tab_stops = []
        indent = 0.0
        if ppr is not None:
            for tab in ppr.findall(f'{W}tabs/{W}tab'):
                if tab.get(f'{W}val') != 'clear' and tab.get(f'{W}pos'):
                    tab_stops.append(float(tab.get(f'{W}pos')) / 20)
            ind = ppr.find(f'{W}ind')
            if ind is not None:
                indent = float(ind.get(f'{W}left') or ind.get(f'{W}start') or 0) / 20
        tab_stops.sort()

        current = []
        x = 0.0
        for r in p.iter(f'{W}r'):
            rpr = r.find(f'{W}rPr')
            font, size, bold = style.font, style.size, False
            if rpr is not None:
                font, size = style.apply_rpr(rpr, font, size)
                b = rpr.find(f'{W}b')
                bold = b is not None and b.get(f'{W}val') not in ('0', 'false')
            for child in r:
                if child.tag == f'{W}t':
                    for ch in child.text or '':
                        w = text_width(ch, font, bold, size)
                        current.append((ch, x, w))
                        x += w
                elif child.tag == f'{W}tab':
                    absolute = x + indent
                    nxt = next((t for t in tab_stops if t > absolute + 0.5), None)
                    if nxt is None:
                        nxt = (int(absolute // 36) + 1) * 36  # tabulación por defecto: 0.5"
                    current.append(('\t', x, nxt - absolute))
                    x = nxt - indent
                elif child.tag in (f'{W}br', f'{W}cr'):
                    lines.append(current)
                    current, x = [], 0.0
        lines.append(current)
    return lines


def line_text(line):
    return ''.join(ch for ch, _, _ in line).replace('\t', ' ').rstrip()


def chord_tokens(line):
    """Si la línea es de acordes, devuelve [(acorde, x)]; si no, None."""
    tokens, buf, start = [], '', None
    for ch, x, _ in line + [(' ', 0, 0)]:
        if ch.isspace() or ch == '\u00a0':
            if buf:
                tokens.append((buf, start))
                buf = ''
        else:
            if not buf:
                start = x
            buf += ch
    if not tokens:
        return None

    chords, latin_hits, label = [], 0, None
    for i, (tok, x) in enumerate(tokens):
        # "Intro:" / "Coro:" al inicio de una línea de acordes
        if i == 0 and tok.endswith(':') and len(tokens) > 1:
            label = tok
            continue
        clean = tok.strip('()[]|-').rstrip('.,;')  # "D." / "Re." también son acordes
        parsed = parse_chord(clean) if clean else None
        if parsed:
            chords.append((parsed[0], x))
            latin_hits += parsed[1]
        elif CHORD_LINE_NOISE.match(tok):
            continue
        else:
            return None
    if not chords:
        return None
    # Una sola palabra latina suelta ("Si", "La", "Mi") es más probable que sea letra
    if latin_hits and len(chords) == 1 and len(tokens) == 1 and len(chords[0][0]) <= 2 and not label:
        if tokens[0][0] in ('Si', 'La', 'Mi', 'Re', 'Do', 'Fa', 'Sol'):
            return None
    return {'chords': chords, 'label': label}


VOWELS = set('aeiouáéíóúüAEIOUÁÉÍÓÚÜ')
CLUSTER_FIRST = set('bcdfgkptBCDFGKPT')  # br, cl, tr, pl…
DIGRAPHS = {'ch', 'll', 'rr'}


def syllable_start(text, idx):
    """Los músicos suelen escribir el acorde sobre la VOCAL de la sílaba
    ("ca-de-nas" con el acorde sobre la 'a'). Si el acorde cae en una vocal
    precedida de consonante, se mueve al inicio de la sílaba: c[G]adenas →
    [G]cadenas, aq[G]uí → a[G]quí, Salv[A]ador → Sal[A]vador."""
    if not (0 < idx < len(text)) or text[idx] not in VOWELS:
        return idx
    j = idx - 1
    if not text[j].isalpha() or text[j] in VOWELS:
        return idx
    if j > 0 and text[j - 1].isalpha():
        pair = (text[j - 1] + text[j]).lower()
        if pair in DIGRAPHS or (text[j].lower() in 'lr' and text[j - 1] in CLUSTER_FIRST):
            j -= 1
    return j


def merge(chord_info, lyric):
    """Inserta los acordes en la letra según su posición horizontal."""
    text = [ch if ch != '\t' else ' ' for ch, _, _ in lyric]
    inserts = []
    end_x = lyric[-1][1] + lyric[-1][2] if lyric else 0
    trailing = []
    for chord, cx in chord_info['chords']:
        if cx >= end_x - 0.5:
            trailing.append(chord)
            continue
        # Carácter cuyo tramo contiene la x del acorde (o el más cercano)
        idx = min(range(len(lyric)), key=lambda i: 0 if lyric[i][1] <= cx < lyric[i][1] + lyric[i][2]
                  else abs(lyric[i][1] - cx))
        # Si cae sobre un espacio, se mueve al inicio de la palabra siguiente
        while idx < len(text) - 1 and text[idx] == ' ':
            idx += 1
        inserts.append((syllable_start(text, idx), chord))

    out = list(text)
    for idx, chord in sorted(inserts, key=lambda t: t[0], reverse=True):
        out.insert(idx, f'[{chord}]')
    merged = ''.join(out).rstrip()
    if trailing:
        merged += ' ' + ' '.join(f'[{c}]' for c in trailing)
    return merged


def chords_only(chord_info):
    prefix = (chord_info['label'] + ' ') if chord_info['label'] else ''
    return prefix + ' '.join(f'[{c}]' for c, _ in chord_info['chords'])


def convert(lines):
    out, chord_lines, i = [], 0, 0
    while i < len(lines):
        line = lines[i]
        info = chord_tokens(line)
        if info:
            chord_lines += 1
            nxt = lines[i + 1] if i + 1 < len(lines) else None
            if nxt and line_text(nxt).strip() and not chord_tokens(nxt):
                out.append(merge(info, nxt))
                i += 2
                continue
            out.append(chords_only(info))
        else:
            out.append(line_text(line))
        i += 1

    # Etiquetas que ya venían entre corchetes en el original ("[Intro]", "[Verse 1]",
    # "[X2]") no son acordes: se dejan como texto para que la app no las pinte.
    out = [re.sub(r'\[([^\]]+)\]', lambda m: m.group(0) if CHORD_EN.match(m.group(1)) else m.group(1), l)
           for l in out]

    # Normalizar líneas vacías: como máximo una seguida, sin vacías al inicio/fin
    cleaned = []
    for l in out:
        if not l.strip() and (not cleaned or not cleaned[-1].strip()):
            continue
        cleaned.append(l.rstrip())
    while cleaned and not cleaned[-1].strip():
        cleaned.pop()
    return '\n'.join(cleaned), chord_lines


# ---------------------------------------------------------------------------
# Metadatos a partir del nombre del archivo
# ---------------------------------------------------------------------------
KEY_IN_NAME = re.compile(r'\s*\(\s*([A-G][#b]?m?|(?:Do|Re|Mi|Fa|Sol|La|Si)[#b]?m?)\s*\)\s*', re.IGNORECASE)


def normalize(text):
    text = unicodedata.normalize('NFD', text)
    text = ''.join(c for c in text if unicodedata.category(c) != 'Mn').lower()
    return re.sub(r'[^a-z0-9]+', ' ', text).strip()


KEY_AT_END = re.compile(r'\s+([A-G][#b]?m?)$')  # "Lo Harás Otra Vez D#"


def parse_name(stem, genero):
    name = re.sub(r'\s*\(\d\)$', '', stem.strip())  # copias de Drive: "Renuevame(1)"
    name = re.sub(r'^Copia de\s+', '', name, flags=re.IGNORECASE)
    # Drive cambia "/" "?" ":" por "_" al descargar
    name = name.replace(' _ ', ' / ')
    if '¿' in name and '?' not in name:
        name = name.rstrip(' _') + '?'
    if '¡' in name and '!' not in name:
        name = name.rstrip(' _') + '!'
    key = None
    m = KEY_IN_NAME.search(name) or KEY_AT_END.search(name)
    if m:
        raw = m.group(1)
        parsed = parse_chord(raw[0].upper() + raw[1:])
        if parsed:
            key = key_from_chord(parsed[0])
        name = (name[:m.start()] + ' ' + name[m.end():]).strip()
    name = re.sub(r'\s+', ' ', name).rstrip(' _-.')
    name = re.sub(r'\s+bien$', '', name, flags=re.IGNORECASE)  # "Victoria en Cristo bien"
    # Himnos: "551 Título" → "#551 Título"; "7#Título" → "#7 Título"
    if genero == 'Himno':
        name = re.sub(r'^(\d+)\s*#\s*', r'#\1 ', name)
        name = re.sub(r'^#?(\d+)\s+', r'#\1 ', name)

    autor = None
    if genero == 'Canto' and ' - ' in name:
        titulo, resto = name.split(' - ', 1)
        # "Cuán Grande es Dios - Cuan Grande es él (Arreglo Aniversario)" es un
        # popurrí, no un autor: se queda todo como título.
        if not re.search(r'arreglo|medley|popurr', resto, re.IGNORECASE):
            name, autor = titulo.strip(), resto.strip() or None

    group = normalize(re.sub(r'^#?\d+\s*', '', name))
    return name, autor, key, group


def drop_title_lines(content, titulo):
    """Quita del contenido las primeras líneas que repiten el título."""
    lines = content.split('\n')
    target = normalize(re.sub(r'^#?\d+\s*', '', titulo))
    while lines and (not lines[0].strip() or (target and target in normalize(lines[0]) and '[' not in lines[0])):
        lines.pop(0)
    return '\n'.join(lines)


NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
# Acordes diatónicos por grado: (semitonos desde la tónica, calidad)
MAJOR_DEGREES = {(0, 'M'), (2, 'm'), (4, 'm'), (5, 'M'), (7, 'M'), (9, 'm'), (11, 'd')}
MINOR_DEGREES = {(0, 'm'), (2, 'd'), (3, 'M'), (5, 'm'), (7, 'M'), (7, 'm'), (8, 'M'), (10, 'M')}


def chord_root_quality(chord):
    m = CHORD_EN.match(chord)
    if not m:
        return None
    root = FLAT_TO_SHARP.get(m.group(1) + m.group(2), m.group(1) + m.group(2))
    suffix = m.group(3)
    if suffix.startswith(('dim', '°', 'º')):
        quality = 'd'
    elif suffix.startswith('m') and not suffix.startswith('maj'):
        quality = 'm'
    else:
        quality = 'M'
    return NOTES.index(root), quality


def infer_key(content):
    """Tono que mejor explica todos los acordes (diatónicos), con peso extra
    para el primer y el último acorde. Devuelve (tono, es_incierto)."""
    chords = [rq for rq in (chord_root_quality(c) for c in re.findall(r'\[([^\]]+)\]', content)) if rq]
    if not chords:
        return None, True
    first, last = chords[0], chords[-1]
    scores = []
    for tonic in range(12):
        for mode, degrees, tonic_quality in (('', MAJOR_DEGREES, 'M'), ('m', MINOR_DEGREES, 'm')):
            fit = sum(((r - tonic) % 12, q) in degrees for r, q in chords) / len(chords)
            score = fit * 10
            score += 3 if last == (tonic, tonic_quality) else 0
            score += 2 if first == (tonic, tonic_quality) else 0
            score += 0.1 if mode == '' else 0  # empate → mayor
            scores.append((score, NOTES[tonic] + mode))
    scores.sort(reverse=True)
    best, second = scores[0], scores[1]
    return best[1], best[0] - second[0] < 1.5


# ---------------------------------------------------------------------------
def main(args):
    if len(args) < 2 or len(args) % 2:
        print(__doc__)
        sys.exit(1)

    songs, skipped, errors = [], [], []
    for folder, genero in zip(args[::2], args[1::2]):
        for path in sorted(Path(folder).rglob('*.docx')):
            if path.name.startswith('~$'):
                continue
            try:
                lines = read_docx_lines(path)
            except Exception as exc:  # documento dañado o con formato raro
                errors.append({'archivo': str(path), 'error': str(exc)})
                continue
            content, chord_lines = convert(lines)
            titulo, autor, key, group = parse_name(path.stem, genero)
            if chord_lines == 0:
                skipped.append({'archivo': str(path.relative_to(folder)), 'motivo': 'sin acordes'})
                continue
            content = drop_title_lines(content, titulo)
            inferred, uncertain = infer_key(content)
            songs.append({
                'archivo': str(path.relative_to(folder)),
                'carpeta': genero,
                'titulo': titulo[:255],
                'autor': autor[:255] if autor else None,
                'genero': genero,
                'tono_original': key or inferred or 'C',
                'tono_origen': 'nombre' if key else ('acordes (incierto)' if uncertain else 'acordes'),
                'contenido': content,
                'grupo': group,
                'tiene_tono_en_nombre': bool(key),
                'lineas_acordes': chord_lines,
            })

    # Duplicados: una canción por grupo. Preferencia: Himnos > Cantos, nombre sin
    # tono, versión "bien", más líneas de acordes, nombre más corto.
    # Un canto con autor ("En la Cruz - Hillsong") es otra canción aunque se
    # llame igual que un himno ("#110 En la cruz"): se agrupa aparte.
    by_group = {}
    for s in songs:
        group = s['grupo'] + (f"|{normalize(s['autor'])}" if s['genero'] == 'Canto' and s['autor'] else '')
        by_group.setdefault(group, []).append(s)
    # Un canto SIN autor se une al único canto con autor del mismo título
    # ("Aquí estoy (A)" + "Aquí Estoy - Hillsong").
    for group in [g for g in by_group if '|' not in g]:
        with_author = [g for g in by_group if g.startswith(group + '|')]
        cantos = [s for s in by_group[group] if s['genero'] == 'Canto']
        if len(with_author) == 1 and cantos:
            by_group[with_author[0]].extend(cantos)
            by_group[group] = [s for s in by_group[group] if s['genero'] != 'Canto']
            if not by_group[group]:
                del by_group[group]
    chosen, duplicates = [], []
    for group, items in by_group.items():
        items.sort(key=lambda s: (
            s['genero'] != 'Himno',
            s['tiene_tono_en_nombre'],
            'bien' not in normalize(s['archivo']),
            -s['lineas_acordes'],
            len(s['archivo']),
        ))
        chosen.append(items[0])
        for other in items[1:]:
            duplicates.append({'archivo': other['archivo'], 'carpeta': other['carpeta'], 'se_quedo': items[0]['archivo']})
    chosen.sort(key=lambda s: (s['genero'], normalize(s['titulo'])))

    out_dir = Path('importar')
    out_dir.mkdir(exist_ok=True)
    (out_dir / 'canciones.json').write_text(
        json.dumps({'canciones': chosen, 'duplicadas': duplicates, 'omitidas': skipped, 'errores': errors},
                   ensure_ascii=False, indent=2), encoding='utf-8')
    write_sql(chosen, out_dir / 'importar.sql')
    write_report(chosen, duplicates, skipped, errors, out_dir / 'reporte.md')
    print(f'Canciones: {len(chosen)} | duplicadas: {len(duplicates)} | omitidas: {len(skipped)} | errores: {len(errors)}')


def dollar(text):
    tag = '$alaba$'
    while tag in text:
        tag = tag[:-1] + 'x$'
    return f'{tag}{text}{tag}'


def write_sql(songs, path):
    rows = []
    for s in songs:
        autor = dollar(s['autor']) if s['autor'] else 'null'
        rows.append(f"  ({dollar(s['titulo'])}, {autor}, '{s['genero']}', '{s['tono_original']}', {dollar(s['contenido'])})")
    sql = [
        '-- Alaba Tool · importación de canciones desde Google Drive',
        f'-- {len(songs)} canciones. Idempotente: no inserta títulos que ya existan.',
        '-- Ejecutar en Supabase → SQL Editor.',
        'begin;',
        'insert into public.alaba_canciones (titulo, autor, genero, tono_original, contenido)',
        'select v.titulo, v.autor, v.genero, v.tono_original, v.contenido',
        'from (values',
        ',\n'.join(rows),
        ') as v(titulo, autor, genero, tono_original, contenido)',
        'where not exists (select 1 from public.alaba_canciones c where c.titulo = v.titulo);',
        'commit;',
        '',
    ]
    path.write_text('\n'.join(sql), encoding='utf-8')


def write_report(songs, duplicates, skipped, errors, path):
    lines = ['# Reporte de importación', '']
    for genero in ('Himno', 'Canto'):
        n = sum(1 for s in songs if s['genero'] == genero)
        lines.append(f'- **{genero}s:** {n}')
    lines += [f'- **Duplicadas (no se importan):** {len(duplicates)}',
              f'- **Omitidas:** {len(skipped)}', f'- **Errores:** {len(errors)}', '']
    uncertain = [s for s in songs if s['tono_origen'] == 'acordes (incierto)']
    if uncertain:
        lines += ['## Tono deducido con poca certeza (revisar)', '',
                  '| Canción | Tono asignado |', '|---|---|']
        lines += [f"| {s['titulo']} | {s['tono_original']} |" for s in uncertain]
        lines.append('')
    if duplicates:
        lines += ['## Duplicadas', '', '| Archivo | Se importó en su lugar |', '|---|---|']
        lines += [f"| {d['carpeta']}/{d['archivo']} | {d['se_quedo']} |" for d in duplicates]
        lines.append('')
    if skipped:
        lines += ['## Omitidas', '', '| Archivo | Motivo |', '|---|---|']
        lines += [f"| {s['archivo']} | {s['motivo']} |" for s in skipped]
        lines.append('')
    if errors:
        lines += ['## Errores', '', '| Archivo | Error |', '|---|---|']
        lines += [f"| {e['archivo']} | {e['error']} |" for e in errors]
    path.write_text('\n'.join(lines), encoding='utf-8')


if __name__ == '__main__':
    main(sys.argv[1:])
