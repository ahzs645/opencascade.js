#!/usr/bin/env node
/**
 * Test F3D to STEP conversion using the custom OpenCascade.js WASM build
 *
 * This script:
 * 1. Loads the stepifi WASM build from dist/
 * 2. Parses an F3D file (Fusion 360 format) using the ACIS parser
 * 3. Converts the ACIS geometry to OpenCascade shapes
 * 4. Exports the result to STEP format
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, basename } from 'path'
import JSZip from 'jszip'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Configuration
const F3D_PATH = process.argv[2] || '/Users/ahmadjalil/Downloads/slzb-06-wall-mount.f3d'
const STEPIFI_PATH = join(__dirname, 'Stepifi')  // Relative path to Stepifi for ACIS parser

// ============================================================================
// ACIS Parser - Inline minimal version for testing
// ============================================================================

async function loadACISParser() {
  // Try to load from Stepifi project
  const acisPath = '/Users/ahmadjalil/github/Stepifi/public/acis-js'

  try {
    const { AcisReader, RECORD_2_ENTITY } = await import(`${acisPath}/index.js`)
    const geometryBuilder = await import(`${acisPath}/geometry-builder.js`)
    console.log('✓ Loaded ACIS parser from Stepifi')
    return { AcisReader, RECORD_2_ENTITY, geometryBuilder }
  } catch (e) {
    console.error('Failed to load ACIS parser:', e.message)
    throw new Error('ACIS parser not available. Ensure Stepifi project is at /Users/ahmadjalil/github/Stepifi')
  }
}

// ============================================================================
// OpenCascade.js Loader
// ============================================================================

async function loadOpenCascade() {
  console.log('\n=== Loading OpenCascade.js ===')

  // Check for different WASM builds
  const builds = [
    { name: 'stepifi', js: 'opencascade.stepifi.js', wasm: 'opencascade.stepifi.wasm' },
    { name: 'full', js: 'opencascade.full.js', wasm: 'opencascade.full.wasm' },
  ]

  const distDirs = [
    join(__dirname, 'dist'),
    join(__dirname, 'dist-stepifi'),
    join(__dirname, 'dist-step-fix'),
  ]

  let selectedBuild = null
  let selectedDir = null

  // Find an available build
  for (const dir of distDirs) {
    if (!existsSync(dir)) continue

    for (const build of builds) {
      const jsPath = join(dir, build.js)
      const wasmPath = join(dir, build.wasm)

      if (existsSync(jsPath) && existsSync(wasmPath)) {
        selectedBuild = build
        selectedDir = dir
        console.log(`Found ${build.name} build in ${dir}`)
        break
      }
    }
    if (selectedBuild) break
  }

  if (!selectedBuild) {
    throw new Error('No OpenCascade.js WASM build found in dist directories')
  }

  const jsPath = join(selectedDir, selectedBuild.js)
  const wasmPath = join(selectedDir, selectedBuild.wasm)

  console.log(`Using: ${selectedBuild.name}`)
  console.log(`  JS: ${jsPath}`)
  console.log(`  WASM: ${wasmPath} (${(readFileSync(wasmPath).length / 1024 / 1024).toFixed(1)} MB)`)

  // Read and prepare the JS module
  let jsCode = readFileSync(jsPath, 'utf-8')

  // Remove ES module exports if present (for CommonJS compatibility)
  jsCode = jsCode.replace(/export\s*\{[^}]*\}\s*;?\s*$/m, '')
  jsCode = jsCode.replace(/export\s+default\s+\w+\s*;?\s*$/m, '')

  // Create a temporary module file that can be imported
  const tempModulePath = join(__dirname, `temp-oc-loader-${Date.now()}.mjs`)

  const moduleCode = `
const wasmBinary = await (async () => {
  const fs = await import('fs');
  return fs.readFileSync('${wasmPath}');
})();

${jsCode}

// Find the factory function name
const factoryName = typeof opencascade !== 'undefined' ? 'opencascade' :
                    (typeof Module !== 'undefined' ? 'Module' : null);

let oc;
if (factoryName === 'opencascade') {
  oc = await opencascade({
    wasmBinary,
    locateFile: (path) => {
      if (path.endsWith('.wasm')) return '${wasmPath}';
      return '${selectedDir}/' + path;
    }
  });
} else {
  // Try direct module initialization
  const initFn = globalThis.opencascade || globalThis.Module;
  if (initFn) {
    oc = await initFn({
      wasmBinary,
      locateFile: (path) => {
        if (path.endsWith('.wasm')) return '${wasmPath}';
        return '${selectedDir}/' + path;
      }
    });
  }
}

export default oc;
`

  writeFileSync(tempModulePath, moduleCode)

  try {
    console.log('Initializing WASM module...')
    const startTime = performance.now()
    const { default: oc } = await import(tempModulePath)
    const loadTime = performance.now() - startTime
    console.log(`✓ OpenCascade initialized in ${loadTime.toFixed(0)}ms`)
    return oc
  } finally {
    // Clean up temp file
    try {
      const fs = await import('fs')
      fs.unlinkSync(tempModulePath)
    } catch (e) { /* ignore */ }
  }
}

