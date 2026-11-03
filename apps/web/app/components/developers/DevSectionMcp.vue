<template>
  <section>
    <h2 id="what-it-is">What it is</h2>
    <p class="docs-lead">
      The Model Context Protocol (MCP) is the open standard AI assistants use to reach tools outside the
      chat. The WebBites MCP server hands an assistant your library as a set of those tools — search,
      read, save, edit and organise — so you can ask for things in plain words and it does the calls.
    </p>
    <ul>
      <li>“Find the article about sourdough starters I saved last spring.”</li>
      <li>“Save this link to my Reading board and tag it <em>design</em>.”</li>
      <li>“What have I saved about Rust this month? Summarise the three best.”</li>
    </ul>
    <p>
      There is nothing to install and no code to write. It works on every plan, signs in with your
      WebBites account, and every tool call counts against the same allowance as the
      <NuxtLink to="/developers/docs">REST API</NuxtLink>.
    </p>
    <div class="docs-note">
      The hosted server — the only address you need to give an assistant:
      <code>{{ MCP_URL }}</code>
    </div>
  </section>

  <section>
    <h2 id="connecting">Connecting an assistant</h2>
    <p>
      Most apps take the URL above and do the rest: the first time they connect, your browser opens
      WebBites, you sign in and approve the connection, and you are sent back. The same steps are in the
      app under Settings → AI assistants.
    </p>
    <template v-for="client in MCP_CLIENTS" :key="client.id">
      <h3 :id="`connect-${client.id.replace(/_/g, '-')}`">{{ client.name }}</h3>
      <p class="!text-sm">{{ client.apps }}</p>
      <ol>
        <li v-for="step in client.steps" :key="step.key">
          {{ stepText(step, client) }}
          <DevCode v-if="step.snippets?.length" v-bind="codeProps(step.snippets)" class="mt-3" />
        </li>
      </ol>
    </template>
  </section>

  <section>
    <h2 id="authentication">Signing in and what an assistant can do</h2>
    <h3 id="consent">Approving a connection</h3>
    <p>
      An assistant never sees your password. It signs in with OAuth: WebBites shows you a consent page
      saying which app is asking, where you will be sent afterwards and what it will be able to do, and
      the app only gets in if you approve.
    </p>
    <ul>
      <li><strong>Read access</strong> comes with every approval: searching and reading your bookmarks, notes, boards and tags.</li>
      <li><strong>Allow changes</strong> is a switch on the same page, on by default when the app asks for it. Turned off, the connection is read only and the write tools disappear from what the assistant sees.</li>
      <li><strong>Verified apps</strong> publish their details at an https address WebBites can check, and the page shows that address. An <strong>Unverified</strong> badge means the app registered itself and WebBites cannot confirm who made it.</li>
      <li><strong>A program on this computer</strong> — the page says so when an app asks to be sent back to <code>localhost</code>. Only approve that if you have just started the connection yourself.</li>
    </ul>
    <div class="docs-table-wrap">
      <table class="docs-table">
        <thead><tr><th>Scope</th><th>What it allows</th></tr></thead>
        <tbody>
          <tr v-for="scope in MCP_SCOPES" :key="scope.name">
            <td><code>{{ scope.name }}</code></td>
            <td>{{ scope.description }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>
      What you approve is fixed for that connection. To give a read-only assistant write access, or take
      it away, disconnect it and connect it again.
    </p>

    <h3 id="connected-assistants">Seeing and disconnecting assistants</h3>
    <p>
      Settings → AI assistants in the app lists every assistant you have connected, whether it can make
      changes and when it was last used. <strong>Disconnect</strong> takes effect immediately — its next
      request is refused — and the assistant has to be approved again to come back.
    </p>

    <h3 id="api-keys">Using an API key instead</h3>
    <p>
      Apps that let you set request headers can skip the sign-in and send one of your
      <NuxtLink to="/developers/docs/api-keys">API keys</NuxtLink> as a bearer token. A key always has full
      read and write access, and its calls count against that key in your
      <NuxtLink to="/developers/docs/usage">usage</NuxtLink>. Revoke the key to cut the app off.
    </p>
    <DevCode :code="API_KEY_HEADER" language="bash" label="Header" />

    <h3 id="for-client-developers">For client developers</h3>
    <ul>
      <li>Streamable HTTP, <code>POST</code> only. The server is stateless: it serves protocol revision 2026-07-28 and answers <code>initialize</code> for 2025-11-25, 2025-06-18 and 2025-03-26.</li>
      <li>OAuth 2.1 with PKCE (<code>S256</code>). Clients identify themselves with a Client ID Metadata Document, or register through Dynamic Client Registration.</li>
      <li>An unauthenticated request gets a <code>401</code> whose <code>WWW-Authenticate</code> header points at the protected resource metadata: <code>{{ RESOURCE_METADATA_URL }}</code>.</li>
      <li>A read-only connection that calls a write tool anyway gets a <code>403</code> with <code>error="insufficient_scope"</code>, so the client can ask for <code>bookmarks:write</code> again.</li>
    </ul>
  </section>

  <section>
    <h2 id="tools">Tool reference</h2>
    <p>
      Eleven tools, in this order. Results come back as structured content with a JSON copy alongside,
      and every bookmark carries a <code>web_url</code> that opens it in WebBites. Write tools are left
      out of the list for a read-only connection.
    </p>
    <div class="docs-table-wrap">
      <table class="docs-table">
        <thead><tr><th>Tool</th><th>What it does</th><th>Arguments</th><th>Access</th></tr></thead>
        <tbody>
          <tr v-for="tool in MCP_TOOLS" :key="tool.name">
            <td><code>{{ tool.name }}</code></td>
            <td>{{ tool.description }}</td>
            <td>
              <template v-if="tool.args.length">
                <span v-for="(arg, index) in tool.args" :key="arg.name"><code>{{ arg.name }}</code><span v-if="arg.required" title="required">*</span><template v-if="index < tool.args.length - 1">, </template></span>
              </template>
              <span v-else>none</span>
            </td>
            <td>{{ tool.write ? 'Write' : 'Read' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="!text-sm">* required.</p>

    <h3 id="tool-arguments">Arguments</h3>
    <template v-for="tool in MCP_TOOLS.filter(t => t.args.length)" :key="tool.name">
      <h4 :id="`tool-${tool.name.replace(/_/g, '-')}`" class="!normal-case !tracking-normal">{{ tool.name }} — {{ tool.title }}</h4>
      <div class="docs-table-wrap">
        <table class="docs-table">
          <thead><tr><th>Argument</th><th>Type</th><th>What it does</th></tr></thead>
          <tbody>
            <tr v-for="arg in tool.args" :key="arg.name">
              <td><code>{{ arg.name }}</code><span v-if="arg.required"> (required)</span></td>
              <td>{{ arg.type }}</td>
              <td>{{ arg.description }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>

  <section>
    <h2 id="limits">Limits and metering</h2>
    <p>
      Every tool call is one request against your plan's developer API allowance — the same one your
      API keys share. Listing the tools and the protocol's own housekeeping are free.
    </p>
    <div class="docs-table-wrap">
      <table class="docs-table">
        <thead><tr><th>Plan</th><th>Tool calls per minute</th><th>Tool calls per month</th></tr></thead>
        <tbody>
          <tr v-for="row in RATE_LIMITS" :key="row.plan">
            <td class="capitalize">{{ row.plan }}</td>
            <td>{{ row.perMinute.toLocaleString() }}</td>
            <td>{{ row.perMonth.toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <ul>
      <li>An assistant that runs out gets an error result explaining why, and usually tells you. The per-minute limit clears within a minute; the monthly one on the first of the month, or when you upgrade.</li>
      <li>The <NuxtLink to="/developers/docs/usage">usage page</NuxtLink> breaks the month down per key and per connected assistant.</li>
      <li>One question can take several calls — a search, then a <code>get_bookmark</code> or two — so a chatty assistant spends more than one request per message.</li>
    </ul>
  </section>

  <section>
    <h2 id="local-server">The Mac app's local server</h2>
    <p>
      If you use the Mac app without an account, your library never reaches our servers, so the hosted
      server cannot see it. The Mac app has its own MCP server for that case: the app itself, started
      with <code>--mcp</code> by the assistant, on your Mac.
    </p>
    <ol>
      <li>In the Mac app, open {{ LOCAL_MCP.settingsPath }} and turn on the local server. It is off until you do. A second switch decides whether assistants may make changes.</li>
      <li>Keep WebBites in <code>/Applications</code>, and open it at least once in local mode so there is a library to read.</li>
      <li>Point the assistant at the app. In Claude Desktop, add this to <code>{{ LOCAL_MCP.claudeDesktopConfig }}</code> (Cursor takes the same JSON in <code>~/.cursor/mcp.json</code>); in Claude Code, run the command:</li>
    </ol>
    <DevCode :tabs="LOCAL_MCP.snippets" />
    <p>It has the same eleven tools, with these differences:</p>
    <ul>
      <li><strong>No semantic search.</strong> <code>search_bookmarks</code> matches the words you give it, not their meaning.</li>
      <li><strong>No page text.</strong> <code>get_bookmark</code> returns the bookmark without its saved reader text, and says so.</li>
      <li><strong>Writes go through the app.</strong> Saves and edits are handed to WebBites, which may open in the background to apply them. If it has not done so within about 15 seconds, the tool reports the change as queued, and it lands the next time the app runs.</li>
      <li><strong>The free plan's 100-bite limit applies</strong> to saves, as it does in the app.</li>
      <li><strong>It does not answer while App Lock is on</strong>, and it needs the Mac app: there is no local server on iPhone or iPad.</li>
    </ul>
  </section>

  <section>
    <h2 id="security">Security notes</h2>
    <ul>
      <li><strong>What an assistant reads goes to its provider.</strong> Search results, notes and page text pass through the assistant's own AI service and are kept under that service's terms, not ours.</li>
      <li><strong>Saved pages are untrusted text.</strong> A page you bookmarked can contain instructions aimed at an AI. The server tells assistants to treat titles, notes and page text as data, never as orders — but if an assistant also browses the web or runs other tools, consider leaving Allow changes off.</li>
      <li><strong>Deleting is cautious by design.</strong> <code>delete_bookmark</code> moves one bookmark to the trash per call, assistants are told to ask you first, and the trash keeps it for 30 days.</li>
      <li><strong>Disconnect what you no longer use.</strong> Settings → AI assistants shows when each one was last used.</li>
      <li><strong>Treat an API key like a password.</strong> Anything that holds one has your whole library; see <NuxtLink to="/developers/docs/authentication">Authentication</NuxtLink>.</li>
    </ul>
  </section>

  <section>
    <h2 id="troubleshooting">Troubleshooting</h2>
    <div class="docs-table-wrap">
      <table class="docs-table">
        <thead><tr><th>What you see</th><th>What to do</th></tr></thead>
        <tbody>
          <tr v-for="row in TROUBLESHOOTING" :key="row.problem">
            <td>{{ row.problem }}</td>
            <td>{{ row.fix }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>
      Still stuck? <NuxtLink to="/support">Get in touch</NuxtLink> and say which assistant you are using.
    </p>
  </section>
</template>

<script setup>
import { MCP_URL, MCP_RESOURCE_METADATA_URL, MCP_SCOPES, MCP_TOOLS, RATE_LIMITS } from '~/utils/devApi'
import { MCP_CLIENTS, LOCAL_MCP, stepText } from '~/utils/mcpClients'
import DevCode from '~/components/developers/DevCode.vue'

const API_KEY_HEADER = 'Authorization: Bearer wb_live_…'
const RESOURCE_METADATA_URL = MCP_RESOURCE_METADATA_URL

// DevCode only draws its header (and its copy button) for a label or tabs.
const codeProps = (snippets) =>
  snippets.length > 1
    ? { tabs: snippets }
    : { code: snippets[0].code, language: snippets[0].language, label: snippets[0].label }

const TROUBLESHOOTING = [
  { problem: '401, “needs authentication” or “unauthorized”', fix: 'The connection was disconnected or its sign-in lapsed after a long spell unused. Reconnect it from the assistant and approve it again. With an API key, check the header reads Bearer wb_live_… and the key has not been revoked.' },
  { problem: 'An “Unverified” badge on the consent page', fix: 'The app registered itself, so WebBites cannot confirm who made it. That is normal for many desktop and command-line tools; approve only if you started the connection and trust the app.' },
  { problem: 'The assistant cannot save or edit', fix: 'The connection is read only. Disconnect it in Settings → AI assistants, connect again and leave Allow changes on.' },
  { problem: '429 or “allowance spent”', fix: 'You hit the per-minute or monthly limit. Wait a minute, or check the usage page; upgrading raises the monthly allowance straight away.' },
  { problem: 'Local server: “turn it on in Settings”', fix: `Open the Mac app, go to ${LOCAL_MCP.settingsPath} and turn on the local server.` },
  { problem: 'Local server: “open WebBites once in local mode”', fix: 'The app has not written a library for the server to read yet. Open WebBites, make sure it is in local mode, and try again.' },
  { problem: 'Local server: changes reported as queued', fix: 'The app did not apply them within 15 seconds. Open WebBites and they are applied.' },
]
</script>
