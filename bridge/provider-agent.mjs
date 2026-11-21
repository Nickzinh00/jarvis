import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { decideTool, checkToolUse, fileRoots, fetchTargetProblem } from './policy.mjs'
import { probeUrl } from './page.mjs'

const SETTINGS_FILE = join(homedir(), '.jarvis', 'provider.json')
const DEFAULT_OLLAMA = 'http://127.0.0.1:11434/v1'
const DEFAULT_LOCAL_MODEL = 'qwen3-vl:4b'
const MAX_TOOL_ROUNDS = 8
const MAX_TOOL_RESULT = 16000
const PROVIDERS = {
  auto: { baseUrl: DEFAULT_OLLAMA, apiKey: 'ollama' },
  ollama: { baseUrl: DEFAULT_OLLAMA, apiKey: 'ollama' },
  openai: { baseUrl: 'https://api.openai.com/v1' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1' },
  together: { baseUrl: 'https://api.together.xyz/v1' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  custom: { baseUrl: '' },
}
const COMPATIBLE_PROVIDER_GUIDANCE = `
IMPORTANT: THIS SESSION USES THE JARVIS MULTI-PROVIDER ENGINE, NOT THE CLAUDE AGENT SDK.
Only the jarvis_* tools and the MCP tools actually listed to you are available. Never claim a tool succeeded unless its result confirms it.

DISPLAY AND UI:
- Use jarvis_display to compose visible HTML on a blade.
- Use jarvis_blade for articles, images, galleries, video, embeds, markup, and kind camera.
- Use jarvis_ui with op patch, orbit, effect, screen, or reset to change the HUD.
- Public search is jarvis_web_search. Open a discovered public article with jarvis_open_url or jarvis_blade.
- The original chrome_* native-host tools are not available in this provider mode unless a configured MCP server actually exposes equivalent tools. Never claim access to the user's signed-in Chrome tabs.

CAMERA:
- Use jarvis_look for one frame and jarvis_watch for a short live watch, only when asked.
- Use jarvis_blade with kind camera when the user asks to see the live camera or wants recent-past buffering. This visibly opens the camera blade and its indicator.
- Reviewing the recent past requires the camera blade to have been open and buffering at that time. Do not claim past footage exists otherwise.

FILES AND INTEGRATIONS:
- Workspace files are available through jarvis_read_file and jarvis_list_files. jarvis_write_file is exposed only when local write mode is enabled; never claim to have edited a file if the tool is absent or blocked.
- Configured MCP integrations may expose more services. Use only their tools that are actually present.
`

const mcpToolMap = new Map()
const nativeToolMap = new Map()

async function withTimeout(promise, timeoutMs, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + ' timed out after ' + timeoutMs + 'ms')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return {} }
}

export function readProviderConfig(env = process.env) {
  const saved = readJson(SETTINGS_FILE)
  const selected = String(env.JARVIS_PROVIDER || saved.provider || 'auto').toLowerCase()
  const provider = selected === 'claude' ? 'claude' : (Object.hasOwn(PROVIDERS, selected) ? selected : 'custom')
  const defaults = PROVIDERS[provider] || {}
  return {
    provider,
    fallback: saved.fallback || null,
    baseUrl: String(env.JARVIS_BASE_URL || saved.baseUrl || defaults.baseUrl || '').trim().replace(/\/+$/, ''),
    apiKey: String(env.JARVIS_API_KEY || saved.apiKey || defaults.apiKey || '').trim(),
    model: String(env.JARVIS_MODEL_NAME || saved.model || (['ollama', 'auto'].includes(provider) ? DEFAULT_LOCAL_MODEL : '')).trim(),
  }
}

