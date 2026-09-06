import * as fs from 'fs';

export interface CoreModuleFunctionSnapshot {
    moduleName: string;
    coreModule: Record<string, unknown>;
    functionsByName: Record<string, unknown>;
}

/*
    Jest gives every test file its own module registry, but a NODE CORE module is not part of it:
    require('fs') hands every suite in a worker the same object. So a replacement written onto that
    object outlives the file that wrote it, and restoreMocks cannot undo one, because restoreMocks
    only restores what jest.spyOn registered -- a plain assignment leaves jest nothing to restore.

    That is what produced the intermittent CI heap failures. A test assigned fs.promises.readdir a
    function answering EVERY path with two entries, both directories, and it stayed installed for
    the rest of that worker. DirectoryProcessor.processDirectory descends into every directory it is
    handed, so the directory walk in the next suite jest scheduled onto that worker branched forever
    and exhausted the 4 GB heap. Jest reported it against whichever suite was running -- never the
    one that left the function behind -- which is why the failure looked like a memory problem in
    code that had none.

    This restores core module functions to what they were when the suite started, so a replacement
    costs the test that wrote it rather than an unrelated suite scheduled after it.
*/
export class CoreModuleIsolation {

    static getGuardedCoreModules(): CoreModuleFunctionSnapshot['coreModule'][] {

        /*
            fs and fs.promises are separate objects and a spy on one is invisible to the other, so
            both are captured. Only these two are guarded: they are the core module surface this
            project's tests replace, and they are the surface a recursive walk reads.
        */
        return [
            fs as unknown as Record<string, unknown>,
            fs.promises as unknown as Record<string, unknown>
        ];

    }

    static captureFunctions(coreModules: Record<string, unknown>[]): CoreModuleFunctionSnapshot[] {

        return coreModules.map((coreModule, coreModuleIndex) => {

            const functionsByName: Record<string, unknown> = {};

            for (const propertyName of Object.keys(coreModule)) {

                /*
                    Read through a descriptor rather than by property access: a getter that throws or
                    that builds a new value per read would otherwise be invoked here, and a getter is
                    not something an assignment could have replaced anyway.
                */
                const propertyDescriptor = Object.getOwnPropertyDescriptor(coreModule, propertyName);

                const isPlainFunctionProperty = propertyDescriptor !== undefined
                                                    && propertyDescriptor.get === undefined
                                                    && propertyDescriptor.writable === true
                                                    && propertyDescriptor.configurable === true
                                                    && typeof propertyDescriptor.value === 'function';

                if (isPlainFunctionProperty) {
                    functionsByName[propertyName] = propertyDescriptor.value;
                }

            }

            return {
                moduleName: coreModuleIndex === 0 ? 'fs' : 'fs.promises',
                coreModule: coreModule,
                functionsByName: functionsByName
            };

        });

    }

    /*
        Returns what it had to put back, named as "fs.promises.readdir" rather than as "readdir", so a
        caller reporting a leak names something the reader can grep for.
    */
    static restoreFunctions(coreModuleFunctionSnapshots: CoreModuleFunctionSnapshot[]): string[] {

        const restoredFunctionNames: string[] = [];

        for (const coreModuleFunctionSnapshot of coreModuleFunctionSnapshots) {

            for (const [functionName, capturedFunction] of Object.entries(coreModuleFunctionSnapshot.functionsByName)) {

                if (coreModuleFunctionSnapshot.coreModule[functionName] !== capturedFunction) {

                    coreModuleFunctionSnapshot.coreModule[functionName] = capturedFunction;
                    restoredFunctionNames.push(`${coreModuleFunctionSnapshot.moduleName}.${functionName}`);

                }

            }

        }

        return restoredFunctionNames;

    }

}
