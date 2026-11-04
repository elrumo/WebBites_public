/**
 * How each AI app connects to the WebBites MCP server.
 *
 * The one list behind both Settings → AI assistants and the developer docs'
 * MCP page, so a client's menu changing is a one-place edit. (The docs page's
 * Markdown twin, server/assets/dev-docs/mcp.md, is written by hand: keep it in
 * step.)
 *
 * Commands, file names and the other apps' menu paths are the same in every
 * language, so they live here untranslated. Each step's prose lives twice:
 * `text` is the English the docs print (they are English-only), and Settings
 * prints the translation at `settings.assistants.clients.<id>.<key>` in every
 * locale file. Both may use {path} and {file}, filled from the entry by
 * `stepText` here or by `t(…, { path, file })` in Settings. Entries marked
 * `generic` are not an app's name, so Settings translates that too, at
 * `settings.assistants.clients.<id>.name`.
 *
 * A step's `snippets` show right after its text, in the shape DevCode's `tabs`
 * takes: { label, language, code }.
 */
import { MCP_URL } from './devApi.js'

const json = (value) => JSON.stringify(value, null, 2)

// Stands in for a real key in every example; never a working one.
const KEY_PLACEHOLDER = 'wb_live_…'

export const MCP_CLIENTS = [
  {
    id: 'claude',
    name: 'Claude',
    apps: 'Claude.ai, Claude Desktop and the mobile apps',
    path: 'Settings → Connectors',
    steps: [
      { key: 'open', text: 'In Claude, open {path} and choose Add custom connector.' },
      { key: 'paste', text: 'Name it WebBites, paste the server URL and select Add.' },
      { key: 'connect', text: 'Select Connect, then approve access on the WebBites page that opens. The connector works in Claude Desktop and the mobile apps too.' },
    ],
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    apps: 'ChatGPT on the web',
    path: 'Settings → Connectors',
    steps: [
      { key: 'developer_mode', text: 'In ChatGPT, open {path} and turn on developer mode (under Advanced).' },
      { key: 'create', text: 'Create a connector: name it WebBites, paste the server URL and choose OAuth.' },
      { key: 'approve', text: 'Approve access on the WebBites page that opens, then turn WebBites on from the tools menu in a chat.' },
    ],
  },
  {
    id: 'claude_code',
    name: 'Claude Code',
    apps: 'Claude Code, in the terminal or your editor',
    steps: [
      {
        key: 'add',
        text: 'Add the server from your terminal:',
        snippets: [{ label: 'Terminal', language: 'bash', code: `claude mcp add --transport http webbites ${MCP_URL}` }],
      },
      { key: 'sign_in', text: 'Start Claude Code, run /mcp, choose webbites and sign in. Your browser opens WebBites so you can approve access.' },
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    apps: 'The Cursor code editor',
    file: '~/.cursor/mcp.json',
    steps: [
      {
        key: 'add',
        text: 'Add WebBites to {file}, or to .cursor/mcp.json in a project:',
        snippets: [{ label: '~/.cursor/mcp.json', language: 'json', code: json({ mcpServers: { webbites: { url: MCP_URL } } }) }],
      },
      { key: 'connect', text: 'In Cursor’s settings, find webbites in the MCP list and select Connect, then approve access on WebBites.' },
    ],
  },
  {
    id: 'vscode',
    name: 'VS Code',
    apps: 'VS Code with Copilot Chat',
    file: '.vscode/mcp.json',
    steps: [
      {
        key: 'add',
        text: 'Add WebBites to {file} in your workspace:',
        snippets: [{ label: '.vscode/mcp.json', language: 'json', code: json({ servers: { webbites: { type: 'http', url: MCP_URL } } }) }],
      },
      { key: 'start', text: 'Select Start above the server in that file, then approve access on WebBites when your browser opens. Its tools appear in Copilot Chat’s agent mode.' },
    ],
  },
  {
    id: 'other',
    name: 'Other apps',
    generic: true,
    apps: 'Any app that speaks MCP',
    steps: [
      { key: 'remote', text: 'Apps that support remote MCP servers take the server URL as it is. Look for “custom connector”, “remote server” or “MCP” in their settings.' },
      {
        key: 'stdio',
        text: 'Apps that can only start local (stdio) servers can reach it through the mcp-remote bridge, which needs Node.js:',
        snippets: [
          { label: 'Terminal', language: 'bash', code: `npx -y mcp-remote ${MCP_URL}` },
          { label: 'JSON config', language: 'json', code: json({ mcpServers: { webbites: { command: 'npx', args: ['-y', 'mcp-remote', MCP_URL] } } }) },
        ],
      },
      { key: 'sign_in', text: 'The first time it runs, your browser opens WebBites so you can approve access.' },
    ],
  },
  {
    id: 'api_key',
    name: 'With an API key',
    generic: true,
    apps: 'Scripts and apps that let you set headers',
    steps: [
      { key: 'when', text: 'Apps that let you set request headers can skip the sign-in and send an API key instead. A key can read and change your whole library, like it can over the REST API.' },
      {
        key: 'send',
        text: 'Create a key in Settings → Developer, then send it as a bearer token:',
        snippets: [
          { label: 'Header', language: 'bash', code: `Authorization: Bearer ${KEY_PLACEHOLDER}` },
          { label: 'Claude Code', language: 'bash', code: `claude mcp add --transport http webbites ${MCP_URL} \\\n  --header "Authorization: Bearer ${KEY_PLACEHOLDER}"` },
          { label: 'Cursor', language: 'json', code: json({ mcpServers: { webbites: { url: MCP_URL, headers: { Authorization: `Bearer ${KEY_PLACEHOLDER}` } } } }) },
        ],
      },
    ],
  },
]

/** A step's English text with the entry's {path} and {file} filled in. */
export const stepText = (step, client) =>
  step.text.replace(/\{(path|file)\}/g, (match, name) => client[name] ?? match)

/**
 * The Mac app's own MCP server, for libraries kept on the Mac without an
 * account. It is the app's executable started with --mcp, so the path is fixed;
 * it only answers once it is turned on in the Mac app.
 */
const LOCAL_COMMAND = '/Applications/WebBites.app/Contents/MacOS/WebBites'

export const LOCAL_MCP = {
  command: LOCAL_COMMAND,
  args: ['--mcp'],
  // Where the switch is, in the Mac app.
  settingsPath: 'Settings → AI assistants',
  claudeDesktopConfig: '~/Library/Application Support/Claude/claude_desktop_config.json',
  snippets: [
    { label: 'Claude Desktop', language: 'json', code: json({ mcpServers: { webbites: { command: LOCAL_COMMAND, args: ['--mcp'] } } }) },
    { label: 'Claude Code', language: 'bash', code: `claude mcp add webbites -- ${LOCAL_COMMAND} --mcp` },
  ],
}