export async function resolveProviderConfig(config = readProviderConfig(), fetchImpl = fetch) {
  if (config.provider !== 'auto') return config

  const localBase = String(config.baseUrl || DEFAULT_OLLAMA).replace(/\/v1\/?$/, '')
  try {
    const response = await fetchImpl(localBase + '/api/tags', { signal: AbortSignal.timeout(1800) })
    if (response.ok) {
      const payload = await response.json()
      const modelNames = (payload.models || []).map((item) => String(item.name || item.model || ''))
      const requested = String(config.model || DEFAULT_LOCAL_MODEL)
      const installed = modelNames.some((name) =>
        name === requested || name.startsWith(requested + ':') || requested.startsWith(name + ':'),
      )
      if (installed) return { ...config, provider: 'ollama', baseUrl: config.baseUrl || DEFAULT_OLLAMA, model: requested }
    }
  } catch {
    // Local service unavailable: continue to the explicitly configured fallback.
  }

  const fallback = config.fallback
  if (fallback && typeof fallback === 'object' && fallback.provider && fallback.model && fallback.baseUrl && fallback.apiKey) {
    return { ...fallback, provider: String(fallback.provider).toLowerCase() }
  }
  return {
    ...config,
    error: 'Automatic provider selection could not find the local Ollama service and no cloud fallback is configured. Start Ollama and install the selected model, or use the JARVIS menu to add a cloud fallback.',
  }
}

export function openAIEndpoint(baseUrl) {
  const clean = String(baseUrl || '').trim().replace(/\/+$/, '')
  return clean.endsWith('/chat/completions') ? clean : clean + '/chat/completions'
}

function toolName(server, name) {
  const raw = ('mcp_' + server + '_' + name).replace(/[^a-zA-Z0-9_-]/g, '_')
  if (raw.length <= 64) return raw
  return raw.slice(0, 55) + '_' + createHash('sha1').update(raw).digest('hex').slice(0, 8)
}

function objectSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return { type: 'object', properties: {} }
  return { ...schema, type: schema.type || 'object', properties: schema.properties || {} }
}

function textOnly(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return JSON.stringify(content ?? '')
  return content.map((part) => part?.type === 'text' ? (part.text || '') : '[non-text result]').join('\n').slice(0, MAX_TOOL_RESULT)
}

function stripHtml(value) {
  return String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
}

function htmlAttr(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x2F;/g, '/')
}

async function webSearch(query) {
  const value = String(query || '').trim()
  if (!value) throw new Error('A search query is required.')
  const response = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(value), {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; JARVIS/1.0)', accept: 'text/html' },
    signal: AbortSignal.timeout(12000),
  })
  if (!response.ok) throw new Error('Search service returned HTTP ' + response.status + '.')
  const html = await response.text()
  const results = []
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let match
  while ((match = re.exec(html)) && results.length < 8) {
    let url = htmlAttr(match[1])
    const title = stripHtml(match[2])
    try {
      const parsed = new URL(url, 'https://duckduckgo.com')
      const destination = parsed.searchParams.get('uddg')
      url = destination ? decodeURIComponent(destination) : parsed.href
    } catch {
      continue
    }
    if (!title || !/^https?:\/\//i.test(url)) continue
    const section = html.slice(re.lastIndex, re.lastIndex + 1200)
    const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/i.exec(section)
    results.push({ title, url, snippet: stripHtml(snippet?.[1] || '') })
  }
  if (!results.length) return 'No results returned. Try a configured search MCP integration.'
  return results.map((r, i) => (i + 1) + '. ' + r.title + '\n' + r.url + '\n' + r.snippet).join('\n\n')
}

function mcpConfigs() {
  const user = readJson(homedir() + '/.claude.json')
  const project = user.projects?.[homedir()]?.mcpServers || {}
  const extra = readJson(homedir() + '/.jarvis/mcp.json')
  return { ...(user.mcpServers || {}), ...project, ...(extra.mcpServers || {}) }
}

