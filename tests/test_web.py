"""The web build: both outputs assemble, carry the library, and stay honest
about what the deployed page is allowed to load."""

import pathlib
import re
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "web" / "src"


@pytest.fixture(scope="module")
def dist(tmp_path_factory):
    out = tmp_path_factory.mktemp("dist")
    r = subprocess.run([sys.executable, "tools/build_web.py", "--dist", str(out)],
                       cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return out


def test_sources_exist():
    for name in ("engine.js", "library.js", "app.js", "app.css", "index.html"):
        assert (SRC / name).exists(), name


def test_single_file_build_exists():
    single = ROOT / "web" / "biomotif.html"
    assert single.exists(), "run tools/build_web.py"
    text = single.read_text()
    assert "<title>Biomotif</title>" in text
    assert "defmotif" in text, "the .mtf library must be embedded"


def test_dist_has_three_files(dist):
    names = sorted(p.name for p in dist.iterdir())
    assert len(names) == 3
    assert "index.html" in names
    assert any(n.endswith(".css") for n in names)
    assert any(n.endswith(".js") for n in names)


def test_dist_index_is_a_whole_document(dist):
    html = (dist / "index.html").read_text()
    for tag in ("<!doctype html>", "<html lang=\"en\">", "<head>", "</head>", "<body>", "</body>", "</html>"):
        assert tag in html, tag
    assert html.index("<body>") < html.index("masthead") < html.index("</body>")


def test_dist_has_no_inline_script_or_style(dist):
    """The deployed CSP is script-src 'self' with no unsafe-inline, so an
    inline block would silently fail to run in production."""
    html = (dist / "index.html").read_text()
    assert "<script type=\"module\">" not in html
    assert "<style>" not in html
    assert re.search(r'<script type="module" src="/biomotif\.[0-9a-f]{8}\.js">', html)
    assert re.search(r'<link rel="stylesheet" href="/biomotif\.[0-9a-f]{8}\.css">', html)


def test_dist_asset_names_are_content_hashes(dist):
    import hashlib
    for asset in dist.iterdir():
        if asset.name == "index.html":
            continue
        want = hashlib.sha256(asset.read_text().encode()).hexdigest()[:8]
        assert want in asset.name, f"{asset.name} does not match its content hash"


def test_library_is_embedded_verbatim(dist):
    js = next(p for p in dist.iterdir() if p.suffix == ".js").read_text()
    for name in ("prokaryote.mtf", "eukaryote.mtf", "plant.mtf", "rna.mtf",
                 "protein.mtf", "tags.mtf", "restriction.mtf"):
        assert name in js, name
    assert "sigma70-promoter" in js
    assert "EcoRI" in js


def test_example_sequences_are_embedded(dist):
    js = next(p for p in dist.iterdir() if p.suffix == ".js").read_text()
    for key in ("operon", "plasmid", "gene", "utr3", "proteins"):
        assert f'"{key}"' in js, key


def test_bundle_has_no_leftover_module_syntax(dist):
    """The bundle is concatenated, not linked, so an import or export that
    survived would throw on load."""
    js = next(p for p in dist.iterdir() if p.suffix == ".js").read_text()
    assert not re.search(r"^\s*import\s+.*from\s+\"\./", js, re.M)
    assert not re.search(r"^export\s+", js, re.M)


def test_bundle_has_no_duplicate_top_level_names(dist):
    js = next(p for p in dist.iterdir() if p.suffix == ".js").read_text()
    names = re.findall(r"^(?:function|class|const|let)\s+(\w+)", js, re.M)
    dupes = {n for n in names if names.count(n) > 1}
    assert not dupes, f"duplicate top-level declarations: {sorted(dupes)}"


def test_css_hides_elements_marked_hidden():
    """A class that sets display outranks the user agent's [hidden] rule."""
    css = (SRC / "app.css").read_text()
    assert re.search(r"\[hidden\]\s*\{\s*display:\s*none\s*!important", css)


def test_databases_module_is_bundled(dist):
    js = next(p for p in dist.iterdir() if p.suffix == ".js").read_text()
    for host in ("eutils.ncbi.nlm.nih.gov", "rest.ensembl.org",
                 "www.ebi.ac.uk", "rest.uniprot.org"):
        assert host in js, host


def test_ncbi_requests_identify_themselves():
    """NCBI asks that automated clients send a tool name."""
    src = (SRC / "databases.js").read_text()
    assert 'TOOL = "tool=biomotif"' in src
    # A URL may be built across several concatenated lines, so check the whole
    # statement rather than one template literal.
    for stmt in re.findall(r"\$\{NCBI\}/.*?;", src, re.S):
        assert "${TOOL}" in stmt, stmt


def test_retrieval_has_a_size_ceiling():
    """A whole chromosome would be held in memory and searched with matchers
    far too slow for it, so the fetch is refused with an explanation."""
    src = (SRC / "databases.js").read_text()
    assert "MAX_BASES" in src
    assert "Fetch a region instead" in src


def test_rnacentral_is_documented_as_unreachable():
    """It has no CORS headers, so it cannot be called from a page with no
    server behind it. Leaving that unsaid invites someone to re-add it."""
    src = (SRC / "databases.js").read_text()
    assert "RNAcentral" in src
    assert "Access-Control-Allow-Origin" in src


def test_deployment_files_are_present():
    for path in ("Dockerfile", "fly.toml", "deploy/nginx.conf", "deploy/security-headers.conf",
                 ".dockerignore"):
        assert (ROOT / path).exists(), path


def test_nginx_serves_health_and_the_page():
    conf = (ROOT / "deploy" / "nginx.conf").read_text()
    assert "location = /healthz" in conf
    assert "try_files $uri $uri/ /index.html" in conf
    assert "gzip on" in conf


def csp() -> str:
    headers = (ROOT / "deploy" / "security-headers.conf").read_text()
    return re.search(r'Content-Security-Policy "([^"]+)"', headers).group(1)


def test_csp_forbids_inline_script():
    policy = csp()
    assert "script-src 'self'" in policy
    assert "'unsafe-inline'" not in policy.split("style-src")[0], "no unsafe-inline for scripts"
    assert "'unsafe-eval'" not in policy
    assert "frame-ancestors 'none'" in policy


def test_csp_connect_src_lists_exactly_the_databases():
    """The page may reach the four sequence databases and nothing else — not
    even its own origin, so a loaded sequence cannot be posted back."""
    from_csp = re.search(r"connect-src ([^;]+);", csp()).group(1).split()
    assert sorted(from_csp) == sorted([
        "https://eutils.ncbi.nlm.nih.gov",
        "https://rest.ensembl.org",
        "https://www.ebi.ac.uk",
        "https://rest.uniprot.org",
    ])
    assert "'self'" not in from_csp
    assert "*" not in from_csp


def test_every_fetched_host_is_allowed_by_the_csp():
    """A host used by databases.js but missing from connect-src fails silently
    in production while working in development, where no policy applies."""
    src = (SRC / "databases.js").read_text()
    used = set(re.findall(r'"(https://[a-z0-9.-]+)"', src))
    allowed = set(re.search(r"connect-src ([^;]+);", csp()).group(1).split())
    assert used <= allowed, f"not in connect-src: {sorted(used - allowed)}"


def test_fly_config_matches_the_dockerfile_port():
    fly = (ROOT / "fly.toml").read_text()
    assert "internal_port = 80" in fly
    assert "force_https = true" in fly
    assert "path = '/healthz'" in fly
    assert "primary_region = 'yyz'" in fly


def test_dockerfile_builds_the_dist_and_serves_it():
    docker = (ROOT / "Dockerfile").read_text()
    assert "tools/build_web.py --dist web/dist" in docker
    assert "nginx" in docker
    assert "COPY --from=build /app/web/dist /usr/share/nginx/html" in docker
