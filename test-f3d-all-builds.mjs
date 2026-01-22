#!/usr/bin/env node
/**
 * Test F3D to STEP conversion against ALL available OpenCascade.js WASM builds
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join, basename } from 'path'
import { createRequire } from 'module'
import JSZip from 'jszip'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// Patch globalThis for OpenCascade.js compatibility
globalThis.__dirname = __dirname
globalThis.__filename = fileURLToPath(import.meta.url)

// Configuration
const F3D_PATH = process.argv[2] || '/Users/ahmadjalil/Downloads/slzb-06-wall-mount.f3d'

// All build directories to test
const BUILD_DIRS = [
  { name: 'dist', path: join(__dirname, 'dist') },
  { name: 'dist-stepifi', path: join(__dirname, 'dist-stepifi') },
  { name: 'dist-step-fix', path: join(__dirname, 'dist-step-fix') },
  { name: 'dist-step-fix-debug', path: join(__dirname, 'dist-step-fix-debug') },
  { name: 'replicad', path: '/Users/ahmadjalil/Downloads/replicad-main/packages/replicad-opencascadejs/src' },
]

// ============================================================================
// ACIS Parser Loader
// ============================================================================

let cachedACISParser = null

async function loadACISParser() {
  if (cachedACISParser) return cachedACISParser

  const acisPath = '/Users/ahmadjalil/github/Stepifi/public/acis-js'

  try {
    const { AcisReader, RECORD_2_ENTITY } = await import(`${acisPath}/index.js`)
    const geometryBuilder = await import(`${acisPath}/geometry-builder.js`)
    console.log('  Loaded ACIS parser from Stepifi')
    cachedACISParser = { AcisReader, RECORD_2_ENTITY, geometryBuilder }
    return cachedACISParser
  } catch (e) {
    console.error('  Failed to load ACIS parser:', e.message)
    throw new Error('ACIS parser not available')
  }
}

// ============================================================================
// OpenCascade.js Loader
// ============================================================================

async function loadOpenCascade(buildDir, buildName) {
  console.log(`\n  Loading OpenCascade.js from ${buildName}...`)

  if (!existsSync(buildDir)) {
    throw new Error(`Build directory not found: ${buildDir}`)
  }

  // Find available builds in this directory
  const files = readdirSync(buildDir)
  // Support both opencascade.* and replicad_* naming conventions
  const jsFiles = files.filter(f => f.endsWith('.js') && (f.startsWith('opencascade.') || f.startsWith('replicad_')))
  const wasmFiles = files.filter(f => f.endsWith('.wasm'))

  if (jsFiles.length === 0 || wasmFiles.length === 0) {
    throw new Error(`No OpenCascade.js build found in ${buildDir}`)
  }

  // Pick the first available build
  const jsFile = jsFiles[0]
  const wasmFile = wasmFiles[0]

  const jsPath = join(buildDir, jsFile)
  const wasmPath = join(buildDir, wasmFile)

  // Read the WASM binary directly (bypasses fetch)
  const wasmBinary = readFileSync(wasmPath)
  const wasmSize = (wasmBinary.length / 1024 / 1024).toFixed(1)
  console.log(`  Using: ${jsFile} (WASM: ${wasmSize} MB)`)

  // Set __dirname for the module being loaded
  globalThis.__dirname = buildDir

  // Convert to file URL for ES6 import
  const jsUrl = pathToFileURL(jsPath).href

  try {
    // Dynamic import of the ES6 module
    const module = await import(jsUrl)
    const initOpenCascade = module.default

    if (typeof initOpenCascade !== 'function') {
      throw new Error('Module default export is not a function')
    }

    console.log('  Initializing WASM...')
    const startTime = performance.now()

    // Initialize with WASM binary directly (bypasses fetch)
    const oc = await initOpenCascade({
      wasmBinary: wasmBinary,
      locateFile: (path) => {
        // This shouldn't be called for WASM since we're providing wasmBinary
        return join(buildDir, path)
      }
    })

    const loadTime = performance.now() - startTime
    console.log(`  Initialized in ${loadTime.toFixed(0)}ms`)

    return oc

  } catch (importError) {
    console.log(`  ES6 import failed: ${importError.message}`)
    console.log('  Trying CommonJS require...')

    // Fallback to CommonJS require
    try {
      // Clear require cache to avoid issues
      delete require.cache[require.resolve(jsPath)]
      const initOpenCascade = require(jsPath)

      if (typeof initOpenCascade !== 'function') {
        throw new Error('require() did not return a function')
      }

      const startTime = performance.now()
      const oc = await initOpenCascade({
        wasmBinary: wasmBinary,
        locateFile: (path) => {
          return join(buildDir, path)
        }
      })

      const loadTime = performance.now() - startTime
      console.log(`  Initialized (CommonJS) in ${loadTime.toFixed(0)}ms`)

      return oc

    } catch (requireError) {
      console.log(`  CommonJS require also failed: ${requireError.message}`)
      throw new Error(`Failed to load module: ${importError.message}`)
    }
  }
}

// ============================================================================
// F3D Parser (cached)
// ============================================================================

let cachedBodies = null

async function parseF3D(filePath, AcisReader, RECORD_2_ENTITY) {
  if (cachedBodies) {
    console.log(`  Using cached F3D parse (${cachedBodies.length} bodies)`)
    return cachedBodies
  }

  console.log(`  Parsing F3D: ${basename(filePath)}`)

  if (!existsSync(filePath)) {
    throw new Error(`F3D file not found: ${filePath}`)
  }

  const data = readFileSync(filePath)
  const zip = await JSZip.loadAsync(data)
  const files = Object.keys(zip.files)

  const smbFiles = files.filter(f =>
    f.toLowerCase().endsWith('.smb') || f.toLowerCase().endsWith('.smbh')
  )

  const allBodies = []

  for (const smbFile of smbFiles) {
    const smbData = await zip.file(smbFile).async('arraybuffer')
    const reader = new AcisReader()
    if (reader.readBinary(new Uint8Array(smbData))) {
      reader.resolveEntities(RECORD_2_ENTITY)
      allBodies.push(...reader.bodies)
    }
  }

  console.log(`  Found ${allBodies.length} bodies in ${smbFiles.length} SMB files`)
  cachedBodies = allBodies
  return allBodies
}

// ============================================================================
// Check Available Classes
// ============================================================================

function checkAvailableClasses(oc) {
  const requiredClasses = [
    'BRep_Builder',
    'TopoDS_Shell',
    'TopoDS_Compound',
    'BRepBuilderAPI_MakeFace_9',
    'BRepBuilderAPI_MakeEdge_24',
    'Geom_Plane',
    'Geom_BSplineSurface',
    'gp_Pnt_3',
    'STEPControl_Writer_1',
    'BRepTools',
  ]

  const available = []
  const missing = []

  for (const cls of requiredClasses) {
    // Check for the class directly or with _1, _2 suffixes
    const baseName = cls.replace(/_\d+$/, '')
    if (oc[cls] || oc[baseName] || oc[`${baseName}_1`] || oc[`${baseName}_2`]) {
      available.push(cls)
    } else {
      missing.push(cls)
    }
  }

  return { available, missing }
}

// ============================================================================
// Convert and Export
// ============================================================================

async function testBuild(buildDir, buildName, bodies, geometryBuilder) {
  const result = {
    build: buildName,
    loaded: false,
    classesAvailable: 0,
    classesMissing: [],
    conversion: false,
    conversionError: null,
    faceCount: 0,
    stepExport: false,
    stepExportError: null,
    brepExport: false,
    brepExportError: null,
    outputFile: null,
  }

  try {
    // Load OpenCascade
    const oc = await loadOpenCascade(buildDir, buildName)
    if (!oc) {
      result.conversionError = 'Failed to load OpenCascade.js'
      return result
    }
    result.loaded = true

    // Check available classes
    const { available, missing } = checkAvailableClasses(oc)
    result.classesAvailable = available.length
    result.classesMissing = missing

    console.log(`  Classes: ${available.length} available, ${missing.length} missing`)
    if (missing.length > 0) {
      console.log(`  Missing: ${missing.join(', ')}`)
    }

    // Convert ACIS to OpenCascade
    console.log('  Converting ACIS to OpenCascade...')
    const startConv = performance.now()

    let shape
    try {
      shape = geometryBuilder.convertACISBodiesToShape(oc, bodies)
      result.conversion = !!shape
      console.log(`  Conversion: ${result.conversion ? 'SUCCESS' : 'FAILED'} (${(performance.now() - startConv).toFixed(0)}ms)`)
    } catch (e) {
      result.conversionError = e.message
      console.log(`  Conversion: FAILED - ${e.message}`)
    }

    if (!shape) {
      return result
    }

    // Count faces
    try {
      const faceExplorer = new oc.TopExp_Explorer_2(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE
      )
      while (faceExplorer.More()) {
        result.faceCount++
        faceExplorer.Next()
      }
      faceExplorer.delete()
      console.log(`  Face count: ${result.faceCount}`)
    } catch (e) {
      console.log(`  Face count: failed - ${e.message}`)
    }

    // Try STEP export
    console.log('  Attempting STEP export...')
    try {
      if (oc.STEPControl_Writer_1) {
        const writer = new oc.STEPControl_Writer_1()
        const progressRange = new oc.Message_ProgressRange_1()
        const status = writer.Transfer(
          shape,
          oc.STEPControl_StepModelType.STEPControl_AsIs,
          true,
          progressRange
        )

        const virtualPath = '/tmp/output.step'
        const writeStatus = writer.Write(virtualPath)

        const stepContent = oc.FS.readFile(virtualPath, { encoding: 'utf8' })
        oc.FS.unlink(virtualPath)

        const outputPath = join(__dirname, `output-${buildName}.step`)
        writeFileSync(outputPath, stepContent)

        result.stepExport = true
        result.outputFile = outputPath
        console.log(`  STEP export: SUCCESS (${(stepContent.length / 1024).toFixed(1)} KB)`)

        writer.delete()
        progressRange.delete()
      } else {
        result.stepExportError = 'STEPControl_Writer not available'
        console.log('  STEP export: SKIPPED (STEPControl_Writer not available)')
      }
    } catch (e) {
      result.stepExportError = e.message
      console.log(`  STEP export: FAILED - ${e.message}`)
    }

    // Try BREP export as fallback
    if (!result.stepExport) {
      console.log('  Attempting BREP export (fallback)...')
      try {
        if (oc.BRepTools && oc.BRepTools.Write_3) {
          const virtualPath = '/tmp/output.brep'
          const progressRange = new oc.Message_ProgressRange_1()
          const success = oc.BRepTools.Write_3(shape, virtualPath, progressRange)

          if (success) {
            const brepContent = oc.FS.readFile(virtualPath, { encoding: 'utf8' })
            oc.FS.unlink(virtualPath)

            const outputPath = join(__dirname, `output-${buildName}.brep`)
            writeFileSync(outputPath, brepContent)

            result.brepExport = true
            result.outputFile = outputPath
            console.log(`  BREP export: SUCCESS (${(brepContent.length / 1024).toFixed(1)} KB)`)
          } else {
            result.brepExportError = 'BRepTools.Write returned false'
            console.log('  BREP export: FAILED')
          }
          progressRange.delete()
        } else {
          result.brepExportError = 'BRepTools.Write_3 not available'
          console.log('  BREP export: SKIPPED (BRepTools not available)')
        }
      } catch (e) {
        result.brepExportError = e.message
        console.log(`  BREP export: FAILED - ${e.message}`)
      }
    }

    // Cleanup
    if (shape && shape.delete) shape.delete()

  } catch (e) {
    result.conversionError = e.message
    console.log(`  Error: ${e.message}`)
  }

  return result
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════╗')
  console.log('║       F3D to STEP Conversion - Testing ALL Available Builds            ║')
  console.log('╚════════════════════════════════════════════════════════════════════════╝')

  // Load ACIS parser
  const { AcisReader, RECORD_2_ENTITY, geometryBuilder } = await loadACISParser()

  // Parse F3D once
  const bodies = await parseF3D(F3D_PATH, AcisReader, RECORD_2_ENTITY)

  // Test each build
  const results = []

  for (const build of BUILD_DIRS) {
    console.log(`\n${'═'.repeat(74)}`)
    console.log(`Testing: ${build.name}`)
    console.log('═'.repeat(74))

    if (!existsSync(build.path)) {
      console.log(`  SKIPPED - Directory not found`)
      results.push({
        build: build.name,
        loaded: false,
        conversionError: 'Directory not found',
      })
      continue
    }

    const result = await testBuild(build.path, build.name, bodies, geometryBuilder)
    results.push(result)
  }

  // Summary
  console.log('\n')
  console.log('╔════════════════════════════════════════════════════════════════════════╗')
  console.log('║                            TEST SUMMARY                                 ║')
  console.log('╠════════════════════════════════════════════════════════════════════════╣')

  const colWidth = 20
  const header = [
    'Build'.padEnd(colWidth),
    'Load'.padEnd(8),
    'Classes'.padEnd(10),
    'Convert'.padEnd(10),
    'Faces'.padEnd(8),
    'STEP'.padEnd(8),
    'BREP'.padEnd(8),
  ].join('│')

  console.log(`║ ${header} ║`)
  console.log('╠' + '═'.repeat(74) + '╣')

  for (const r of results) {
    const row = [
      r.build.padEnd(colWidth),
      (r.loaded ? '✓' : '✗').padEnd(8),
      `${r.classesAvailable || 0}/10`.padEnd(10),
      (r.conversion ? '✓' : '✗').padEnd(10),
      `${r.faceCount || 0}`.padEnd(8),
      (r.stepExport ? '✓' : '✗').padEnd(8),
      (r.brepExport ? '✓' : '✗').padEnd(8),
    ].join('│')
    console.log(`║ ${row} ║`)
  }

  console.log('╚════════════════════════════════════════════════════════════════════════╝')

  // Detailed errors
  const hasErrors = results.some(r => r.conversionError || r.stepExportError)
  if (hasErrors) {
    console.log('\nDetailed Errors:')
    for (const r of results) {
      if (r.conversionError || r.stepExportError || r.brepExportError) {
        console.log(`\n  ${r.build}:`)
        if (r.conversionError) console.log(`    Conversion: ${r.conversionError}`)
        if (r.stepExportError) console.log(`    STEP: ${r.stepExportError}`)
        if (r.brepExportError) console.log(`    BREP: ${r.brepExportError}`)
        if (r.classesMissing?.length > 0) console.log(`    Missing classes: ${r.classesMissing.join(', ')}`)
      }
    }
  }

  // Output files
  const outputFiles = results.filter(r => r.outputFile)
  if (outputFiles.length > 0) {
    console.log('\nOutput Files:')
    for (const r of outputFiles) {
      console.log(`  ${r.build}: ${r.outputFile}`)
    }
  }
}

main().catch(e => {
  console.error('Fatal error:', e.message)
  console.error(e.stack)
  process.exit(1)
})
