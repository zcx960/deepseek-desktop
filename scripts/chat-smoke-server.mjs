import { createServer } from 'node:http'
import process from 'node:process'

function page(chat) {
  const title = chat ? 'Chat fixture' : 'Harness fixture'
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${title}</title>
<style>body{font:18px system-ui;padding:48px;color:#192d40;background:#f4f7fb}textarea{display:block;width:70%;height:100px;margin:24px 0;padding:12px;font:18px system-ui}button,a{margin:12px 12px 12px 0}pre{white-space:pre-wrap}</style>
<h1>${title}</h1><p id="identity"></p><textarea aria-label="${title} draft" placeholder="Type a draft; switching modes must keep it"></textarea>
<button id="security">Check native permissions</button><pre id="result"></pre>
<a href="/chat?navigation=retained">Same-origin navigation</a>
<script>
const identity = localStorage.getItem('identity') || crypto.randomUUID();
localStorage.setItem('identity', identity);
document.cookie = 'chatFixture=' + identity + '; SameSite=Lax; Path=/';
document.querySelector('#identity').textContent = 'Persistent profile: ' + identity;
document.querySelector('#security').onclick = async () => {
 const result = document.querySelector('#result');
 const invoke = window.__TAURI_INTERNALS__?.invoke;
 if (!invoke) { result.textContent = 'Native bridge unavailable (blocked)'; return; }
 for (const [command, args] of [['get_app_config',{}],['desktop_chat_clear',{}],['plugin:store|load',{path:'.store.dat',options:{}}]]) {
  try { await invoke(command,args); result.textContent += command + ': UNEXPECTEDLY ALLOWED\\n'; }
  catch { result.textContent += command + ': blocked\\n'; }
 }
};
parent.postMessage({type:'dsh://plugin-boot:ready'},'*');
</script></html>`
}

createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(page(!request.url?.startsWith('/harness')))
}).listen(19086, '127.0.0.1', () => {
  process.stdout.write('Chat/Harness fixtures listening on 127.0.0.1:19086\n')
})
