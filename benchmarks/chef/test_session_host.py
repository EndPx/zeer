import unittest
from unittest.mock import Mock, patch

from benchmarks.chef import session_host as host


class PreparedStateGuards(unittest.TestCase):
    def test_existing_scoped_container_is_preserved(self):
        output = Mock()
        output.exists.return_value = False
        with patch.object(host, 'OUT', output), patch.object(host.subprocess, 'run', return_value=Mock(returncode=0)) as execute:
            with self.assertRaisesRegex(RuntimeError, 'SESSION_PG_ALREADY_EXISTS'):
                host.main()
        self.assertEqual(execute.call_count, 1)
        output.mkdir.assert_not_called()

    def test_other_running_clone_prevents_shared_database_mount(self):
        output = Mock()
        output.exists.return_value = False
        mount = {'Source': '/opt/zeer-chef/20261014/data/pg'}
        def inspect(name):
            return {'State': {'Running': name == 'another-clone'},
                    'Mounts': [mount] if name in {'zeer-chef-pg', 'another-clone'} else []}
        def read(args):
            if args[0] == 'systemctl':
                return 'not-found'
            self.assertEqual(args, ['docker', 'ps', '--format', '{{.Names}}'])
            return 'another-clone'
        with patch.object(host, 'OUT', output), patch.object(host.subprocess, 'run', return_value=Mock(returncode=1)), \
                patch.object(host, 'inspect', side_effect=inspect), patch.object(host, 'run', side_effect=read):
            with self.assertRaisesRegex(RuntimeError, 'POSTGRES_SHARED_MOUNT_IN_USE'):
                host.main()
        output.mkdir.assert_not_called()


if __name__ == '__main__':
    unittest.main()
