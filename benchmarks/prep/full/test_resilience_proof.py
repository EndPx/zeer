"""Admission guards for the Docker-host source-outage rehearsal."""

import argparse
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import resilience_proof as proof


class ResilienceGuardTests(unittest.TestCase):
    def test_missing_authorization_or_wrong_duration_does_not_touch_endpoints(self):
        for allowed, duration in [(False, 600), (True, 601)]:
            args = argparse.Namespace(allow_disposable_regtest_mutation=allowed, duration_seconds=duration)
            with self.subTest(allowed=allowed, duration=duration), patch.object(proof, "PrivateEndpoint") as endpoint:
                with self.assertRaises(ValueError):
                    proof.execute(args)
                endpoint.assert_not_called()

    def test_container_label_and_public_port_rejected(self):
        for label, ports in [("another-project", {}), (proof.LABEL, {"18232/tcp": [{"HostPort": "18232"}]})]:
            fake = {"Config": {"Labels": {"zeer.benchmark": label}}, "HostConfig": {"PortBindings": ports}}
            with self.subTest(label=label, ports=ports), patch.object(proof, "docker", return_value=json.dumps([fake])) as command:
                with self.assertRaises(ValueError):
                    proof.container(proof.NODE)
                command.assert_called_once_with("inspect", proof.NODE)

    def test_labelled_private_container_is_accepted(self):
        fake = {"Config": {"Labels": {"zeer.benchmark": proof.LABEL}}, "HostConfig": {"PortBindings": {}}}
        with patch.object(proof, "docker", return_value=json.dumps([fake])):
            self.assertEqual(proof.container(proof.NODE), fake)


if __name__ == "__main__":
    unittest.main()
