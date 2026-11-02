"""python-pptx helpers for filling an existing branded deck.

The deck is authored in PowerPoint and shipped as a .pptx; the tool opens it and replaces the
bracketed `[placeholder]` tokens, repopulates the native charts and tables, clones the slides that
repeat per intervention, and drops the slides that don't apply. Nothing is drawn from scratch, so the
master, theme, fonts and branding survive untouched.

python-pptx has no slide-copy or slide-delete API, and no run-safe text replacement — those are the
three things this module provides. The recurring hazard is relationship IDs: a cloned slide's XML
still references the SOURCE part's rIds, so every image/chart reference has to be re-registered
against the new slide part or PowerPoint reports the file as corrupt.
"""

import copy
import re
from typing import Dict, Iterable, List, Optional

from pptx.oxml import parse_xml
from pptx.oxml.ns import nsdecls, qn
from pptx.util import Emu

TOKEN_RE = re.compile(r'\[[^\[\]]{1,120}\]')


# ── text ────────────────────────────────────────────────────────────────────────────────────────

def iter_shapes(shapes) -> Iterable:
    """Depth-first walk that descends into groups."""
    for sh in shapes:
        yield sh
        if sh.shape_type == 6 or sh.__class__.__name__ == 'GroupShape':
            yield from iter_shapes(sh.shapes)


def _replace_in_paragraph(para, mapping: Dict[str, str]) -> bool:
    """Replace `[token]` occurrences in one paragraph, preserving each run's own formatting.

    A token that sits wholly inside one run keeps that run's formatting (this is the common case and
    is what makes the bolded `[X]b` figures on the summary card come out styled correctly). A token
    that straddles runs is written into the first run it touches and erased from the rest — the
    alternative, rewriting the paragraph, would flatten the mixed formatting the template relies on.
    """
    runs = para.runs
    if not runs:
        return False
    full = "".join(r.text for r in runs)
    if '[' not in full:
        return False

    # Run index and offset for every character position in the paragraph.
    spans = []
    pos = 0
    for i, r in enumerate(runs):
        spans.append((pos, pos + len(r.text), i))
        pos += len(r.text)

    matches = [m for m in TOKEN_RE.finditer(full) if m.group(0) in mapping]
    if not matches:
        return False

    # Resolve replacements LEFT-TO-RIGHT first. A token like [X] recurs with a different meaning each
    # time (slide 3 lists seven "[X]b" figures in one paragraph), so a mapping value may be a list
    # that is consumed in reading order; a plain string applies to every occurrence.
    counters: Dict[str, int] = {}
    resolved = []
    for m in matches:
        tok = m.group(0)
        val = mapping[tok]
        if isinstance(val, (list, tuple)):
            i = counters.get(tok, 0)
            counters[tok] = i + 1
            resolved.append(str(val[i]) if i < len(val) else tok)
        else:
            resolved.append(str(val))

    # Apply right-to-left so earlier offsets stay valid as we edit.
    new_texts = [r.text for r in runs]
    for m, repl in zip(reversed(matches), reversed(resolved)):
        s, e = m.start(), m.end()
        touched = [(a, b, i) for (a, b, i) in spans if a < e and b > s]
        if not touched:
            continue
        first_a, _, first_i = touched[0]
        # Write the replacement at the token's offset inside the first run it touches.
        local_s = s - first_a
        head = new_texts[first_i][:local_s]
        last_a, last_b, last_i = touched[-1]
        tail = new_texts[last_i][e - last_a:] if e - last_a <= len(new_texts[last_i]) else ''
        if first_i == last_i:
            new_texts[first_i] = head + repl + tail
        else:
            new_texts[first_i] = head + repl
            for _, _, i in touched[1:-1]:
                new_texts[i] = ''
            new_texts[last_i] = tail
    for r, t in zip(runs, new_texts):
        r.text = t
    return True


