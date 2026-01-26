// OCJS_IO: BRep export to string
// Requires: ocjs_io_common.cpp
#include <BRepTools.hxx>

  // BRepTools::Write (ostream overload) -> std::string
  static std::string BRep_WriteToString(const TopoDS_Shape& shape) {
    std::ostringstream ss;
    BRepTools::Write(shape, ss);
    return ss.str();
  }
