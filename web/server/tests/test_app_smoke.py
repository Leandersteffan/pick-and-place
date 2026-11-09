import pytest

from pnp_server import app as app_module
from pnp_server.version import __version__, compute_pipeline_version


def test_app_title_and_version():
    assert app_module.app.title == "pick-and-place backend"
    assert app_module.app.version == __version__


def test_check_host_accepts_loopback_or_unset():
    app_module.check_host({})
    app_module.check_host({"PNP_HOST": "127.0.0.1"})


@pytest.mark.parametrize("host", ["0.0.0.0", "localhost", "192.168.1.5", ""])
def test_check_host_refuses_other_hosts(host):
    with pytest.raises(RuntimeError):
        app_module.check_host({"PNP_HOST": host})


def test_pipeline_version_is_none_or_short_hash():
    version = compute_pipeline_version()
    assert version is None or (isinstance(version, str) and len(version.removesuffix("+dirty")) >= 4)
