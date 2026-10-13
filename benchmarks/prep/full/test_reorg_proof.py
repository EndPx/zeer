"""Safety checks for the administrative Regtest reorg harness."""

import unittest
from unittest.mock import patch

from benchmarks.prep.full.reorg_proof import (
    PrivateEndpoint, REGTEST_GENESIS, guard_source, private_ip,
)


class Source:
    def __init__(self, chain="test", genesis=REGTEST_GENESIS, peers=None, height=1026):
        self.values = {
            "getblockchaininfo": {"chain": chain, "blocks": height},
            "getblockhash": genesis,
            "getpeerinfo": peers or [],
        }
        self.calls = []

    def rpc(self, method, params):
        self.calls.append(method)
        return self.values[method]


class ReorgSafetyTests(unittest.TestCase):
    def test_accepts_only_private_or_loopback_ips(self):
        for address in ("127.0.0.1", "::1", "10.0.1.2", "172.20.0.2", "192.168.0.2", "fd12::1"):
            self.assertTrue(private_ip(address))
        for address in ("8.8.8.8", "0.0.0.0", "169.254.169.254", "192.0.2.1", "224.0.0.1", "::", "fe80::1"):
            self.assertFalse(private_ip(address))

    def test_url_credentials_paths_and_fragments_rejected(self):
        for url in ("https://localhost", "http://a:b@localhost", "http://localhost/rpc", "http://localhost#fragment"):
            with self.assertRaises(ValueError):
                PrivateEndpoint(url)

    def test_public_resolution_fails_before_http_connection(self):
        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("8.8.8.8", 80))]), \
                patch("http.client.HTTPConnection") as connection:
            with self.assertRaisesRegex(ValueError, "private_addresses"):
                PrivateEndpoint("http://example.org").request("/", {})
            connection.assert_not_called()

    def test_wrong_chain_genesis_peer_or_height_refused(self):
        sources = (Source(chain="main"), Source(genesis="00" * 32),
                   Source(peers=[{"id": 1}]), Source(height=1027))
        for source in sources:
            with self.assertRaises(ValueError):
                guard_source(source, 1026)
            self.assertNotIn("generate", source.calls)
            self.assertNotIn("invalidateblock", source.calls)

    def test_regtest_alias_with_exact_genesis_and_no_peers_accepted(self):
        source = Source()
        self.assertEqual(guard_source(source, 1026)["blocks"], 1026)
        self.assertEqual(source.calls, ["getblockchaininfo", "getblockhash", "getpeerinfo"])


if __name__ == "__main__":
    unittest.main()
