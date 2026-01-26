// OCJS_IO: STEP export to string
// Requires: ocjs_io_common.cpp
#include <STEPControl_Writer.hxx>
#include <Interface_Static.hxx>

  // STEP export to string - returns STEP file content as string
  // Uses WriteStream (available in OCCT 7.7.0+)
  // mode: STEPControl_AsIs (0), STEPControl_ManifoldSolidBrep (1),
  //       STEPControl_FacetedBrep (2), STEPControl_ShellBasedSurfaceModel (3),
  //       STEPControl_GeometricCurveSet (4)
  static std::string STEP_WriteToString(const TopoDS_Shape& shape, STEPControl_StepModelType mode = STEPControl_AsIs) {
    STEPControl_Writer writer;
    IFSelect_ReturnStatus status = writer.Transfer(shape, mode);
    if (status != IFSelect_RetDone) {
      return ""; // Transfer failed
    }

    std::ostringstream ss;
    status = writer.WriteStream(ss);
    if (status != IFSelect_RetDone) {
      return ""; // Write failed
    }

    return ss.str();
  }
