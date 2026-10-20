import test from 'node:test';
import assert from 'node:assert/strict';
import {readableMemo} from './memo.ts';

const padded = bytes => { const out=Buffer.alloc(512);Buffer.from(bytes).copy(out);return out.toString('hex'); };
test('readable memo preserves UTF-8, whitespace and BOM while removing only null padding',()=>{
 for(const text of ['Zeer test memo','  hello\n','Halo Zcash \u{1F512}','\uFEFFmemo'])assert.deepEqual(readableMemo(padded(Buffer.from(text))),{memoKind:'text',memoText:text});
 assert.deepEqual(readableMemo('00'.repeat(512)),{memoKind:'empty_text',memoText:''});
 assert.deepEqual(readableMemo(padded([0xf6])),{memoKind:'no_memo',memoText:null});
});
test('non-text and invalid UTF-8 never become misleading replacement text',()=>{
 for(const bytes of [[0xf5],[0xf6,1],[0xf7],[0xff,65]])assert.deepEqual(readableMemo(padded(bytes)),{memoKind:'non_text',memoText:null});
 for(const bytes of [[0xc0,0xaf],[0xed,0xa0,0x80],[0xf4,0x90,0x80,0x80]])assert.deepEqual(readableMemo(padded(bytes)),{memoKind:'invalid_utf8',memoText:null});
 assert.deepEqual(readableMemo(padded([65,0,66])),{memoKind:'text_with_nul',memoText:null});
});
test('malformed memo envelopes are rejected without echoing private contents',()=>{
 for(const hex of ['', '00'.repeat(511),'00'.repeat(513),'zz'.repeat(512)])assert.throws(()=>readableMemo(hex),/^Error: Expected exactly 512 memo bytes$/);
});