def replace_tokens(container, mapping: Dict[str, str]) -> int:
    """Replace tokens across every text frame and table cell under `container` (a slide or shape).

    Returns the number of paragraphs changed."""
    n = 0
    shapes = container.shapes if hasattr(container, 'shapes') else [container]
    for sh in iter_shapes(shapes):
        if sh.has_text_frame:
            for p in sh.text_frame.paragraphs:
                n += 1 if _replace_in_paragraph(p, mapping) else 0
        if getattr(sh, 'has_table', False) and sh.has_table:
            for row in sh.table.rows:
                for cell in row.cells:
                    for p in cell.text_frame.paragraphs:
                        n += 1 if _replace_in_paragraph(p, mapping) else 0
    return n


def set_text(shape_or_cell, text: str, para_idx: int = 0) -> None:
    """Overwrite one paragraph's text, keeping the first run's formatting and dropping the others."""
    tf = shape_or_cell.text_frame
    while len(tf.paragraphs) <= para_idx:
        tf.add_paragraph()
    para = tf.paragraphs[para_idx]
    runs = para.runs
    if not runs:
        para.text = text
        return
    runs[0].text = text
    for r in runs[1:]:
        r._r.getparent().remove(r._r)


def find_shape(slide, name: str):
    for sh in iter_shapes(slide.shapes):
        if sh.name == name:
            return sh
    return None


def delete_shape(shape) -> None:
    shape._element.getparent().remove(shape._element)


def drop_prompt_shapes(slide, marker: str = 'prompt:', canvas=None) -> int:
    """Remove the author's `Prompt: …` guidance boxes so they never reach the delivered deck.

    They are parked off-canvas in the template, which keeps them out of the printed page but NOT out
    of the file — anyone opening the deck in PowerPoint can scroll to them.

    Pass `canvas` as (width_emu, height_emu) to also sweep anything else left entirely outside the
    slide. Each prompt is a textbox sitting on a backing card; deleting the text alone leaves the
    empty card behind, still off-canvas and still in the file. Nothing legitimate lives outside the
    canvas, so clearing the whole region is both safe and the only way to catch those shells."""
    doomed = []
    removed = 0
    for sh in iter_shapes(slide.shapes):
        if sh.has_text_frame and sh.text_frame.text.strip().lower().startswith(marker):
            doomed.append(sh)
            continue
        if canvas and sh.left is not None and sh.width is not None:
            w, h = canvas
            right, bottom = sh.left + sh.width, sh.top + sh.height
            if sh.left >= w or right <= 0 or sh.top >= h or bottom <= 0:
                doomed.append(sh)
                continue
        # A prompt is not always a shape of its own: the appendix tucks one in as the last PARAGRAPH
        # of a box that otherwise holds real content, so a shape-level check leaves it on the slide.
        if sh.has_text_frame:
            for p in list(sh.text_frame.paragraphs):
                txt = "".join(r.text for r in p.runs).strip().lower()
                if txt.startswith(marker):
                    p._p.getparent().remove(p._p)
                    removed += 1
    for sh in doomed:
        delete_shape(sh)
    return len(doomed) + removed


# ── slides ──────────────────────────────────────────────────────────────────────────────────────

def _sldIdLst(prs):
    return prs.slides._sldIdLst


def delete_slide(prs, index: int) -> None:
    """Remove a slide by index, dropping its relationship from the presentation part."""
    lst = _sldIdLst(prs)
    ids = list(lst)
    sldId = ids[index]
    rId = sldId.get(qn('r:id'))
    prs.part.drop_rel(rId)
    lst.remove(sldId)


def delete_slides(prs, indices: Iterable[int]) -> None:
    """Remove several slides; indices are interpreted against the ORIGINAL ordering."""
    for i in sorted(set(indices), reverse=True):
        delete_slide(prs, i)


def index_of(prs, slide) -> int:
    """Current index of a slide object.

    Any clone or delete renumbers every slide after it, so callers that mutate the deck must hold slide
    OBJECTS and look their index up at the moment they need it — a list of indices captured up front
    goes stale the first time the deck changes length."""
    target = slide._element
    for i, s in enumerate(prs.slides):
        if s._element is target:
            return i
    raise ValueError('slide is no longer part of this presentation')


def delete_slide_obj(prs, slide) -> None:
    delete_slide(prs, index_of(prs, slide))


