#!/usr/bin/env node
/**
 * Look up a wasm function name from the custom "name" section.
 *
 * Usage:
 *   node scripts/wasm-name-lookup.mjs path/to/file.wasm 46556
 */

import { readFileSync } from 'fs'

const [wasmPath, funcIndexRaw] = process.argv.slice(2)

if (!wasmPath) {
  console.error('Usage: node scripts/wasm-name-lookup.mjs <file.wasm> [funcIndex]')
  process.exit(1)
}

const wasm = new Uint8Array(readFileSync(wasmPath))
let offset = 0

function readU32() {
  let result = 0
  let shift = 0
  while (true) {
    if (offset >= wasm.length) throw new Error('Unexpected EOF while reading u32')
    const byte = wasm[offset++]
    result |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) break
    shift += 7
  }
  return result >>> 0
}

function readBytes(n) {
  if (offset + n > wasm.length) throw new Error('Unexpected EOF while reading bytes')
  const out = wasm.slice(offset, offset + n)
  offset += n
  return out
}

function readString() {
  const len = readU32()
  const bytes = readBytes(len)
  return new TextDecoder('utf-8').decode(bytes)
}

function assertWasmHeader() {
  const magic = [0x00, 0x61, 0x73, 0x6d]
  for (let i = 0; i < 4; i++) {
    if (wasm[i] !== magic[i]) throw new Error('Invalid wasm magic header')
  }
  offset = 8
}

function parseNameSection() {
  const names = new Map()
  assertWasmHeader()

  while (offset < wasm.length) {
    const sectionId = wasm[offset++]
    const sectionSize = readU32()
    const sectionEnd = offset + sectionSize

    if (sectionId === 0) {
      const sectionName = readString()
      if (sectionName === 'name') {
        while (offset < sectionEnd) {
          const subId = wasm[offset++]
          const subSize = readU32()
          const subEnd = offset + subSize

          if (subId === 1) {
            const count = readU32()
            for (let i = 0; i < count; i++) {
              const idx = readU32()
              const fname = readString()
              names.set(idx, fname)
            }
          }

          offset = subEnd
        }
      }
    }

    offset = sectionEnd
  }

  return names
}

try {
  const names = parseNameSection()
  const funcIndex = funcIndexRaw ? Number(funcIndexRaw) : null

  if (funcIndex !== null && Number.isFinite(funcIndex)) {
    const name = names.get(funcIndex)
    if (name) {
      console.log(name)
    } else {
      console.log('(not found)')
    }
  } else {
    console.log(`Parsed ${names.size} function names`)
  }
} catch (err) {
  console.error(`Failed to read name section: ${err.message}`)
  process.exit(1)
}