async function connectMcpServers(allowWrites) {
  const clients = []
  const tools = []
  for (const [serverName, config] of Object.entries(mcpConfigs())) {
    if (!config || typeof config !== 'object' || config.disabled === true || config.enabled === false) continue
    let client
    try {
      client = new Client({ name: 'jarvis-multi-provider', version: '1.0.0' })
      let transport
      if (typeof config.command === 'string' && config.command.trim()) {
        transport = new StdioClientTransport({
          command: config.command,
          args: Array.isArray(config.args) ? config.args.map(String) : [],
          env: { ...process.env, ...(config.env || {}) },
          cwd: typeof config.cwd === 'string' ? config.cwd : undefined,
        })
      } else if (typeof config.url === 'string' && /^https?:\/\//i.test(config.url)) {
        transport = new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers || {} } })
      } else continue
      await withTimeout(client.connect(transport), 10000, 'MCP server ' + serverName + ' connection')
      clients.push(client)
      const listed = await client.listTools()
      for (const item of listed.tools || []) {
        const policyName = 'mcp__' + serverName + '__' + item.name
        if (!decideTool(policyName, allowWrites)) continue
        const exposedName = toolName(serverName, item.name)
        tools.push({
          type: 'function',
          function: {
            name: exposedName,
            description: '[' + serverName + '] ' + String(item.description || item.name).slice(0, 1800),
            parameters: objectSchema(item.inputSchema),
          },
        })
        mcpToolMap.set(exposedName, { client, serverName, toolName: item.name, policyName })
      }
      console.log('[jarvis] MCP ' + serverName + ': ' + (listed.tools || []).length + ' tool(s)')
    } catch (err) {
      await client?.close?.().catch(() => {})
      console.warn('[jarvis] MCP ' + serverName + ' unavailable: ' + (err?.message || err))
    }
  }
  return { clients, tools, names: Object.keys(mcpConfigs()) }
}

function schema(properties, required = []) {
  return { type: 'object', properties, ...(required.length ? { required } : {}) }
}

function nativeTools() {
  const defs = [
    ['jarvis_web_search', 'Search public web results and return real titles, URLs and snippets.', schema({ query: { type: 'string' } }, ['query'])],
    ['jarvis_open_url', 'Inspect and open a public article on the JARVIS display.', schema({ url: { type: 'string' }, title: { type: 'string' } }, ['url'])],
    ['jarvis_display', 'Show composed HTML on the JARVIS blade display. Use plain HTML and .hud-* classes.', schema({ title: { type: 'string' }, html: { type: 'string' }, hold: { type: 'string', enum: ['turn', 'sticky'] } }, ['title', 'html'])],
    ['jarvis_blade', 'Open an article, image, video, gallery or markup on the JARVIS blades.', schema({ title: { type: 'string' }, kind: { type: 'string', enum: ['article', 'image', 'gallery', 'video', 'embed', 'markup', 'camera'] }, url: { type: 'string' }, images: { type: 'array', items: { type: 'string' } }, html: { type: 'string' }, mode: { type: 'string', enum: ['reader', 'live'] }, size: { type: 'string', enum: ['compact', 'tall', 'wide', 'full'] }, hold: { type: 'string', enum: ['turn', 'sticky'] } }, ['title', 'kind'])],
    ['jarvis_ui', 'Control the JARVIS interface using patch, orbit, effect, screen or reset operations.', schema({ op: { type: 'string', enum: ['patch', 'orbit', 'effect', 'screen', 'reset'] }, args: { type: 'object', additionalProperties: true } }, ['op'])],
    ['jarvis_look', 'Use the camera only when the user asks you to look at something.', schema({ reason: { type: 'string' } })],
    ['jarvis_watch', 'Watch a short camera clip only after the user explicitly asks.', schema({ seconds: { type: 'integer', minimum: 2, maximum: 15 }, when: { type: 'string', enum: ['now', 'past'] }, reason: { type: 'string' } })],
    ['jarvis_read_file', 'Read a text file inside the JARVIS workspace only.', schema({ path: { type: 'string' } }, ['path'])],
    ['jarvis_list_files', 'List files inside the JARVIS workspace only.', schema({ path: { type: 'string' } })],
    ['jarvis_write_file', 'Write a text file inside the JARVIS workspace. Requires write mode to be enabled locally.', schema({ path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content'])],
  ]
  for (const [name] of defs) nativeToolMap.set(name, { policyName: {
    jarvis_web_search: 'mcp__exa__web_search',
    jarvis_open_url: 'mcp__jarvis__blade',
    jarvis_display: 'mcp__jarvis__display',
    jarvis_blade: 'mcp__jarvis__blade',
    jarvis_ui: 'mcp__jarvis_ui__ui_theme',
    jarvis_look: 'mcp__jarvis_eyes__look',
    jarvis_watch: 'mcp__jarvis_eyes__watch',
    jarvis_read_file: 'Read',
    jarvis_list_files: 'Glob',
    jarvis_write_file: 'Write',
  }[name] })
  return defs.map(([name, description, parameters]) => ({
    type: 'function', function: { name, description, parameters },
  }))
}

function htmlText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim()
}

function makeToolMessages(id, result) {
  const messages = [{
    role: 'tool',
    tool_call_id: id,
    content: String(result.text || 'Tool completed.').slice(0, MAX_TOOL_RESULT),
  }]
  const images = [result.image, ...(result.images || [])].filter(
    (value) => typeof value === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/i.test(value),
  )
  if (images.length) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: 'The previous tool returned the following image(s). Analyze them in the context of the original request.' },
        ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
      ],
    })
  }
  return messages
}