// ============================================================================
// F3D Parser
// ============================================================================

async function parseF3D(filePath, AcisReader, RECORD_2_ENTITY) {
  console.log('\n=== Parsing F3D File ===')
  console.log(`File: ${filePath}`)

  if (!existsSync(filePath)) {
    throw new Error(`F3D file not found: ${filePath}`)
  }

  const data = readFileSync(filePath)
  console.log(`File size: ${(data.length / 1024).toFixed(1)} KB`)

  console.log('Extracting ZIP contents...')
  const zip = await JSZip.loadAsync(data)
  const files = Object.keys(zip.files)

  console.log(`Total files in archive: ${files.length}`)

  // List some interesting files
  const smbFiles = files.filter(f =>
    f.toLowerCase().endsWith('.smb') || f.toLowerCase().endsWith('.smbh')
  )

  console.log(`Found ${smbFiles.length} SMB/SMBH files (ACIS geometry)`)

  const allBodies = []

  for (const smbFile of smbFiles) {
    console.log(`  Parsing: ${smbFile}`)
    const smbData = await zip.file(smbFile).async('arraybuffer')

    const reader = new AcisReader()
    if (!reader.readBinary(new Uint8Array(smbData))) {
      console.warn(`    ✗ Failed to read`)
      continue
    }

    reader.resolveEntities(RECORD_2_ENTITY)
    console.log(`    ✓ Found ${reader.bodies.length} bodies`)
    allBodies.push(...reader.bodies)
  }

  return allBodies
}

// ============================================================================
// Geometry Analysis
// ============================================================================

function analyzeACISGeometry(bodies) {
  console.log('\n=== ACIS Geometry Analysis ===')
  console.log(`Total bodies: ${bodies.length}`)

  let totalFaces = 0
  let surfaceTypes = {}
  let curveTypes = {}

  for (const body of bodies) {
    const lumps = body.getLumps ? body.getLumps() : []
    for (const lump of lumps) {
      const shells = lump.getShells ? lump.getShells() : []
      for (const shell of shells) {
        const faces = shell.getFaces ? shell.getFaces() : []
        for (const face of faces) {
          totalFaces++

          const surface = face.getSurface ? face.getSurface() : null
          if (surface) {
            const type = surface.getType ? surface.getType() : 'unknown'
            surfaceTypes[type] = (surfaceTypes[type] || 0) + 1
          }

          // Check edges for curve types
          const loops = face.getLoops ? face.getLoops() : []
          for (const loop of loops) {
            const coedges = loop.getCoedges ? loop.getCoedges() : []
            for (const coedge of coedges) {
              const edge = coedge.getEdge ? coedge.getEdge() : null
              if (edge) {
                const curve = edge.getCurve ? edge.getCurve() : null
                if (curve) {
                  const ctype = curve.getType ? curve.getType() : 'unknown'
                  curveTypes[ctype] = (curveTypes[ctype] || 0) + 1
                }
              }
            }
          }
        }
      }
    }
  }

  console.log(`Total faces: ${totalFaces}`)

  console.log('\nSurface types:')
  for (const [type, count] of Object.entries(surfaceTypes).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`)
  }

  console.log('\nCurve types:')
  for (const [type, count] of Object.entries(curveTypes).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`)
  }

  return { totalFaces, surfaceTypes, curveTypes }
}

// ============================================================================
// OpenCascade Conversion
// ============================================================================

