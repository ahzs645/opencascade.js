import type init from "./ocjs.full.index";
import type { OpenCascadeInstance } from "./ocjs.full.index";

export * from "./ocjs.full.index";

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