async function executeNative(name, args, ctx) {
  const { send, askBrowser, workspace, roots, allowWrites } = ctx
  if (name === 'jarvis_web_search') return { text: await webSearch(args.query) }
  if (name === 'jarvis_open_url') {
    const url = String(args.url || '').trim()
    const issue = await fetchTargetProblem(url)
    if (issue) throw new Error('URL blocked: ' + issue)
    const report = await probeUrl(url)
    send({ type: 'blade', blade: { id: 'b' + Date.now().toString(36), title: String(args.title || report.title || 'WEB PAGE'), kind: 'article', url, mode: 'reader', size: 'tall', hold: 'turn' } })
    return { text: 'Opened ' + (report.title || url) + ' on the display.' }
  }
  if (name === 'jarvis_display') {
    const html = String(args.html || '').trim()
    if (!htmlText(html) && !/<(img|video|iframe|source)\b/i.test(html)) throw new Error('A panel needs visible text or media.')
    send({ type: 'blade', blade: { id: 'p' + Date.now().toString(36), title: String(args.title || 'DISPLAY'), kind: 'markup', html, size: 'wide', hold: args.hold === 'sticky' ? 'sticky' : 'turn' } })
    return { text: 'Displayed.' }
  }
  if (name === 'jarvis_blade') {
    const kind = String(args.kind || '')
    const url = String(args.url || '').trim()
    const images = Array.isArray(args.images) ? args.images.filter((v) => typeof v === 'string').slice(0, 8) : []
    if (kind === 'gallery' && !images.length) throw new Error('A gallery needs image URLs.')
    if (['article', 'image', 'video', 'embed'].includes(kind) && !url) throw new Error(kind + ' needs a URL.')
    if (kind === 'markup' && !String(args.html || '').trim()) throw new Error('Markup needs HTML content.')
    if (url) {
      const issue = await fetchTargetProblem(url)
      if (issue) throw new Error('URL blocked: ' + issue)
    }
    send({ type: 'blade', blade: {
      id: 'b' + Date.now().toString(36), title: String(args.title || 'DISPLAY'), kind,
      ...(url ? { url } : {}), ...(images.length ? { images } : {}), ...(args.html ? { html: args.html } : {}),
      mode: args.mode === 'live' ? 'live' : 'reader',
      size: ['compact', 'tall', 'wide', 'full'].includes(args.size) ? args.size : (kind === 'article' ? 'tall' : 'wide'),
      hold: args.hold === 'sticky' ? 'sticky' : 'turn',
    } })
    return { text: 'Opened on the JARVIS display.' }
  }
  if (name === 'jarvis_ui') {
    const op = String(args.op || '')
    if (!['patch', 'orbit', 'effect', 'screen', 'reset'].includes(op)) throw new Error('Unsupported interface operation.')
    send({ type: 'ui', op, args: args.args && typeof args.args === 'object' ? args.args : {} })
    return { text: 'Interface updated.' }
  }
  if (name === 'jarvis_look' || name === 'jarvis_watch') {
    const mode = name === 'jarvis_watch' ? 'watch' : 'look'
    const reply = await askBrowser('capture', {
      mode, reason: String(args.reason || '').slice(0, 80),
      seconds: Math.max(2, Math.min(15, Number(args.seconds) || 6)),
      when: args.when === 'past' ? 'past' : 'now',
    }, mode === 'watch' ? 45000 : 20000)
    if (reply.error) throw new Error(reply.error)
    if (!reply.data) throw new Error('The camera returned no image.')
    return { text: mode === 'watch' ? 'Camera frames, in time order.' : 'One frame from the camera.', image: 'data:' + (reply.mimeType || 'image/jpeg') + ';base64,' + reply.data }
  }
  if (name === 'jarvis_read_file' || name === 'jarvis_list_files' || name === 'jarvis_write_file') {
    const filePath = String(args.path || '')
    const policyName = name === 'jarvis_write_file' ? 'Write' : (name === 'jarvis_read_file' ? 'Read' : 'Glob')
    const field = policyName === 'Glob' ? 'path' : 'file_path'
    const check = checkToolUse(policyName, { [field]: filePath }, { allowWrites, cwd: workspace, roots })
    if (!check.allow) throw new Error(check.reason)
    const target = resolve(workspace, filePath)
    if (name === 'jarvis_read_file') return { text: (await readFile(target, 'utf8')).slice(0, MAX_TOOL_RESULT) }
    if (name === 'jarvis_write_file') {
      if (typeof args.content !== 'string') throw new Error('File content must be text.')
      const { mkdir } = await import('node:fs/promises')
      await mkdir(resolve(target, '..'), { recursive: true })
      await writeFile(target, args.content, 'utf8')
      return { text: 'Saved ' + basename(target) + '.' }
    }
    const entries = await readdir(target || workspace, { withFileTypes: true })
    return { text: entries.slice(0, 250).map((entry) => (entry.isDirectory() ? '[DIR] ' : '[FILE] ') + entry.name).join('\n') || '(empty)' }
  }
  throw new Error('Unknown JARVIS tool: ' + name)
}