def move_slide(prs, old_index: int, new_index: int) -> None:
    lst = _sldIdLst(prs)
    ids = list(lst)
    el = ids[old_index]
    lst.remove(el)
    lst.insert(new_index, el)


def clone_slide(prs, source_index: int, insert_at: Optional[int] = None):
    """Duplicate a slide, including its pictures and native charts, and return the new slide.

    python-pptx exposes no slide-copy API. Copying the shape XML alone is not enough: the copied
    elements still carry the SOURCE slide's relationship ids, so every embedded part (image, chart,
    hyperlink) has to be re-registered on the new slide or PowerPoint refuses to open the file."""
    source = prs.slides[source_index]
    dest = prs.slides.add_slide(source.slide_layout)
    _ensure_unique_partname(prs, dest.part)

    # add_slide() materialises the layout's placeholders; the copied XML brings its own shapes.
    for shp in list(dest.shapes):
        delete_shape(shp)

    # Copy the slide's own BACKGROUND before its shapes. It is a sibling of spTree under cSld, not a
    # shape, so a shape-tree-only copy silently drops it — and on this deck the background IS the title
    # banner, so every clone lost its header bar and its white title text vanished against the white
    # page. Schema order matters: <p:bg> must precede <p:spTree>.
    src_cSld = source._element.find(qn('p:cSld'))
    dst_cSld = dest._element.find(qn('p:cSld'))
    src_bg = src_cSld.find(qn('p:bg')) if src_cSld is not None else None
    if src_bg is not None and dst_cSld is not None and dst_cSld.find(qn('p:bg')) is None:
        dst_cSld.insert(0, copy.deepcopy(src_bg))

    for el in source.shapes._spTree:
        if el.tag.endswith('}nvGrpSpPr') or el.tag.endswith('}grpSpPr'):
            continue
        dest.shapes._spTree.append(copy.deepcopy(el))

    _remap_rels(source, dest)

    if source.has_notes_slide:
        frame = source.notes_slide.notes_text_frame
        if frame is not None and frame.text.strip():
            from deck_layout import add_notes
            add_notes(dest, frame.text)

    if insert_at is not None:
        move_slide(prs, len(prs.slides) - 1, insert_at)
    return dest


def _ensure_unique_partname(prs, part) -> None:
    """Give a newly added slide a partname nothing else is using.

    python-pptx names a new slide `slide{len(sldIdLst)+1}.xml`. Once slides have been DELETED that
    counter no longer tracks the highest name in use, so the next add collides with a surviving slide
    — and the package then serialises two different parts under one name. The zip still passes a CRC
    check and python-pptx still reads it, so this fails silently right up until PowerPoint opens it."""
    from pptx.opc.packuri import PackURI
    used = {str(p.partname) for p in prs.part.package.iter_parts() if p is not part}
    if str(part.partname) not in used:
        return
    i = 1
    while f'/ppt/slides/slide{i}.xml' in used:
        i += 1
    part.partname = PackURI(f'/ppt/slides/slide{i}.xml')


def _remap_rels(source, dest) -> None:
    """Re-point every relationship reference in the copied XML at the new slide's own parts."""
    attrs = (qn('r:embed'), qn('r:id'), qn('r:link'), qn('r:pict'), qn('r:dm'), qn('r:lo'), qn('r:qs'), qn('r:cs'))
    remap: Dict[str, str] = {}
    # Walk the WHOLE slide, not just its shape tree: the background sits outside spTree and can carry a
    # picture fill of its own, which renders as "the picture can't be displayed" if its rId is left
    # pointing at the source slide's relationships.
    for el in dest._element.iter():
        for attr in attrs:
            rId = el.get(attr)
            if not rId:
                continue
            if rId in remap:
                el.set(attr, remap[rId])
                continue
            try:
                srel = source.part.rels[rId]
            except KeyError:
                continue
            if srel.is_external:
                new_id = dest.part.rels.get_or_add_ext_rel(srel.reltype, srel.target_ref)
            else:
                target = srel.target_part
                # A chart carries its own embedded workbook and colour/style parts; deep-copy the
                # part so edits to one slide's chart never leak into the slide it was cloned from.
                if srel.reltype.endswith('/chart'):
                    target = _clone_part(dest.part.package, target)
                new_id = dest.part.relate_to(target, srel.reltype)
            remap[rId] = new_id
            el.set(attr, new_id)


