import base64

from brain.documents.pdf_text import PdfTextRequest, read_pdf_text

def one_page_pdf(text: str) -> bytes:
    """The smallest valid one-page PDF saying `text`, with its cross-reference table."""
    stream = f"BT /F1 12 Tf 10 50 Td ({text}) Tj ET".encode()
    objects = [
        b"<</Type/Catalog/Pages 2 0 R>>",
        b"<</Type/Pages/Kids[3 0 R]/Count 1>>",
        b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
        b"<</Length " + str(len(stream)).encode() + b">>stream\n" + stream + b"\nendstream",
        b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    ]
    out = b"%PDF-1.4\n"
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj".encode() + body + b"endobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer<</Size {len(objects) + 1}/Root 1 0 R>>\nstartxref\n{xref}\n%%EOF".encode()
    return out


PDF = one_page_pdf("Refunds take 5 days.")


def test_a_pdfs_text_is_read():
    answer = read_pdf_text(PdfTextRequest(data=base64.b64encode(PDF).decode()))
    assert answer["kind"] == "ok" and "Refunds take 5 days." in answer["text"]


def test_a_damaged_file_is_unreadable_and_nothing_is_said_about_it():
    assert read_pdf_text(PdfTextRequest(data=base64.b64encode(b"not a pdf").decode())) == {"kind": "failed", "reason": "unreadable"}
    assert read_pdf_text(PdfTextRequest(data="%%%")) == {"kind": "failed", "reason": "unreadable"}