async function executeTool(call, ctx) {
  const name = call.function?.name || ''
  let args
  try { args = JSON.parse(call.function?.arguments || '{}') } catch { throw new Error('The model returned invalid JSON arguments for ' + name + '.') }
  if (nativeToolMap.has(name)) {
    const verdict = checkToolUse(nativeToolMap.get(name).policyName, args, { allowWrites: ctx.allowWrites, cwd: ctx.workspace, roots: ctx.roots })
    if (!verdict.allow) throw new Error(verdict.reason)
    return executeNative(name, args, ctx)
  }
  const external = mcpToolMap.get(name)
  if (!external) throw new Error('Tool ' + name + ' is no longer available. Reconnect and try again.')
  const verdict = checkToolUse(external.policyName, args, { allowWrites: ctx.allowWrites, cwd: ctx.workspace, roots: ctx.roots })
  if (!verdict.allow) throw new Error(verdict.reason)
  const result = await external.client.callTool({ name: external.toolName, arguments: args })
  if (result.isError) throw new Error(textOnly(result.content))
  const texts = []
  const images = []
  for (const item of result.content || []) {
    if (item.type === 'text') texts.push(item.text)
    if (item.type === 'image' && item.data) images.push('data:' + (item.mimeType || 'image/png') + ';base64,' + item.data)
  }
  return { text: (texts.join('\n') || 'Tool completed.').slice(0, MAX_TOOL_RESULT), images }
}

