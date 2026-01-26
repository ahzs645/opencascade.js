// OCJS_IO: IGES export to string
// Requires: ocjs_io_common.cpp
#include <IGESControl_Writer.hxx>
#include <IGESControl_Controller.hxx>

  // IGES export to string - returns IGES file content as string
  static std::string IGES_WriteToString(const TopoDS_Shape& shape) {
    IGESControl_Controller::Init();
    IGESControl_Writer writer;
    writer.AddShape(shape);
    writer.ComputeModel();
    std::ostringstream ss;
    writer.Write(ss, Standard_False);
    return ss.str();
  }