def _clone_part(package, part):
    """Deep-copy a part (used for charts, so cloned slides get independent chart data).

    Built through PartFactory, not Part, so the copy comes back as the registered subclass for its
    content type — a bare Part has no `.chart`, and the clone's chart would be unreadable."""
    from pptx.opc.package import PartFactory
    new_partname = _next_partname(package, part.partname)
    new_part = PartFactory(new_partname, part.content_type, package, part.blob)
    for rel in part.rels.values():
        if rel.is_external:
            new_part.rels.get_or_add_ext_rel(rel.reltype, rel.target_ref)
        else:
            new_part.relate_to(rel.target_part, rel.reltype)
    return new_part


def _next_partname(package, partname):
    from pptx.opc.packuri import PackURI
    base = str(partname)
    stem, _, ext = base.rpartition('.')
    m = re.match(r'(.*?)(\d+)$', stem)
    root = m.group(1) if m else stem
    used = {str(p.partname) for p in package.iter_parts()}
    i = 1
    while f'{root}{i}.{ext}' in used:
        i += 1
    return PackURI(f'{root}{i}.{ext}')


# ── tables ──────────────────────────────────────────────────────────────────────────────────────

def set_cell(table, r: int, c: int, text: str) -> None:
    """Write a cell, keeping the template's font/fill by editing the existing run in place."""
    cell = table.cell(r, c)
    tf = cell.text_frame
    if not tf.paragraphs:
        cell.text = text
        return
    lines = str(text).split('\n')
    proto = tf.paragraphs[0].runs[0]._r if tf.paragraphs[0].runs else None
    for i, line in enumerate(lines):
        if i < len(tf.paragraphs):
            # Reuse the template's own paragraph so its alignment and run formatting survive.
            set_text(cell, line, i)
        else:
            p = tf.add_paragraph()
            if proto is not None:
                p._p.append(copy.deepcopy(proto))
                p.runs[0].text = line
            else:
                p.text = line
    # Drop any surplus template paragraphs below what we just wrote.
    for p in list(tf.paragraphs)[len(lines):]:
        p._p.getparent().remove(p._p)


def delete_table_columns(table, col_indices: Iterable[int]) -> None:
    """Remove columns from a table and give their width back to the remaining ones."""
    tbl = table._tbl
    grid = tbl.find(qn('a:tblGrid'))
    cols = grid.findall(qn('a:gridCol'))
    doomed = sorted(set(col_indices), reverse=True)
    reclaimed = 0
    for ci in doomed:
        if ci >= len(cols):
            continue
        reclaimed += int(cols[ci].get('w') or 0)
        grid.remove(cols[ci])
        for tr in tbl.findall(qn('a:tr')):
            tcs = tr.findall(qn('a:tc'))
            if ci < len(tcs):
                tr.remove(tcs[ci])
    remaining = grid.findall(qn('a:gridCol'))
    if remaining and reclaimed:
        share = reclaimed // len(remaining)
        for gc in remaining:
            gc.set('w', str(int(gc.get('w') or 0) + share))


def delete_table_rows(table, row_indices: Iterable[int]) -> None:
    tbl = table._tbl
    rows = tbl.findall(qn('a:tr'))
    for ri in sorted(set(row_indices), reverse=True):
        if ri < len(rows):
            tbl.remove(rows[ri])


def set_column_weights(table, weights: List[float]) -> None:
    """Redistribute a table's total width across its columns by relative weight.

    The label column carries names several times longer than the figures beside it, but the template
    splits the width evenly. Giving the labels the room they need is what stops them wrapping, which
    is the real driver of table height."""
    cols = list(table.columns)
    if len(weights) != len(cols):
        return
    total = sum(Emu(c.width).inches for c in cols)
    wsum = sum(weights) or 1.0
    for c, w in zip(cols, weights):
        c.width = Emu(int(total * (w / wsum) * 914400))