async function streamCompletion(config, messages, tools, signal, onText) {
  if (config.error) throw new Error(config.error)
  if (!config.baseUrl) throw new Error('No provider URL is configured. Open the JARVIS provider settings.')
  if (!config.model) throw new Error('No model is configured. Run configure-provider.ps1 and select a supported model.')
  if (config.provider !== 'ollama' && !config.apiKey) throw new Error('This cloud provider requires an API key. Configure it locally on this PC.')
  const response = await fetch(openAIEndpoint(config.baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(config.apiKey ? { authorization: 'Bearer ' + config.apiKey } : {}) },
    body: JSON.stringify({ model: config.model, messages, tools: tools.length ? tools : undefined, tool_choice: tools.length ? 'auto' : undefined, stream: true, temperature: 0.4 }),
    signal,
  })
  if (!response.ok) throw new Error(config.provider + ' returned HTTP ' + response.status + ': ' + (await response.text()).slice(0, 2000))
  if (!response.body) throw new Error('The provider returned an empty response stream.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  const calls = new Map()
  const processLine = (raw) => {
    const line = raw.trim()
    if (!line.startsWith('data:')) return
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') return
    let packet
    try { packet = JSON.parse(data) } catch { return }
    for (const choice of packet.choices || []) {
      const delta = choice.delta || {}
      if (typeof delta.content === 'string' && delta.content) { text += delta.content; onText(delta.content) }
      else if (Array.isArray(delta.content)) for (const part of delta.content) if (part.type === 'text' && part.text) { text += part.text; onText(part.text) }
      for (const part of delta.tool_calls || []) {
        const index = Number(part.index || 0)
        const current = calls.get(index) || { id: '', type: 'function', function: { name: '', arguments: '' } }
        if (part.id) current.id += part.id
        if (part.function?.name) current.function.name += part.function.name
        if (part.function?.arguments) current.function.arguments += part.function.arguments
        calls.set(index, current)
      }
    }
  }
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''
      for (const line of lines) processLine(line)
    }
    if (buffer) processLine(buffer)
  } finally { reader.releaseLock() }
  return { text, toolCalls: [...calls.values()] }
}

