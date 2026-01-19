import type init from "./ocjs.custom.index";
import type { OpenCascadeInstance } from "./ocjs.custom.index";

export * from "./ocjs.custom.index";

type OpenCascadeModuleObject = {
    [key: string]: any;
};

export default function initOpenCascade(settings?: {
    mainJS?: init;
    mainWasm?: string;
    worker?: string;
    libs?: string[];
    module?: OpenCascadeModuleObject;
}): Promise<OpenCascadeInstance>;
