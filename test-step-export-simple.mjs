#!/usr/bin/env node
/**
 * Simple STEP export test - tests if STEP export works with a basic box shape
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Patch globalThis for OpenCascade.js compatibility
globalThis.__dirname = __dirname
globalThis.__filename = fileURLToPath(import.meta.url)

// All build directories to test
const BUILD_DIRS = [
  { name: 'dist-stepifi', path: join(__dirname, 'dist-stepifi') },
  { name: 'dist-step-fix', path: join(__dirname, 'dist-step-fix') },
  { name: 'replicad-single', path: '/Users/ahmadjalil/Downloads/replicad-main/packages/replicad-opencascadejs/src', jsFile: 'replicad_single.js' },
  { name: 'replicad-exceptions', path: '/Users/ahmadjalil/Downloads/replicad-main/packages/replicad-opencascadejs/src', jsFile: 'replicad_with_exceptions.js' },
]

async function loadOpenCascade(buildDir, buildName, preferredJsFile = null) {
  console.log(`\n  Loading ${buildName}...`)

  if (!existsSync(buildDir)) {
    throw new Error(`Directory not found: ${buildDir}`)
  }

  const files = readdirSync(buildDir)

  // Find JS and WASM files
  let jsFile, wasmFile

  if (preferredJsFile) {
    jsFile = preferredJsFile
    wasmFile = preferredJsFile.replace('.js', '.wasm')
  } else {
    const jsFiles = files.filter(f => f.endsWith('.js') && (f.startsWith('opencascade.') || f.startsWith('replicad_')))
    jsFile = jsFiles[0]
    wasmFile = files.find(f => f.endsWith('.wasm'))
  }

  const jsPath = join(buildDir, jsFile)
  const wasmPath = join(buildDir, wasmFile)

  if (!existsSync(jsPath) || !existsSync(wasmPath)) {
    throw new Error(`Missing files: ${jsFile} or ${wasmFile}`)
  }

  const wasmBinary = readFileSync(wasmPath)
  const wasmSize = (wasmBinary.length / 1024 / 1024).toFixed(1)
  console.log(`  Using: ${jsFile} (WASM: ${wasmSize} MB)`)

  globalThis.__dirname = buildDir

  const jsUrl = pathToFileURL(jsPath).href
  const module = await import(jsUrl)
  const initOpenCascade = module.default

  console.log('  Initializing WASM...')
  const oc = await initOpenCascade({
    wasmBinary: wasmBinary,
    locateFile: (path) => join(buildDir, path)
  })

  console.log('  Initialized')
  return oc
}

async function testSTEPExport(oc, buildName) {
  console.log(`\n  Testing STEP export for ${buildName}...`)

  const result = {
    hasBox: false,
    boxCreated: false,
    hasSTEPWriter: false,
    transferOk: false,
    writeOk: false,
    stepContent: null,
    error: null
  }

  try {
    // Check if we can create a box
    if (oc.BRepPrimAPI_MakeBox_2) {
      result.hasBox = true
      console.log('    BRepPrimAPI_MakeBox_2: available')

      const box = new oc.BRepPrimAPI_MakeBox_2(10, 20, 30)
      const shape = box.Shape()
      result.boxCreated = true
      console.log('    Box created: OK')

      // Check STEP writer
      if (oc.STEPControl_Writer_1) {
        result.hasSTEPWriter = true
        console.log('    STEPControl_Writer_1: available')

        const writer = new oc.STEPControl_Writer_1()
        const progressRange = new oc.Message_ProgressRange_1()

        // Try transfer
        console.log('    Transferring shape...')
        const transferStatus = writer.Transfer(
          shape,
          oc.STEPControl_StepModelType.STEPControl_AsIs,
          true,
          progressRange
        )
        result.transferOk = true
        console.log(`    Transfer: OK (status: ${transferStatus.value})`)

        // Try write
        console.log('    Writing STEP file...')
        const writeStatus = writer.Write('/tmp/test.step')
        console.log(`    Write status: ${writeStatus.value}`)

        // Read content
        const stepContent = oc.FS.readFile('/tmp/test.step', { encoding: 'utf8' })
        oc.FS.unlink('/tmp/test.step')

        result.writeOk = true
        result.stepContent = stepContent
        console.log(`    STEP export: SUCCESS (${stepContent.length} bytes)`)

        writer.delete()
        progressRange.delete()
      } else {
        result.error = 'STEPControl_Writer_1 not available'
        console.log('    STEPControl_Writer_1: NOT AVAILABLE')
      }

      box.delete()
    } else {
      result.error = 'BRepPrimAPI_MakeBox_2 not available'
      console.log('    BRepPrimAPI_MakeBox_2: NOT AVAILABLE')
    }
  } catch (e) {
    result.error = e.message
    console.log(`    ERROR: ${e.message}`)
  }

  return result
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════╗')
  console.log('║           Simple STEP Export Test (Box Shape)                          ║')
  console.log('╚════════════════════════════════════════════════════════════════════════╝')

  const results = []

  for (const build of BUILD_DIRS) {
    console.log(`\n${'═'.repeat(74)}`)
    console.log(`Testing: ${build.name}`)
    console.log('═'.repeat(74))

    if (!existsSync(build.path)) {
      console.log('  SKIPPED - Directory not found')
      results.push({ name: build.name, error: 'Directory not found' })
      continue
    }

    try {
      const oc = await loadOpenCascade(build.path, build.name, build.jsFile)
      const result = await testSTEPExport(oc, build.name)
      results.push({ name: build.name, ...result })
    } catch (e) {
      console.log(`  Error: ${e.message}`)
      results.push({ name: build.name, error: e.message })
    }
  }

  // Summary
  console.log('\n')
  console.log('╔════════════════════════════════════════════════════════════════════════╗')
  console.log('║                        STEP EXPORT TEST SUMMARY                         ║')
  console.log('╠════════════════════════════════════════════════════════════════════════╣')

  const header = [
    'Build'.padEnd(22),
    'Box'.padEnd(6),
    'Writer'.padEnd(8),
    'Transfer'.padEnd(10),
    'Write'.padEnd(8),
    'Result'.padEnd(12),
  ].join('│')

  console.log(`║ ${header} ║`)
  console.log('╠' + '═'.repeat(74) + '╣')

  for (const r of results) {
    const row = [
      r.name.padEnd(22),
      (r.boxCreated ? '✓' : '✗').padEnd(6),
      (r.hasSTEPWriter ? '✓' : '✗').padEnd(8),
      (r.transferOk ? '✓' : '✗').padEnd(10),
      (r.writeOk ? '✓' : '✗').padEnd(8),
      (r.writeOk ? 'SUCCESS' : 'FAILED').padEnd(12),
    ].join('│')
    console.log(`║ ${row} ║`)
  }

  console.log('╚════════════════════════════════════════════════════════════════════════╝')

  // Errors
  const failures = results.filter(r => r.error)
  if (failures.length > 0) {
    console.log('\nErrors:')
    for (const r of failures) {
      console.log(`  ${r.name}: ${r.error}`)
    }
  }

  // Show STEP content preview for successful exports
  const successes = results.filter(r => r.writeOk && r.stepContent)
  if (successes.length > 0) {
    console.log('\nSuccessful STEP exports:')
    for (const r of successes) {
      console.log(`\n  ${r.name} (${r.stepContent.length} bytes):`)
      const preview = r.stepContent.split('\n').slice(0, 10).join('\n')
      console.log('  ' + preview.split('\n').join('\n  '))
      console.log('  ...')
    }
  }
}

main().catch(e => {
  console.error('Fatal error:', e.message)
  console.error(e.stack)
  process.exit(1)
})
