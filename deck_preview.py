"""Render the exact exported PowerPoint in an isolated temporary office profile.

No uploaded documents, shared artifact cache, persistent download links or external
rendering service. The caller receives images plus the original bytes for download.
"""
import base64
import io
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import threading
from contextlib import contextmanager

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from pptx import Presentation

_slot = threading.BoundedSemaphore(1)
MAX_SLIDES = 160
MAX_PPTX_BYTES = 30 * 1024 * 1024
MAX_RESPONSE_BYTES = 60 * 1024 * 1024
PREVIEW_CHUNK_BYTES = 64 * 1024


def preview_response(preview):
    """Do not buffer a large preview as a Content-Length JSON response.

    Autoscale's Cloud Run HTTP/1 limit is 32 MiB for non-streamed responses.
    Keep the existing JSON contract and exact PowerPoint bytes, but yield bounded
    chunks so the gateway can transfer it without that buffered-response limit.
    No persistent cache or publicly accessible artifact URL is introduced.
    """
    def chunks():
        encoder = json.JSONEncoder(ensure_ascii=False, allow_nan=False, separators=(',', ':'))
        for part in encoder.iterencode(preview):
            encoded = part.encode('utf-8')
            for offset in range(0, len(encoded), PREVIEW_CHUNK_BYTES):
                yield encoded[offset:offset + PREVIEW_CHUNK_BYTES]
    return StreamingResponse(chunks(), media_type="application/json",
                             headers={"Cache-Control": "private, no-store",
                                      "X-Accel-Buffering": "no"})


@contextmanager
def preview_slot():
    if not _slot.acquire(blocking=False):
        raise HTTPException(429, "Another slide preview is being generated. Please retry shortly.")
    try:
        yield
    finally:
        _slot.release()


def slide_titles(prs):
    def text_shapes(shapes):
        for shape in shapes:
            if shape.has_text_frame:
                text = " ".join(shape.text.split())
                if text:
                    yield shape, text
            if hasattr(shape, "shapes"):
                yield from text_shapes(shape.shapes)

    titles = []
    for index, slide in enumerate(prs.slides):
        title = slide.shapes.title
        if title is not None and title.text.strip():
            text = " ".join(title.text.split())
        else:
            candidates = [(shape, text) for shape, text in text_shapes(slide.shapes)
                          if not text.isnumeric() and shape.top < prs.slide_height * .8]
            candidates.sort(key=lambda item: (item[0].top, item[0].left))
            text = candidates[0][1] if candidates else f"Slide {index + 1}"
        titles.append(text[:240])
    return titles


def preview_deck(pptx_bytes: bytes):
    executable = shutil.which("libreoffice")
    if not executable:
        raise HTTPException(503, "Slide rendering is unavailable: LibreOffice is not installed.")
    if len(pptx_bytes) > MAX_PPTX_BYTES:
        raise HTTPException(413, "This presentation is too large to preview.")
    prs = Presentation(io.BytesIO(pptx_bytes))
    if not 0 < len(prs.slides) <= MAX_SLIDES:
        raise HTTPException(413, f"Preview supports 1–{MAX_SLIDES} slides.")
    titles = slide_titles(prs)
    with tempfile.TemporaryDirectory(prefix="wss-deck-") as directory:
        root = Path(directory)
        source = root / "deck.pptx"
        source.write_bytes(pptx_bytes)
        # Distinct profile avoids office process reuse across requests. Never invoke a shell.
        command = [executable, f"-env:UserInstallation={(root / 'profile').as_uri()}",
                   "--headless", "--nologo", "--nodefault", "--nofirststartwizard",
                   "--convert-to", "pdf:impress_pdf_Export", "--outdir", str(root), str(source)]
        process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   start_new_session=True)
        try:
            code = process.wait(timeout=180)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise HTTPException(504, "Slide rendering timed out. Please retry.")
        pdf = root / "deck.pdf"
        if code or not pdf.is_file():
            raise HTTPException(503, "PowerPoint preview rendering failed. Please retry.")
        import pymupdf
        slides = []
        used = (len(pptx_bytes) * 4 // 3)
        with pymupdf.open(pdf) as document:
            if len(document) != len(titles):
                raise HTTPException(503, "Rendered slide count differs from the PowerPoint. Preview was not returned.")
            for index, page in enumerate(document):
                image = page.get_pixmap(matrix=pymupdf.Matrix(1440 / page.rect.width, 1440 / page.rect.width), alpha=False)
                encoded = base64.b64encode(image.tobytes("png")).decode("ascii")
                used += len(encoded)
                if used > MAX_RESPONSE_BYTES:
                    raise HTTPException(413, "Rendered presentation is too large to preview.")
                slides.append({"number": index + 1, "title": titles[index],
                               "image": f"data:image/png;base64,{encoded}",
                               "width": image.width, "height": image.height})
        return {"filename": "wss_slide_deck.pptx", "pptx_base64": base64.b64encode(pptx_bytes).decode("ascii"),
                "slides": slides, "rendered_with": "LibreOffice"}
