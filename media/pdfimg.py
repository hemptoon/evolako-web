"""Product photos embedded in a manufacturer's datasheet PDF (often the cleanest renders they publish)."""
import io
from PIL import Image


def pdf_images(body, min_side=500):
    """Yield (xref, PIL image with alpha if the PDF has a soft mask) for every large embedded image."""
    import fitz  # PyMuPDF
    doc = fitz.open(stream=body, filetype='pdf')
    seen = set()
    for page in doc:
        for info in page.get_images(full=True):
            xref, smask = info[0], info[1]
            if xref in seen:
                continue
            seen.add(xref)
            try:
                pix = fitz.Pixmap(doc, xref)
                if min(pix.width, pix.height) < min_side:
                    continue
                if pix.n - pix.alpha >= 4:          # CMYK → RGB
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                if smask:
                    pix = fitz.Pixmap(pix, fitz.Pixmap(doc, smask))
                img = Image.open(io.BytesIO(pix.tobytes('png')))
                img.load()
                yield xref, img
            except Exception:
                continue


def pdf_image(body, xref):
    for x, img in pdf_images(body, min_side=1):
        if x == xref:
            return img
    raise KeyError(xref)
