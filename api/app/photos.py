"""Report 사진 처리 (TBD-09: JPG·PNG, 장당 5MB 이하, 저장 시 GPS 등 촬영 정보 제거)."""

import io
import re
import uuid
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from .config import settings

FILE_NAME_RE = re.compile(r"^[0-9a-f]{32}\.(jpg|png)$")
_FORMATS = {"JPEG": ("jpg", "image/jpeg"), "PNG": ("png", "image/png")}


class PhotoError(ValueError):
    pass


def upload_dir() -> Path:
    d = Path(settings.upload_dir)
    d.mkdir(parents=True, exist_ok=True)
    return d


def clean_image(data: bytes) -> tuple[bytes, str, str]:
    """형식·크기를 검사하고, EXIF(GPS 포함)를 뺀 새 이미지로 다시 저장한다.

    반환: (저장할 바이트, 확장자, content-type)
    """
    if len(data) > settings.photo_max_bytes:
        raise PhotoError("사진은 5MB 이하만 첨부할 수 있어요.")
    try:
        with Image.open(io.BytesIO(data)) as img:
            fmt = img.format
            if fmt not in _FORMATS:
                raise PhotoError("JPG 또는 PNG 사진만 첨부할 수 있어요.")
            # 휴대폰 사진의 회전 정보는 픽셀에 반영한 뒤 메타데이터를 버린다
            img = ImageOps.exif_transpose(img)
            img.load()
    except UnidentifiedImageError:
        raise PhotoError("JPG 또는 PNG 사진만 첨부할 수 있어요.")

    img.info.clear()  # EXIF·텍스트 청크 등 원본 메타데이터를 남기지 않는다
    ext, content_type = _FORMATS[fmt]
    out = io.BytesIO()
    if fmt == "JPEG":
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        img.save(out, format="JPEG", quality=90)
    else:
        img.save(out, format="PNG")
    return out.getvalue(), ext, content_type


def save_file(content: bytes, ext: str) -> str:
    name = f"{uuid.uuid4().hex}.{ext}"
    (upload_dir() / name).write_bytes(content)
    return name


def delete_file(name: str) -> None:
    try:
        (upload_dir() / name).unlink()
    except FileNotFoundError:
        pass