async function convertToOpenCascade(oc, bodies, geometryBuilder) {
  console.log('\n=== Converting to OpenCascade ===')

  const startTime = performance.now()

  // Use the geometry builder to convert ACIS to OpenCascade
  const shape = geometryBuilder.convertACISBodiesToShape(oc, bodies)

  const convTime = performance.now() - startTime
  console.log(`Conversion took ${convTime.toFixed(0)}ms`)

  if (!shape) {
    throw new Error('Failed to convert geometry - no shape returned')
  }

  // Analyze the resulting shape
  console.log('\n=== OpenCascade Shape Analysis ===')

  // Get shape type
  const shapeType = shape.ShapeType()
  const typeNames = ['COMPOUND', 'COMPSOLID', 'SOLID', 'SHELL', 'FACE', 'WIRE', 'EDGE', 'VERTEX', 'SHAPE']
  console.log(`Shape type: ${typeNames[shapeType.value] || shapeType.value}`)

  // Count faces
  let faceCount = 0
  const faceExplorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  )
  while (faceExplorer.More()) {
    faceCount++
    faceExplorer.Next()
  }
  console.log(`Total faces: ${faceCount}`)

  // Get bounding box
  try {
    const bndBox = new oc.Bnd_Box_1()
    oc.BRepBndLib.Add(shape, bndBox, false)

    if (!bndBox.IsVoid()) {
      const xMin = { current: 0 }, yMin = { current: 0 }, zMin = { current: 0 }
      const xMax = { current: 0 }, yMax = { current: 0 }, zMax = { current: 0 }
      bndBox.Get(xMin, yMin, zMin, xMax, yMax, zMax)

      const sizeX = xMax.current - xMin.current
      const sizeY = yMax.current - yMin.current
      const sizeZ = zMax.current - zMin.current

      console.log('\nBounding box:')
      console.log(`  Min: (${xMin.current.toFixed(2)}, ${yMin.current.toFixed(2)}, ${zMin.current.toFixed(2)})`)
      console.log(`  Max: (${xMax.current.toFixed(2)}, ${yMax.current.toFixed(2)}, ${zMax.current.toFixed(2)})`)
      console.log(`  Size: ${sizeX.toFixed(2)} x ${sizeY.toFixed(2)} x ${sizeZ.toFixed(2)} mm`)

      if (sizeX > 1e10 || sizeY > 1e10 || sizeZ > 1e10) {
        console.warn('\n⚠️  WARNING: Bounding box has extreme values - geometry may have issues')
      } else {
        console.log('\n✓ Bounding box looks valid')
      }

      bndBox.delete()
    }
  } catch (e) {
    console.warn('Could not compute bounding box:', e.message)
  }

  faceExplorer.delete()

  return shape
}

// ============================================================================
// STEP Export
// ============================================================================

async function exportToSTEP(oc, shape, outputPath) {
  console.log('\n=== Exporting to STEP ===')

  const startTime = performance.now()

  try {
    // Check if STEPControl_Writer is available
    if (!oc.STEPControl_Writer_1) {
      throw new Error('STEPControl_Writer not available in this build')
    }

    const writer = new oc.STEPControl_Writer_1()
    console.log('✓ Created STEPControl_Writer')

    // Transfer the shape
    console.log('Transferring shape...')
    const progressRange = new oc.Message_ProgressRange_1()
    const status = writer.Transfer(
      shape,
      oc.STEPControl_StepModelType.STEPControl_AsIs,
      true,
      progressRange
    )
    console.log(`Transfer status: ${status.value}`)

    // Write to virtual filesystem
    const virtualPath = '/tmp/output.step'
    console.log(`Writing to virtual FS: ${virtualPath}`)
    const writeStatus = writer.Write(virtualPath)
    console.log(`Write status: ${writeStatus.value}`)

    // Read from virtual filesystem
    const stepContent = oc.FS.readFile(virtualPath, { encoding: 'utf8' })
    console.log(`STEP content size: ${(stepContent.length / 1024).toFixed(1)} KB`)

    // Clean up virtual file
    oc.FS.unlink(virtualPath)

    // Save to real filesystem
    writeFileSync(outputPath, stepContent)

    const exportTime = performance.now() - startTime
    console.log(`\n✓ STEP export completed in ${exportTime.toFixed(0)}ms`)
    console.log(`Output saved to: ${outputPath}`)

    // Show first few lines
    const lines = stepContent.split('\n').slice(0, 20)
    console.log('\nFirst 20 lines of STEP file:')
    console.log('---')
    console.log(lines.join('\n'))
    console.log('---')

    // Cleanup
    writer.delete()
    progressRange.delete()

    return stepContent

  } catch (error) {
    console.error('\n✗ STEP export failed:', error.message)

    if (error.message.includes('getWasmTableEntry')) {
      console.log('\n⚠️  The getWasmTableEntry error indicates a WASM linking issue.')
      console.log('This may require a rebuild of the WASM module.')
    }

    // Try fallback to BREP export
    console.log('\n--- Attempting BREP export as fallback ---')
    try {
      return await exportToBREP(oc, shape, outputPath.replace('.step', '.brep'))
    } catch (brepError) {
      console.error('BREP fallback also failed:', brepError.message)
      throw error
    }
  }
}

