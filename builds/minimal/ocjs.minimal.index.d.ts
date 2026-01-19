import type init from "./ocjs.minimal.index";
import type { OpenCascadeInstance } from "./ocjs.minimal.index";

export * from "./ocjs.minimal.index";

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
