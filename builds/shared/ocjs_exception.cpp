// OCJS Exception Helper
// Provides access to Standard_Failure exception data from JavaScript
class OCJS {
public:
  static Standard_Failure* getStandard_FailureData(intptr_t exceptionPtr) {
    return reinterpret_cast<Standard_Failure*>(exceptionPtr);
  }
};
