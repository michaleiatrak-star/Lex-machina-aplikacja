"""Opens a password-protected PDF or Office document (DOCX, XLSX) with the password the user
typed, on this computer, and returns the same document without the encryption.

stdin: {"kind": "pdf" | "office", "dataBase64": ..., "password": ...}
stdout: {"dataBase64": ...}
Errors on stderr (exit 2): DOCUMENT_PASSWORD_INVALID, DOCUMENT_NOT_ENCRYPTED,
DOCUMENT_DECRYPT_UNSUPPORTED, DOCUMENT_DECRYPT_FAILED.
The password is never written anywhere.
"""
import base64
import io
import json
import sys

MAX_INPUT_BYTES = 512 * 1024 * 1024


def fail(code):
    sys.stderr.write(code + "\n")
    raise SystemExit(2)


def decrypt_pdf(data, password):
    try:
        import pymupdf as fitz  # the old "fitz" name prints a warning on stdout
    except ImportError:
        import fitz

    doc = fitz.open(stream=data, filetype="pdf")
    try:
        if not doc.needs_pass:
            fail("DOCUMENT_NOT_ENCRYPTED")
        if not doc.authenticate(password):
            fail("DOCUMENT_PASSWORD_INVALID")
        return doc.tobytes(encryption=fitz.PDF_ENCRYPT_NONE, garbage=0)
    finally:
        doc.close()


def decrypt_office(data, password):
    try:
        import msoffcrypto
        from msoffcrypto.exceptions import DecryptionError, FileFormatError, InvalidKeyError
    except ImportError:
        fail("DOCUMENT_DECRYPT_UNSUPPORTED")
    try:
        office = msoffcrypto.OfficeFile(io.BytesIO(data))
        if not office.is_encrypted():
            fail("DOCUMENT_NOT_ENCRYPTED")
        if not password:
            fail("DOCUMENT_PASSWORD_INVALID")
        office.load_key(password=password, verify_password=True)
        out = io.BytesIO()
        office.decrypt(out)
        return out.getvalue()
    except (InvalidKeyError, DecryptionError):
        fail("DOCUMENT_PASSWORD_INVALID")
    except FileFormatError:
        fail("DOCUMENT_DECRYPT_UNSUPPORTED")


def main():
    request = json.loads(sys.stdin.buffer.read(MAX_INPUT_BYTES * 2).decode("utf-8"))
    kind = request.get("kind")
    password = request.get("password")
    # An empty password only asks whether the file needs one (a PDF with an owner password
    # only opens without it).
    if not isinstance(password, str) or len(password) > 1024:
        fail("DOCUMENT_PASSWORD_INVALID")
    data = base64.b64decode(request.get("dataBase64", ""), validate=True)
    if not data or len(data) > MAX_INPUT_BYTES:
        fail("DOCUMENT_DECRYPT_FAILED")
    if kind == "pdf":
        result = decrypt_pdf(data, password)
    elif kind == "office":
        result = decrypt_office(data, password)
    else:
        fail("DOCUMENT_DECRYPT_UNSUPPORTED")
    sys.stdout.write(json.dumps({"dataBase64": base64.b64encode(result).decode("ascii")}))


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write("DOCUMENT_DECRYPT_FAILED:%s\n" % exc.__class__.__name__)
        raise SystemExit(2)
