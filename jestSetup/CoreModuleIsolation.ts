import * as fs from 'fs';

export interface GuardedCoreModule {
    moduleName: string;
    coreModule: Record<string, unknown>;
}

export interface CoreModuleFunctionSnapshot {
    moduleName: string;
    coreModule: Record<string, unknown>;
    functionsByName: Record<string, unknown>;
    accessorFunctionsByName: Record<string, unknown>;
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

    This restores core module functions to what they were when the WORKER started, so a replacement
    costs the test that wrote it rather than an unrelated suite scheduled after it.
*/
export class CoreModuleIsolation {

    /*
        The snapshot is stashed on the fs module object itself, under a symbol, because that object
        is the one thing here that is genuinely per-worker: the setup file is re-evaluated for every
        test file, so a module-scoped variable would be per-FILE, and testEnvironment 'node' gives
        each file its own globalThis, so a global would be too.

        Per-file capture demonstrably CONTAINS the defect this guard was written for: that leak is
        installed inside a test body, so the file's own afterEach restores it before the file ends.
        Capturing once per worker is the conservative baseline rather than a fix for a reproduced
        hole -- review raised the case of a leak installed in afterAll, which no afterEach can undo,
        and attempts to demonstrate per-file capture ADOPTING such a leak gave results that did not
        reproduce across runs. The probe was unreliable, so it settled nothing either way.

        It is done this way regardless, because "whatever is on the object when this file started"
        is not a defensible definition of pristine, and the earliest observed state is. It costs one
        symbol and one branch.
    */
    private static readonly WORKER_SNAPSHOT_KEY = Symbol.for('treecipe.coreModuleFunctionSnapshots');

    static getGuardedCoreModules(): GuardedCoreModule[] {

        /*
            fs and fs.promises are separate objects and a replacement on one is invisible to the
            other, so both are guarded. Only these two: they are the core module surface this
            project's tests replace, and the surface a recursive walk reads.
        */
        return [
            { moduleName: 'fs', coreModule: fs as unknown as Record<string, unknown> },
            { moduleName: 'fs.promises', coreModule: fs.promises as unknown as Record<string, unknown> }
        ];

    }

    static captureFunctions(guardedCoreModules: GuardedCoreModule[]): CoreModuleFunctionSnapshot[] {

        return guardedCoreModules.map(guardedCoreModule => {

            const functionsByName: Record<string, unknown> = {};
            const accessorFunctionsByName: Record<string, unknown> = {};
            const coreModule = guardedCoreModule.coreModule;

            /*
                getOwnPropertyNames rather than Object.keys: a non-enumerable function property is
                just as assignable as an enumerable one, and which of fs's properties are enumerable
                is a Node implementation detail rather than a promise to this file.
            */
            for (const propertyName of Object.getOwnPropertyNames(coreModule)) {

                const propertyDescriptor = Object.getOwnPropertyDescriptor(coreModule, propertyName);

                if (propertyDescriptor === undefined) {
                    continue;
                }

                const isRestorableDataProperty = propertyDescriptor.get === undefined
                                                    && propertyDescriptor.set === undefined
                                                    && propertyDescriptor.writable === true
                                                    && propertyDescriptor.configurable === true
                                                    && typeof propertyDescriptor.value === 'function';

                if (isRestorableDataProperty) {
                    functionsByName[propertyName] = propertyDescriptor.value;
                    continue;
                }

                /*
                    An accessor pair with a SETTER is assignable -- on Node 20 fs.opendir,
                    fs.opendirSync, fs.Dir, fs.ReadStream and fs.WriteStream are exactly that, and
                    they are directory and stream APIs, the same class of call the failure rode in
                    on. An assignment to one of these sticks, so skipping every accessor property
                    (as an earlier version of this file did, on the reasoning that "a getter is not
                    something an assignment could have replaced") left a hole precisely where it
                    mattered most.

                    A getter with no setter stays skipped: nothing can assign through it, and
                    invoking it to find that out would run whatever it does.
                */
                const isRestorableAccessorProperty = propertyDescriptor.get !== undefined
                                                        && propertyDescriptor.set !== undefined
                                                        && propertyDescriptor.configurable === true;

                if (isRestorableAccessorProperty) {

                    try {

                        const currentValue = (coreModule as Record<string, unknown>)[propertyName];

                        if (typeof currentValue === 'function') {
                            accessorFunctionsByName[propertyName] = currentValue;
                        }

                    } catch {
                        // A getter that throws is one this guard cannot describe, so it is left alone.
                    }

                }

            }

            return {
                moduleName: guardedCoreModule.moduleName,
                coreModule: coreModule,
                functionsByName: functionsByName,
                accessorFunctionsByName: accessorFunctionsByName
            };

        });

    }

    /*
        Captures once per worker and hands back the same snapshot on every later call, so the
        baseline cannot drift toward whatever a previous file left behind.
    */
    static captureFunctionsOncePerWorker(): CoreModuleFunctionSnapshot[] {

        const snapshotHost = fs as unknown as Record<symbol, CoreModuleFunctionSnapshot[] | undefined>;
        const alreadyCaptured = snapshotHost[CoreModuleIsolation.WORKER_SNAPSHOT_KEY];

        if (alreadyCaptured !== undefined) {
            return alreadyCaptured;
        }

        const coreModuleFunctionSnapshots = CoreModuleIsolation.captureFunctions(
            CoreModuleIsolation.getGuardedCoreModules()
        );

        Object.defineProperty(fs, CoreModuleIsolation.WORKER_SNAPSHOT_KEY, {
            value: coreModuleFunctionSnapshots,
            enumerable: false,
            writable: false,
            configurable: true
        });

        return coreModuleFunctionSnapshots;

    }

    /*
        Returns what it had to put back, named as "fs.promises.readdir" rather than as "readdir", so
        a caller reporting a leak names something the reader can grep for. Compares before writing:
        reassigning every guarded property after each of the suite's tests would churn the hidden
        class of an object every suite uses, for no change.
    */
    static restoreFunctions(coreModuleFunctionSnapshots: CoreModuleFunctionSnapshot[]): string[] {

        const restoredFunctionNames: string[] = [];

        for (const coreModuleFunctionSnapshot of coreModuleFunctionSnapshots) {

            const coreModule = coreModuleFunctionSnapshot.coreModule;

            const capturedEntries = [
                ...Object.entries(coreModuleFunctionSnapshot.functionsByName),
                ...Object.entries(coreModuleFunctionSnapshot.accessorFunctionsByName)
            ];

            for (const [functionName, capturedFunction] of capturedEntries) {

                if (coreModule[functionName] !== capturedFunction) {

                    coreModule[functionName] = capturedFunction;
                    restoredFunctionNames.push(`${coreModuleFunctionSnapshot.moduleName}.${functionName}`);

                }

            }

        }

        return restoredFunctionNames;

    }

}
