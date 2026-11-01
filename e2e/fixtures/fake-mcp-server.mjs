// A minimal MCP server over stdio (newline-delimited JSON-RPC): answers initialize and tools/list so `claude mcp list` reports it Connected.
import { createInterface } from 'node:readline'

const send = (o) => process.stdout.write(JSON.stringify(o) + '\n')
createInterface({ input: process.stdin }).on('line', (line) => {
  let m
  try {
    m = JSON.parse(line)
  } catch {
    return
  }
  if (m.id === undefined) return
  if (m.method === 'initialize') {
    send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake-files', version: '1.0.0' } } })
  } else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [] } })
  else send({ jsonrpc: '2.0', id: m.id, result: {} })
})
