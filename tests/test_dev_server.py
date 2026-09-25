import unittest
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.request import urlopen

from tools.serve import PUBLIC_DIR, TIDKopruHandler, startup_message


class DevelopmentServerTests(unittest.TestCase):
    def test_startup_message_is_safe_for_windows_console_encoding(self):
        message = startup_message(8000)
        self.assertTrue(message.isascii())
        self.assertIn('http://localhost:8000', message)
    def test_module_files_are_served_with_a_javascript_mime_type(self):
        server = ThreadingHTTPServer(
            ('127.0.0.1', 0),
            partial(TIDKopruHandler, directory=str(PUBLIC_DIR)),
        )
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with urlopen(f'http://127.0.0.1:{server.server_port}/app.mjs') as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.headers.get_content_type(), 'application/javascript')
                self.assertIn(b"import { SignAvatar }", response.read(500))
        finally:
            server.shutdown()
            thread.join(timeout=2)
            server.server_close()

    def test_local_server_can_serve_a_probe_directory(self):
        from tools.serve import create_server

        with TemporaryDirectory() as temporary_directory:
            probe_directory = Path(temporary_directory)
            module = probe_directory / "main.mjs"
            module.write_text("export const ready = true;", encoding="utf-8")
            server = create_server(0, directory=probe_directory)
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                with urlopen(f'http://127.0.0.1:{server.server_port}/main.mjs') as response:
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.headers.get_content_type(), 'application/javascript')
                    self.assertEqual(response.read(), b"export const ready = true;")
            finally:
                server.shutdown()
                thread.join(timeout=2)
                server.server_close()

    def test_manifest_is_served_with_its_web_manifest_mime_type(self):
        server = ThreadingHTTPServer(
            ('127.0.0.1', 0),
            partial(TIDKopruHandler, directory=str(PUBLIC_DIR)),
        )
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with urlopen(f'http://127.0.0.1:{server.server_port}/manifest.webmanifest') as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.headers.get_content_type(), 'application/manifest+json')
        finally:
            server.shutdown()
            thread.join(timeout=2)
            server.server_close()

    def test_local_server_binds_only_to_loopback(self):
        from tools.serve import create_server

        server = create_server(0)
        try:
            self.assertEqual(server.server_address[0], '127.0.0.1')
        finally:
            server.server_close()


if __name__ == '__main__':
    unittest.main()

