"""완성된 노트를 Obsidian Vault에 저장한다."""

from __future__ import annotations

import os
import re
from pathlib import Path

_INVALID_FILENAME_CHARS = re.compile(r'[\\/:*?"<>|#^\[\]]')


def sanitize_filename(title: str, max_length: int = 120) -> str:
    """Obsidian/OS에서 문제가 되는 문자를 제거한 파일명을 만든다."""
    name = _INVALID_FILENAME_CHARS.sub("", title).strip().rstrip(".")
    name = re.sub(r"\s+", " ", name)
    return name[:max_length] or "untitled"


def resolve_vault_path(vault: str | Path | None) -> Path:
    """CLI 인자 → OBSIDIAN_VAULT_PATH 환경 변수 순으로 Vault 경로를 결정한다."""
    path = vault or os.environ.get("OBSIDIAN_VAULT_PATH")
    if not path:
        raise ValueError(
            "Obsidian Vault 경로가 필요합니다. --vault 옵션 또는 "
            "OBSIDIAN_VAULT_PATH 환경 변수를 설정하세요."
        )
    vault_path = Path(path).expanduser()
    if not vault_path.is_dir():
        raise ValueError(f"Vault 디렉터리를 찾을 수 없습니다: {vault_path}")
    return vault_path


def save_note(
    content: str,
    title: str,
    vault: str | Path | None = None,
    subfolder: str = "YouTube",
) -> Path:
    """노트를 Vault의 subfolder에 저장하고 경로를 돌려준다.

    같은 이름의 파일이 있으면 덮어쓰지 않고 ` (2)`, ` (3)`… 을 붙인다.
    """
    vault_path = resolve_vault_path(vault)
    folder = vault_path / subfolder
    folder.mkdir(parents=True, exist_ok=True)

    base = sanitize_filename(title)
    note_path = folder / f"{base}.md"
    counter = 2
    while note_path.exists():
        note_path = folder / f"{base} ({counter}).md"
        counter += 1

    note_path.write_text(content, encoding="utf-8")
    return note_path
