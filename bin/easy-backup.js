#!/usr/bin/env node
import { main } from '../lib/cli.js'

main().then((code) => {
  process.exitCode = code
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
