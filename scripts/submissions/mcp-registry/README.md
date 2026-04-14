# MCP Official Registry submission

Submit to https://registry.modelcontextprotocol.io so WebLens shows up in
PulseMCP, Smithery, Glama, Cursor/Windsurf/Claude Desktop discovery, and
every downstream aggregator that crawls the canonical registry.

## Steps

```bash
# 1. Install the publisher CLI
npm install -g @modelcontextprotocol/publisher

# 2. Authenticate (GitHub OAuth OR DNS TXT on weblens.dev)
mcp-publisher login

# 3. Publish from this directory
mcp-publisher publish server.json
```

## Namespace options (pick one, edit server.json before publishing)

- **DNS verified** (preferred — matches your domain): `dev.weblens/weblens`
  - Add TXT record: `_mcp-server.dev.weblens` → `<challenge>`
- **GitHub verified** (fastest if you publish from the repo's owner account):
  `io.github.vassilistotskas/weblens`

## Prerequisites before publishing

1. `@weblens/mcp` must be published to npm first:
   ```bash
   cd mcp-server && npm publish --access public
   ```
2. The `version` field in `server.json` must match the published npm version.
