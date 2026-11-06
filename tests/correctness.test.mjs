import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {MessageCache} from '../message-cache.js';
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
function extract(name){const match=source.match(new RegExp(`^(async )?function ${name}\\(`,'m'));return source.slice(match.index,source.indexOf('\n}',match.index)+2);}
test('prefilter and literal highlighter agree on Greek sigma and punctuation',()=>{
 const cache=new MessageCache({},()=>{}), first={};cache.messages.set(first,'ΟΣ [needle]');
 assert.deepEqual(cache.findMatches(['σ']),[first]);assert.deepEqual(cache.findMatches(['[needle]']),[first]);
});
test('empty sidebar is safe and stale rows cannot navigate under a different owner',async()=>{
 const dom=new JSDOM('<div id="extensionSideBarLoader"></div><div id="extensionSideBarContainer"></div>',{runScripts:'outside-only'});
 let owner='A',opened=0;const w=dom.window;w.getChatSelectorContextKey=()=>owner;w.openChatById=async()=>opened++;
 w.eval(extract('renderSideBar'));w.renderSideBar([],null);
 w.renderSideBar([{file_name:'other',last_mes:{format:()=>''},mes:'',chat_items:1,file_size:1}],'current');
 owner='B';w.document.querySelector('.sideBarItem').click();await Promise.resolve();assert.equal(opened,0);dom.window.close();
});
test('selector preserves an interior .jsonl and exposes transient failure for retry',async()=>{
 const dom=new JSDOM('',{runScripts:'outside-only'}),w=dom.window;w.getRequestHeaders=()=>({});w.console={error(){}};
 w.eval(extract('getListOfCharacterChats'));
 w.fetch=async()=>({ok:false});assert.equal(await w.getListOfCharacterChats('A'),null);
 w.fetch=async()=>({ok:true,json:async()=>[{file_name:'draft.jsonl review.jsonl'}]});
 assert.equal((await w.getListOfCharacterChats('A'))[0],'draft.jsonl review');dom.window.close();
});
