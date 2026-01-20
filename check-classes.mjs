#!/usr/bin/env node
/**
 * Check which classes are available in each build
 */

import { readFileSync, existsSync, readdirSync } from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
globalThis.__dirname = __dirname

const BUILD_DIRS = [
  { name: 'dist-stepifi', path: join(__dirname, 'dist-stepifi'), jsFile: 'opencascade.stepifi.js' },
  { name: 'dist-step-fix', path: join(__dirname, 'dist-step-fix'), jsFile: 'opencascade.full.js' },
  { name: 'replicad-single', path: '/Users/ahmadjalil/Downloads/replicad-main/packages/replicad-opencascadejs/src', jsFile: 'replicad_single.js' },
  { name: 'replicad-exceptions', path: '/Users/ahmadjalil/Downloads/replicad-main/packages/replicad-opencascadejs/src', jsFile: 'replicad_with_exceptions.js' },
]

// Classes needed for F3D/ACIS conversion
const REQUIRED_CLASSES = [
  // Core builders
  'BRep_Builder',
  'BRepBuilderAPI_MakeFace_9',
  'BRepBuilderAPI_MakeEdge_24',
  'BRepBuilderAPI_MakeSolid_2',
  'BRepBuilderAPI_Sewing',

  // Topology
  'TopoDS_Shell',
  'TopoDS_Compound',
  'TopoDS_Solid',
  'TopExp_Explorer_2',

  // Geometry - Surfaces
  'Geom_Plane',
  'Geom_BSplineSurface',
  'Geom_CylindricalSurface',
  'Geom_SphericalSurface',
  'Geom_ConicalSurface',
  'Geom_ToroidalSurface',

  // Geometry - Curves
  'Geom_BSplineCurve',
  'Geom_Circle',
  'Geom_Line',
  'Geom_Ellipse',

  // 2D Curves
  'Geom2d_BSplineCurve',

  // Points/Vectors
  'gp_Pnt_3',
  'gp_Vec_4',
  'gp_Dir_4',
  'gp_Ax2_2',
  'gp_Ax3_3',
  'gp_Pln_3',

  // Arrays for B-splines
  'TColgp_Array1OfPnt',
  'TColgp_Array2OfPnt',
  'TColStd_Array1OfReal',
  'TColStd_Array1OfInteger',

  // Handles
  'Handle_Geom_Surface',
  'Handle_Geom_Curve',
  'Handle_Geom_BSplineSurface',

  // I/O
  'STEPControl_Writer_1',
  'BRepTools',

  // Analysis
  'Bnd_Box_1',
  'BRepBndLib',
]

async function loadOpenCascade(buildDir, jsFile) {
  const jsPath = join(buildDir, jsFile)
  const wasmFile = jsFile.replace('.js', '.wasm')
  const wasmPath = join(buildDir, wasmFile)

  const wasmBinary = readFileSync(wasmPath)
  globalThis.__dirname = buildDir

  const jsUrl = pathToFileURL(jsPath).href
  const module = await import(jsUrl)
  const initOpenCascade = module.default

  return await initOpenCascade({
    wasmBinary: wasmBinary,
    locateFile: (path) => join(buildDir, path)
  })
}

function checkClass(oc, className) {
  // Check exact name
  if (oc[className]) return { found: true, as: className }

  // Check without suffix
  const baseName = className.replace(/_\d+$/, '')
  if (oc[baseName]) return { found: true, as: baseName }

  // Check with _1 suffix
  if (oc[`${baseName}_1`]) return { found: true, as: `${baseName}_1` }

  // Check with _2 suffix
  if (oc[`${baseName}_2`]) return { found: true, as: `${baseName}_2` }

  return { found: false }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════╗')
  console.log('║              Class Availability Check for F3D Conversion               ║')
  console.log('╚════════════════════════════════════════════════════════════════════════╝\n')

  const results = {}

  for (const build of BUILD_DIRS) {
    console.log(`Loading ${build.name}...`)

    try {
      const oc = await loadOpenCascade(build.path, build.jsFile)

      const available = []
      const missing = []

      for (const cls of REQUIRED_CLASSES) {
        const result = checkClass(oc, cls)
        if (result.found) {
          available.push({ name: cls, as: result.as })
        } else {
          missing.push(cls)
        }
      }

      results[build.name] = { available, missing, total: REQUIRED_CLASSES.length }
      console.log(`  ${available.length}/${REQUIRED_CLASSES.length} classes available\n`)

    } catch (e) {
      console.log(`  Error: ${e.message}\n`)
      results[build.name] = { error: e.message }
    }
  }

  // Summary table
  console.log('\n' + '═'.repeat(80))
  console.log('SUMMARY')
  console.log('═'.repeat(80))

  for (const [name, result] of Object.entries(results)) {
    if (result.error) {
      console.log(`\n${name}: ERROR - ${result.error}`)
      continue
    }

    const pct = ((result.available.length / result.total) * 100).toFixed(0)
    console.log(`\n${name}: ${result.available.length}/${result.total} (${pct}%)`)

    if (result.missing.length > 0) {
      console.log(`  Missing (${result.missing.length}):`)
      for (const cls of result.missing) {
        console.log(`    - ${cls}`)
      }
    }
  }

  // Comparison table
  console.log('\n\n' + '═'.repeat(80))
  console.log('CLASS COMPARISON')
  console.log('═'.repeat(80))

  const buildNames = Object.keys(results).filter(n => !results[n].error)

  console.log('\nClass'.padEnd(35) + buildNames.map(n => n.substring(0, 12).padEnd(14)).join(''))
  console.log('-'.repeat(35 + buildNames.length * 14))

  for (const cls of REQUIRED_CLASSES) {
    let row = cls.padEnd(35)
    for (const name of buildNames) {
      const result = results[name]
      const found = result.available.find(a => a.name === cls)
      row += (found ? '✓' : '✗').padEnd(14)
    }
    console.log(row)
  }
}

main().catch(e => {
  console.error('Fatal:', e.message)
  process.exit(1)
})