export async function startCompatibleSession(socket, { systemPrompt, allowWrites = false, workspace }) {
  const send = (message) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message)) }
  const config = await resolveProviderConfig()
  const roots = fileRoots({ workspace, extra: (process.env.JARVIS_FILE_ROOTS || '').split(',').map((s) => s.trim()).filter(Boolean) })
  const mcp = await connectMcpServers(allowWrites)
  const native = nativeTools().filter((item) => allowWrites || item.function.name !== 'jarvis_write_file')
  const tools = [...native, ...mcp.tools].slice(0, 120)
  send({ type: 'ready', servers: ['local-tools', ...mcp.names], provider: config.provider, model: config.model })

  const history = [{ role: 'system', content: systemPrompt + COMPATIBLE_PROVIDER_GUIDANCE }]
  let activeAbort = null
  let closed = false
  let sequence = 0
  const waiting = new Map()
  const askBrowser = (kind, args, timeoutMs = 20000) => new Promise((resolve, reject) => {
    if (closed || socket.readyState !== socket.OPEN) return reject(new Error('JARVIS interface is disconnected.'))
    const id = 'provider-' + (++sequence)
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error('The browser did not reply to the camera request.')) }, timeoutMs)
    waiting.set(id, { resolve, reject, timer })
    send({ type: kind, id, ...args })
  })

  async function answer(userText, askId, controller) {
    if (closed || activeAbort !== controller || controller.signal.aborted) return
    history.push({ role: 'user', content: userText })
    const context = { send, askBrowser, allowWrites, workspace, roots }
    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        if (closed || activeAbort !== controller || controller.signal.aborted) return
        const result = await streamCompletion(config, history, tools, controller.signal,
          (delta) => {
            if (activeAbort === controller && !controller.signal.aborted) send({ type: 'text', delta, ask: askId })
          })
        if (closed || activeAbort !== controller || controller.signal.aborted) return
        if (result.toolCalls.length) {
          for (const call of result.toolCalls) {
            if (!call.id) call.id = 'call_' + createHash('sha1').update(JSON.stringify(call) + Date.now()).digest('hex').slice(0, 16)
          }
          history.push({ role: 'assistant', content: result.text || null, tool_calls: result.toolCalls })
          for (const call of result.toolCalls) {
            if (closed || activeAbort !== controller || controller.signal.aborted) return
            send({ type: 'tool', name: call.function?.name || 'tool', ask: askId })
            try {
              const output = await executeTool(call, context)
              if (closed || activeAbort !== controller || controller.signal.aborted) return
              history.push(...makeToolMessages(call.id, output))
            } catch (err) {
              if (closed || activeAbort !== controller || controller.signal.aborted) return
              history.push({ role: 'tool', tool_call_id: call.id, content: 'Tool error: ' + (err?.message || err) })
            }
          }
          continue
        }
        if (closed || activeAbort !== controller || controller.signal.aborted) return
        history.push({ role: 'assistant', content: result.text || '' })
        send({ type: 'done', text: result.text || '', provider: config.provider, ask: askId })
        if (history.length > 30) {
          const userTurns = []
          for (let index = 1; index < history.length; index++) {
            if (history[index]?.role === 'user') userTurns.push(index)
          }
          const keepFrom = userTurns[Math.max(0, userTurns.length - 8)] ?? 1
          if (keepFrom > 1) history.splice(1, keepFrom - 1)
        }
        return
      }
      if (closed || activeAbort !== controller || controller.signal.aborted) return
      const line = 'The tool sequence reached its safety limit. Please narrow the request.'
      send({ type: 'text', delta: line, ask: askId })
      history.push({ role: 'assistant', content: line })
      send({ type: 'done', text: line, provider: config.provider, ask: askId })
    } catch (err) {
      if (controller.signal.aborted || activeAbort !== controller || closed) return
      console.error('[jarvis] provider turn failed:', err)
      send({ type: 'error', message: String(err?.message || err), ask: askId })
    }
  }

  socket.on('message', (raw) => {
    let message
    try { message = JSON.parse(raw.toString()) } catch { return }
    if (message.type === 'reply' && typeof message.id === 'string') {
      const item = waiting.get(message.id)
      if (item) { waiting.delete(message.id); clearTimeout(item.timer); item.resolve(message) }
      return
    }
    if (message.type === 'interrupt') { activeAbort?.abort(); activeAbort = null; return }
    if (message.type === 'ask' && typeof message.text === 'string') {
      activeAbort?.abort()
      activeAbort = new AbortController()
      const controller = activeAbort
      const askId = typeof message.id === 'string' ? message.id : null
      void Promise.resolve().then(() => {
        if (activeAbort !== controller || controller.signal.aborted) return
        return answer(message.text, askId, controller)
      })
    }
  })

  const cleanup = () => {
    if (closed) return
    closed = true
    activeAbort?.abort()
    for (const item of waiting.values()) { clearTimeout(item.timer); item.reject(new Error('WebSocket closed.')) }
    waiting.clear()
    for (const client of mcp.clients) void client.close().catch(() => {})
    mcpToolMap.clear()
    nativeToolMap.clear()
  }
  socket.once('close', cleanup)
  socket.once('error', cleanup)
  return { provider: config.provider, model: config.model, servers: ['local-tools', ...mcp.names] }
}

export async function saveProviderConfig(config) {
  const provider = String(config.provider || '').toLowerCase()
  if (!Object.hasOwn(PROVIDERS, provider) && provider !== 'claude') throw new Error('Unsupported provider.')
  const model = String(config.model || '').trim()
  const baseUrl = String(config.baseUrl || PROVIDERS[provider]?.baseUrl || '').trim().replace(/\/+$/, '')
  const apiKey = String(config.apiKey || '').trim()
  if (provider !== 'claude' && provider !== 'auto') {
    if (!model) throw new Error('Choose a model supported by the provider.')
    if (provider !== 'ollama' && !apiKey) throw new Error('An API key is required for this cloud provider.')
    if (!baseUrl) throw new Error('Provider URL is required.')
    const parsed = new URL(baseUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Provider URL must use HTTP or HTTPS.')
    if (provider === 'ollama' && !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw new Error('Ollama must be local to this computer.')
  }
  const folder = homedir() + '/.jarvis'
  await mkdir(folder, { recursive: true })
  const value = { provider, model, baseUrl, apiKey, ...(config.fallback ? { fallback: config.fallback } : {}) }
  await writeFile(SETTINGS_FILE, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 })
  return { provider, model, keyConfigured: Boolean(apiKey) }
}

export function providerSummary() {
  const config = readProviderConfig()
  return { provider: config.provider, model: config.model, keyConfigured: Boolean(config.apiKey) }
}
