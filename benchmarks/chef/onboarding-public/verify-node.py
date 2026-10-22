"""Read-only configured-Zebra cross-check of one completed public phase."""
from pathlib import Path
import sys, json, urllib.request, urllib.parse, base64, ipaddress, time

proof_path = Path(sys.argv[1]).resolve()
proof = json.loads(proof_path.read_text())
assert proof['status'] == 'PASS'
url = Path('/opt/zeer-testnet/live-20261018/source-url').read_text().strip()
parsed = urllib.parse.urlsplit(url)
assert parsed.scheme == 'http' and ipaddress.ip_address(parsed.hostname).is_private
assert not any([parsed.username, parsed.password, parsed.query, parsed.fragment])

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
auth = 'Basic ' + base64.b64encode(Path('/opt/zeer-testnet/data/.cookie').read_text().strip().encode()).decode()

def rpc(method, params):
    request = urllib.request.Request(url, data=json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}).encode(), headers={'Authorization': auth, 'Content-Type': 'application/json'})
    with opener.open(request, timeout=10) as response:
        body = json.load(response)
    assert not body.get('error')
    return body['result']

result = {'status': 'RUNNING', 'checked_at_unix': time.time(), 'consensus_validation_performed': False, 'observations': []}
try:
    expected = proof['oracle']['expected']
    for row in expected:
        block_hash = rpc('getblockhash', [row['height']])
        assert block_hash == row['hash']
        block = rpc('getblock', [block_hash, 1])
        assert block['height'] == row['height'] and block['time'] == int(row['time'])
        assert len(block['tx']) == row['transactionCount']
        original = proof['oracle']['headers'][len(result['observations'])]
        assert block['previousblockhash'] == original['previous_hash']
        result['observations'].append({'height': row['height'], 'hash': block_hash, 'time': block['time'], 'transaction_count': len(block['tx']), 'previous_hash': block['previousblockhash']})
    assert len(result['observations']) == 8
    result['status'] = 'PASS'
finally:
    if result['status'] != 'PASS':
        result['status'] = 'FAIL'
    proof_path.with_name('node-reference.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'status': result['status'], 'independent_zebra_blocks': len(result['observations'])}))