// ============================================================================
// BREP Export (Fallback)
// ============================================================================

async function exportToBREP(oc, shape, outputPath) {
  console.log('\n=== Exporting to BREP (fallback) ===')

  if (!oc.BRepTools) {
    throw new Error('BRepTools not available in this build')
  }

  const virtualPath = '/tmp/output.brep'

  // Use BRepTools.Write_3 (filename overload)
  const progressRange = new oc.Message_ProgressRange_1()
  const success = oc.BRepTools.Write_3(shape, virtualPath, progressRange)

  if (!success) {
    throw new Error('BRepTools.Write failed')
  }

  const brepContent = oc.FS.readFile(virtualPath, { encoding: 'utf8' })
  oc.FS.unlink(virtualPath)

  writeFileSync(outputPath, brepContent)

  console.log(`✓ BREP export completed: ${outputPath}`)
  console.log(`Content size: ${(brepContent.length / 1024).toFixed(1)} KB`)

  progressRange.delete()

  return brepContent
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗')
  console.log('║          F3D to STEP Conversion Test                           ║')
  console.log('║          Using OpenCascade.js Custom WASM Build                ║')
  console.log('╚════════════════════════════════════════════════════════════════╝')

  const results = {
    f3dParsing: false,
    acisAnalysis: false,
    ocConversion: false,
    stepExport: false,
  }

  try {
    // Load dependencies
    const { AcisReader, RECORD_2_ENTITY, geometryBuilder } = await loadACISParser()
    const oc = await loadOpenCascade()

    // Parse F3D
    const bodies = await parseF3D(F3D_PATH, AcisReader, RECORD_2_ENTITY)
    results.f3dParsing = true

    if (bodies.length === 0) {
      console.warn('\n⚠️  No bodies found in F3D file')
      return
    }

    // Analyze ACIS geometry
    analyzeACISGeometry(bodies)
    results.acisAnalysis = true

    // Convert to OpenCascade
    const shape = await convertToOpenCascade(oc, bodies, geometryBuilder)
    results.ocConversion = true

    // Export to STEP
    const outputPath = join(__dirname, `${basename(F3D_PATH, '.f3d')}.step`)
    await exportToSTEP(oc, shape, outputPath)
    results.stepExport = true

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════════╗')
    console.log('║                         TEST SUMMARY                           ║')
    console.log('╠════════════════════════════════════════════════════════════════╣')
    console.log(`║  F3D Parsing:      ${results.f3dParsing ? '✓ PASS' : '✗ FAIL'}                                   ║`)
    console.log(`║  ACIS Analysis:    ${results.acisAnalysis ? '✓ PASS' : '✗ FAIL'}                                   ║`)
    console.log(`║  OC Conversion:    ${results.ocConversion ? '✓ PASS' : '✗ FAIL'}                                   ║`)
    console.log(`║  STEP Export:      ${results.stepExport ? '✓ PASS' : '✗ FAIL'}                                   ║`)
    console.log('╚════════════════════════════════════════════════════════════════╝')

    // Cleanup
    shape.delete()

  } catch (error) {
    console.error('\n╔════════════════════════════════════════════════════════════════╗')
    console.error('║                         TEST FAILED                            ║')
    console.error('╠════════════════════════════════════════════════════════════════╣')
    console.error(`Error: ${error.message}`)
    console.error('╚════════════════════════════════════════════════════════════════╝')
    console.error('\nStack trace:')
    console.error(error.stack)
    process.exit(1)
  }
}

main()