def fit_table(table, max_height_in: float, min_font_pt: float = 7.0, header_ratio: float = 1.8) -> None:
    """Shrink a table's rows and type so the whole thing fits inside `max_height_in`.

    A template table is authored for a fixed number of rows. Growing it (one row per enabled lever)
    makes it overrun whatever sits below — on the interventions slide a 9-row table runs 4.1" into a
    talking-points card that starts at 3.2". PowerPoint also treats row height as a MINIMUM and
    auto-grows a row whose text does not fit, so the font and cell padding have to come down too or
    the table silently springs back to its old size.

    The header carries wrapped two-line labels, so it keeps `header_ratio` times a body row."""
    from pptx.util import Pt
    rows = list(table.rows)
    n = len(rows)
    if not n or max_height_in <= 0:
        return
    col_in = [Emu(c.width).inches for c in table.columns]
    pad_in = 0.04                                     # top + bottom cell padding
    # Deliberately pessimistic: under-estimating the wrap leaves rows taller than modelled and the
    # overlap silently returns, so err towards a wider glyph and a looser line.
    CHAR_W, LINE_H = 0.60, 1.32                       # Open Sans, em fractions

    def height_at(pt):
        """Total table height at a given point size, allowing for cells that WRAP.

        Row height is a MINIMUM in PowerPoint: a cell whose text needs two lines grows its row
        regardless of what we set. "Increased collection efficiency" wraps to three lines in a 1.3in
        column, so sizing rows without modelling the wrap leaves the table its original height and the
        overlap simply comes back."""
        total = 0.0
        for r in rows:
            lines = 1
            for ci, c in enumerate(r.cells):
                w = col_in[ci] if ci < len(col_in) else 1.0
                per_line = max(1, int(max(0.2, w - 0.12) / (pt / 72.0 * CHAR_W)))
                for para in c.text_frame.paragraphs:
                    txt = "".join(run.text for run in para.runs)
                    lines = max(lines, max(1, -(-len(txt) // per_line)))
            total += lines * (pt / 72.0) * LINE_H + pad_in
        return total

    pt = 11.0
    while pt > min_font_pt and height_at(pt) > max_height_in:
        pt -= 0.5
    pad = Emu(int((pad_in / 2) * 914400))
    for r in rows:
        r.height = Emu(int((height_at(pt) / n) * 914400))
        for c in r.cells:
            c.margin_top = c.margin_bottom = pad
            for p in c.text_frame.paragraphs:
                for run in p.runs:
                    cur = run.font.size.pt if run.font.size else 11.0
                    run.font.size = Pt(min(cur, pt))


def clone_table_row(table, src_index: int, insert_after: int):
    """Duplicate a row (formatting and all) so variable-length tables can grow."""
    tbl = table._tbl
    rows = tbl.findall(qn('a:tr'))
    new_tr = copy.deepcopy(rows[src_index])
    rows[insert_after].addnext(new_tr)
    return new_tr


# ── native charts ───────────────────────────────────────────────────────────────────────────────

_GROUP_TAGS = ('areaChart', 'barChart', 'lineChart', 'pieChart', 'scatterChart', 'radarChart',
               'doughnutChart', 'bubbleChart', 'area3DChart', 'bar3DChart', 'line3DChart')


def chart_groups(chart):
    """The chart's plot-group elements in document order (a combo chart has more than one)."""
    plotArea = chart._chartSpace.find(qn('c:chart')).find(qn('c:plotArea'))
    return [el for el in plotArea if any(el.tag == qn('c:' + t) for t in _GROUP_TAGS)]


def set_group_series_counts(chart, counts: List[int]) -> None:
    """Force each plot group to hold exactly N series, cloning or dropping `c:ser` elements.

    Needed before `replace_data` on a COMBO chart. replace_data walks the chart's `c:ser` elements in
    document order and hands them the new series one by one, appending any surplus to the LAST group —
    so on an area+line combo, extra area bands silently become extra lines. Sizing the groups first
    makes the mapping deterministic. Series indices are renumbered across the whole chart afterwards,
    since `c:idx`/`c:order` must stay unique and contiguous or PowerPoint rejects the file."""
    groups = chart_groups(chart)
    for grp, want in zip(groups, counts):
        sers = grp.findall(qn('c:ser'))
        if not sers:
            continue
        while len(sers) > want:
            grp.remove(sers.pop())
        while len(sers) < want:
            clone = copy.deepcopy(sers[-1])
            sers[-1].addnext(clone)
            sers.append(clone)
    i = 0
    for grp in groups:
        for ser in grp.findall(qn('c:ser')):
            for tag in ('c:idx', 'c:order'):
                el = ser.find(qn(tag))
                if el is not None:
                    el.set('val', str(i))
            i += 1


def set_chart(shape, categories: List[str], series: List[tuple], number_format: str = 'General') -> None:
    """Repopulate a native chart, keeping its type, colours and styling.

    `series` is a list of (name, values). replace_data() rewrites the chart's embedded workbook, so
    the result is a real, editable PowerPoint chart rather than a pasted image — but it only maps
    formatting onto series positionally, so a chart that gains series will style the new ones from
    the theme unless they are recoloured afterwards."""
    from pptx.chart.data import CategoryChartData
    cd = CategoryChartData()
    cd.categories = list(categories)
    for name, values in series:
        cd.add_series(name, [(None if v is None else float(v)) for v in values], number_format)
    shape.chart.replace_data(cd)


def _insert_ordered(parent, el, successors: tuple) -> None:
    """Insert `el` before the first of `successors` that is present, else append.

    Chart XML is sequence-validated: an element in the wrong slot makes PowerPoint declare the file
    damaged rather than ignore it, so new children cannot simply be appended."""
    for tag in successors:
        nxt = parent.find(qn(tag))
        if nxt is not None:
            nxt.addprevious(el)
            return
    parent.append(el)


def hide_zero_data_labels(chart, threshold: float = 0.5) -> None:
    """Drop the data label of every point that would print as 0.

    A stacked column whose segment is empty still labels it — a bare '0' floating on the axis. There
    is no "hide zeros" switch: PowerPoint records a hand-deleted label as `<c:dLbl><c:delete val="1"/>`
    for that point, which is what this writes. `threshold` is half of the last displayed digit, so
    values that merely ROUND to zero go too (a '000 chart labels 0.4 as '0')."""
    for plot in chart.plots:
        for ser in plot.series:
            for i, v in enumerate(ser.values):
                if v is None or abs(v) >= threshold:
                    continue
                dLbl = ser._element.get_or_add_dLbl(i)
                for child in list(dLbl):          # c:delete is exclusive with the rest of c:dLbl
                    if child.tag != qn('c:idx'):
                        dLbl.remove(child)
                dLbl.append(parse_xml('<c:delete %s val="1"/>' % nsdecls('c')))


# c:catAx children run in a fixed order; these are the two we insert and what may follow them.
_TICK_SKIP_SUCCESSORS = {
    'c:tickLblSkip': ('c:tickMarkSkip', 'c:noMultiLvlLbl', 'c:extLst'),
    'c:tickMarkSkip': ('c:noMultiLvlLbl', 'c:extLst'),
}


def set_category_label_step(chart, step: int) -> None:
    """Label (and tick) every `step`-th category, counting from the first — Excel's "interval between
    labels". `step <= 1` leaves the chart alone, so callers can pass a computed step unconditionally."""
    if step <= 1:
        return
    for ax in chart._chartSpace.iter(qn('c:catAx')):
        for tag, successors in _TICK_SKIP_SUCCESSORS.items():
            el = ax.find(qn(tag))
            if el is None:
                el = parse_xml('<%s %s val="1"/>' % (tag, nsdecls('c')))
                _insert_ordered(ax, el, successors)
            el.set('val', str(step))


def replace_shape_with_picture(slide, shape, image_stream) -> None:
    """Swap a placeholder shape (typically a template chart) for a rendered image at the same box."""
    left, top, width, height = shape.left, shape.top, shape.width, shape.height
    delete_shape(shape)
    slide.shapes.add_picture(image_stream, Emu(left), Emu(top), width=Emu(width), height=Emu(height))
