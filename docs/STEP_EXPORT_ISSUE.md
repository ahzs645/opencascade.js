# STEP Export Issue: `getWasmTableEntry` Error

## Summary

When using OpenCascade.js to export **complex geometry** to STEP format, you may encounter the following error:

```
getWasmTableEntry(...) is not a function
```

**Important:** This error only occurs with complex geometry (like B-spline surfaces from ACIS/F3D files). Simple primitives (boxes, spheres, etc.) export to STEP successfully.

## Test Results

### Simple Shape Test (Box)

Testing STEP export with a simple box shape (January 2025):

| Build | WASM Size | Box Creation | STEP Export |
|-------|-----------|--------------|-------------|
| dist-step-fix | 48.0 MB | ✓ | **✓ SUCCESS** |
| replicad-single | 10.3 MB | ✓ | **✓ SUCCESS** |
| replicad-exceptions | 18.3 MB | ✓ | **✓ SUCCESS** |

### Complex Geometry Test (F3D with 2145 faces)

Testing F3D to STEP conversion with ACIS geometry:

| Build | WASM Size | Load | Conversion | Faces | STEP Export | BREP Export |
|-------|-----------|------|------------|-------|-------------|-------------|
| dist-stepifi | 10.3 MB | ✓ | ✓ | 2145 | ✗ | ✓ |
| dist-step-fix | 48.0 MB | ✓ | ✓ | 2145 | ✗ | ✓ |

**Key finding:** STEP export works for simple primitives but fails for complex B-spline geometry with the `getWasmTableEntry` error.

## Error Details

The error typically occurs during the `STEPControl_Writer.Write()` call:

```javascript
const writer = new oc.STEPControl_Writer_1()
const progressRange = new oc.Message_ProgressRange_1()

// Transfer works fine
writer.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true, progressRange)

// This fails with getWasmTableEntry error
writer.Write('/tmp/output.step')  // <-- Error here
```

The error message:
```
getWasmTableEntry(...) is not a function
```

## When Does This Error Occur?

The error is **geometry-dependent**, not build-dependent:

| Geometry Type | STEP Export |
|---------------|-------------|
| Simple primitives (Box, Sphere, Cylinder) | ✓ Works |
| Extruded/revolved profiles | ✓ Usually works |
| Complex B-spline surfaces | ✗ Fails |
| ACIS/F3D imported geometry | ✗ Fails |
| Large face counts (1000+) | ✗ Often fails |

The error typically occurs during `writer.Write()` after `writer.Transfer()` succeeds.

## Root Cause

This error is caused by a WASM function table linking issue in Emscripten-compiled code. The `getWasmTableEntry` function is used internally to look up function pointers in the WebAssembly table, but under certain conditions (particularly with complex geometry that exercises rarely-used code paths), the function table entries become invalid or inaccessible.

Possible contributing factors:
- **Complex B-spline serialization**: STEP writer uses different code paths for B-spline geometry
- **LTO (Link-Time Optimization)**: The `-flto` flag may cause function table issues
- **Dead code elimination**: Aggressive optimization may remove required internal functions
- **Virtual function tables**: Complex geometry uses more virtual method dispatch

## Workarounds

### 1. Use BREP Export (Recommended)

BREP export works reliably and can be used as a fallback:

```javascript
function exportShape(oc, shape, outputPath) {
  // Try STEP first
  try {
    const writer = new oc.STEPControl_Writer_1()
    const progressRange = new oc.Message_ProgressRange_1()
    writer.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true, progressRange)
    writer.Write('/tmp/output.step')
    const content = oc.FS.readFile('/tmp/output.step', { encoding: 'utf8' })
    oc.FS.unlink('/tmp/output.step')
    return { format: 'step', content }
  } catch (stepError) {
    console.warn('STEP export failed, falling back to BREP:', stepError.message)
  }

  // Fallback to BREP
  const progressRange = new oc.Message_ProgressRange_1()
  oc.BRepTools.Write_3(shape, '/tmp/output.brep', progressRange)
  const content = oc.FS.readFile('/tmp/output.brep', { encoding: 'utf8' })
  oc.FS.unlink('/tmp/output.brep')
  return { format: 'brep', content }
}
```

### 2. Convert BREP to STEP Externally

If STEP format is required, you can:
1. Export to BREP from OpenCascade.js
2. Use a server-side tool (FreeCAD, native OpenCascade, etc.) to convert BREP to STEP

### 3. Use replicad's OpenCascade.js Build

The replicad project provides OpenCascade.js builds that work for STEP export with simple geometry:

```javascript
// From: https://github.com/sgenoud/replicad/tree/main/packages/replicad-opencascadejs
import initOpenCascade from './replicad_single.js'
const oc = await initOpenCascade()

// STEP export works for primitives
const box = new oc.BRepPrimAPI_MakeBox_2(10, 20, 30)
const writer = new oc.STEPControl_Writer_1()
writer.Transfer(box.Shape(), oc.STEPControl_StepModelType.STEPControl_AsIs, true, new oc.Message_ProgressRange_1())
writer.Write('/tmp/output.step')  // Works!
```

Note: replicad builds still have the `getWasmTableEntry` issue with complex B-spline geometry.

### 4. Use the npm Package

The official `opencascade.js` npm package (built with different settings) may not have this issue:

```javascript
import initOpenCascade from 'opencascade.js'
const oc = await initOpenCascade()
```

### 4. Rebuild Without LTO

If building custom WASM, try removing the `-flto` flag:

```yaml
# In your build YAML configuration
emccFlags:
  # - -flto  # Comment out or remove LTO
  - -fexceptions
  - -O3
  - -sEXPORT_ES6=1
  # ... other flags
```

## Testing

A test script is available to verify STEP export functionality:

```bash
# Run the F3D to STEP test
node test-f3d-all-builds.mjs /path/to/your/file.f3d
```

This will test all available builds and report which export methods work.

## Related Issues

- OpenCascade.js GitHub: Search for "getWasmTableEntry" or "STEP export"
- Emscripten issue tracker: WASM function table issues
- The `Standard_OStream` binding limitation (see `OSTREAM_BINDING_FIX_PLAN.md`)

## File Formats Comparison

| Format | Export Status | File Size | Compatibility |
|--------|--------------|-----------|---------------|
| STEP | ✗ (error) | - | Industry standard |
| BREP | ✓ Works | ~3 MB | OpenCascade native |
| STL | ✓ Works | Varies | Mesh only, no B-rep |
| IGES | Untested | - | Legacy format |

## Conclusion

Until the `getWasmTableEntry` issue is resolved, **use BREP export** as the primary method for exporting B-rep geometry from OpenCascade.js. BREP files can be converted to STEP using external tools if needed.

For applications that must have STEP output directly from the browser, consider:
1. A server-side conversion endpoint
2. Using a different CAD kernel that supports STEP export in WASM
3. Contributing a fix to the OpenCascade.js project
