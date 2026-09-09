"""Coffee Flipper pinball minigame: static-serving and cross-cutting checks.

Mirrors the conventions in test_frontend.py. Does not modify or duplicate its
assertions — test_frontend_has_no_external_resources already covers these new
files too, since it walks the whole frontend directory.
"""

import re

import pytest

from brewops.db.connection import connect
from brewops.db.schema import init_db

from asgi_client import request


@pytest.fixture
def db(tmp_path, monkeypatch):
    path = tmp_path / "static-test.db"
    monkeypatch.setenv("BREWOPS_DB", str(path))
    conn = connect(path)
    init_db(conn)
    conn.commit()
    yield conn
    conn.close()


def get_app():
    from brewops.api.main import app
    return app


def test_pinball_scripts_served(db):
    table_js = request(get_app(), "GET", "/pinball-table.js")
    assert table_js.status == 200
    assert "PINBALL_WALLS" in table_js.text

    game_js = request(get_app(), "GET", "/pinball.js")
    assert game_js.status == 200
    assert "pinballFrame" in game_js.text


def test_index_has_pinball_markup(db):
    r = request(get_app(), "GET", "/")
    assert r.status == 200
    assert 'id="start-pinball-btn"' in r.text
    assert 'id="pinball-view"' in r.text
    assert 'id="pinball-canvas"' in r.text
    assert 'id="pinball-switch-back-btn"' in r.text
    # hidden by default in the static markup served without JS
    assert re.search(r'<section id="pinball-view" hidden', r.text)


def test_pinball_loop_has_teardown():
    from brewops.api.main import FRONTEND_DIR
    pinball_js = (FRONTEND_DIR / "pinball.js").read_text(encoding="utf-8")
    assert "cancelAnimationFrame" in pinball_js
    assert "removeEventListener" in pinball_js


def test_i18n_dictionaries_have_matching_keys():
    """Every key in TRANSLATIONS.en must also exist in TRANSLATIONS.zh, and
    vice versa — a heuristic, structure-coupled parity check (not a real JS
    parser), reliable here because both blocks are flat and one-key-per-line.
    """
    from brewops.api.main import FRONTEND_DIR
    content = (FRONTEND_DIR / "i18n.js").read_text(encoding="utf-8")

    en_match = re.search(r"en:\s*\{(.*?)\n\s*\},\s*\n\s*zh:\s*\{", content, re.S)
    zh_match = re.search(r"zh:\s*\{(.*?)\n\s*\},\s*\n\};", content, re.S)
    assert en_match and zh_match, "could not locate TRANSLATIONS.en/.zh blocks in i18n.js"

    en_keys = set(re.findall(r"^\s*(\w+):", en_match.group(1), re.M))
    zh_keys = set(re.findall(r"^\s*(\w+):", zh_match.group(1), re.M))

    assert en_keys, "no keys found in TRANSLATIONS.en — regex likely out of sync with i18n.js"
    assert en_keys == zh_keys, f"translation key mismatch: {en_keys.symmetric_difference(zh_keys)}"

    # every new pinball-facing key must actually be present, not just symmetric
    for key in (
        "btn_start_pinball",
        "btn_switch_back",
        "pinball_score_label",
        "pinball_lives_label",
        "pinball_hint",
        "pinball_game_over",
        "pinball_final_score",
        "pinball_new_game",
    ):
        assert key in en_keys, key
