import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


PUBLIC_DIR = Path(__file__).resolve().parents[1] / 'public'


class TIDKopruHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.mjs': 'application/javascript',
        '.webmanifest': 'application/manifest+json',
    }


def startup_message(port):
    return f'TID Kopru local preview: http://localhost:{port}'


def create_server(port=8000, directory=PUBLIC_DIR):
    handler = partial(TIDKopruHandler, directory=str(Path(directory).resolve()))
    return ThreadingHTTPServer(('127.0.0.1', port), handler)


def main():
    parser = argparse.ArgumentParser(description='Serve a TID Kopru app or probe on this computer only.')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--directory', type=Path, default=PUBLIC_DIR)
    args = parser.parse_args()

    server = create_server(args.port, args.directory)
    print(startup_message(args.port))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nLocal server stopped.')
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
