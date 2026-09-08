import * as fs from 'fs';
import * as path from 'path';

import { CoreModuleIsolation } from '../CoreModuleIsolation';

describe('CoreModuleIsolation', () => {

    describe('getGuardedCoreModules', () => {

        test('names each module rather than deriving the name from its position', () => {

            const guardedCoreModules = CoreModuleIsolation.getGuardedCoreModules();

            expect(guardedCoreModules.map(guarded => guarded.moduleName)).toEqual(['fs', 'fs.promises']);
            expect(guardedCoreModules[0].coreModule).toBe(fs);
            expect(guardedCoreModules[1].coreModule).toBe(fs.promises);

        });

    });

    describe('captureFunctions', () => {

        test('given the guarded core modules, captures fs and fs.promises separately', () => {

            const capturedSnapshots = CoreModuleIsolation.captureFunctions(CoreModuleIsolation.getGuardedCoreModules());

            expect(capturedSnapshots.map(snapshot => snapshot.moduleName)).toEqual(['fs', 'fs.promises']);
            expect(capturedSnapshots[0].functionsByName['existsSync']).toBe(fs.existsSync);
            expect(capturedSnapshots[1].functionsByName['readdir']).toBe(fs.promises.readdir);

        });

        test('given a non enumerable function property, captures it anyway', () => {

            const moduleWithHiddenFunction = {};
            const hiddenFunction = () => undefined;
            Object.defineProperty(moduleWithHiddenFunction, 'hidden', {
                value: hiddenFunction,
                enumerable: false,
                writable: true,
                configurable: true
            });

            const capturedSnapshots = CoreModuleIsolation.captureFunctions([
                { moduleName: 'probe', coreModule: moduleWithHiddenFunction as Record<string, unknown> }
            ]);

            expect(capturedSnapshots[0].functionsByName['hidden']).toBe(hiddenFunction);

        });

        test('given a getter with no setter, leaves it out rather than invoking it', () => {

            let getterInvocationCount = 0;
            const moduleWithReadOnlyGetter = {};
            Object.defineProperty(moduleWithReadOnlyGetter, 'lazilyBuilt', {
                configurable: true,
                get: () => {
                    getterInvocationCount++;
                    return () => undefined;
                }
            });

            const capturedSnapshots = CoreModuleIsolation.captureFunctions([
                { moduleName: 'probe', coreModule: moduleWithReadOnlyGetter as Record<string, unknown> }
            ]);

            expect(getterInvocationCount).toBe(0);
            expect(Object.keys(capturedSnapshots[0].functionsByName)).not.toContain('lazilyBuilt');
            expect(Object.keys(capturedSnapshots[0].accessorFunctionsByName)).not.toContain('lazilyBuilt');

        });

        /*
            On Node 20 fs.opendir, fs.opendirSync, fs.Dir, fs.ReadStream and fs.WriteStream are
            getter/SETTER pairs, so an assignment to one sticks. Skipping every accessor property
            left the guard blind to exactly the directory and stream APIs the original failure rode
            in on.
        */
        test('given a getter with a setter, captures it because an assignment to it sticks', () => {

            const capturedSnapshots = CoreModuleIsolation.captureFunctions(CoreModuleIsolation.getGuardedCoreModules());
            const fsSnapshot = capturedSnapshots[0];

            const accessorBackedFunctionNames = Object.getOwnPropertyNames(fs).filter(propertyName => {
                const descriptor = Object.getOwnPropertyDescriptor(fs, propertyName);
                return descriptor?.get !== undefined && descriptor?.set !== undefined;
            });

            expect(accessorBackedFunctionNames.length).toBeGreaterThan(0);
            for (const accessorBackedFunctionName of accessorBackedFunctionNames) {
                if (typeof (fs as unknown as Record<string, unknown>)[accessorBackedFunctionName] === 'function') {
                    expect(fsSnapshot.accessorFunctionsByName[accessorBackedFunctionName]).toBeDefined();
                }
            }

        });

        test('given a getter that throws, skips it rather than failing the capture', () => {

            const moduleWithThrowingAccessor = {};
            Object.defineProperty(moduleWithThrowingAccessor, 'explodes', {
                configurable: true,
                get: () => { throw new Error('nope'); },
                set: () => undefined
            });

            const capturedSnapshots = CoreModuleIsolation.captureFunctions([
                { moduleName: 'probe', coreModule: moduleWithThrowingAccessor as Record<string, unknown> }
            ]);

            expect(Object.keys(capturedSnapshots[0].accessorFunctionsByName)).toEqual([]);

        });

        /*
            Object.getOwnPropertyNames and getOwnPropertyDescriptor agree for an ordinary object, so
            this branch is unreachable through fs itself. It is kept because captureFunctions takes
            any Record, and a proxy is allowed to report an own key it then declines to describe --
            an exotic object would otherwise throw inside the guard rather than be skipped by it.
        */
        test('given an object reporting a key it will not describe, skips that key rather than throwing', () => {

            const objectReportingAnUndescribableKey = new Proxy({} as Record<string, unknown>, {
                ownKeys: () => ['ghost'],
                getOwnPropertyDescriptor: () => undefined
            });

            const capturedSnapshots = CoreModuleIsolation.captureFunctions([
                { moduleName: 'probe', coreModule: objectReportingAnUndescribableKey }
            ]);

            expect(capturedSnapshots[0].functionsByName).toEqual({});
            expect(capturedSnapshots[0].accessorFunctionsByName).toEqual({});

        });

        test('given non function properties, captures only the functions', () => {

            const moduleWithMixedProperties = {
                constants: { SOME_FLAG: 1 },
                doSomething: () => undefined
            };

            const capturedSnapshots = CoreModuleIsolation.captureFunctions([
                { moduleName: 'probe', coreModule: moduleWithMixedProperties as unknown as Record<string, unknown> }
            ]);

            expect(Object.keys(capturedSnapshots[0].functionsByName)).toEqual(['doSomething']);

        });

    });

    describe('captureFunctionsOncePerWorker', () => {

        /*
            Pins the baseline against a leak that has already crossed a file boundary: a later call
            must hand back the FIRST snapshot rather than treating the current, poisoned state as
            truth. Per-file capture contains the defect this guard was written for; this asserts the
            weaker, cheaper property that the baseline cannot drift, which per-file capture does not
            have.
        */
        test('given a later call, returns the first snapshot rather than capturing the current state', () => {

            const firstSnapshots = CoreModuleIsolation.captureFunctionsOncePerWorker();

            const leakedReaddir = jest.fn();
            (fs.promises as unknown as Record<string, unknown>).readdir = leakedReaddir;

            const secondSnapshots = CoreModuleIsolation.captureFunctionsOncePerWorker();

            expect(secondSnapshots).toBe(firstSnapshots);
            expect(secondSnapshots[1].functionsByName['readdir']).not.toBe(leakedReaddir);

            expect(CoreModuleIsolation.restoreFunctions(secondSnapshots)).toEqual(['fs.promises.readdir']);
            expect(jest.isMockFunction(fs.promises.readdir)).toBe(false);

        });

        test('stashes the snapshot without adding an enumerable property to fs', () => {

            CoreModuleIsolation.captureFunctionsOncePerWorker();

            const stashSymbol = Object.getOwnPropertySymbols(fs)
                .find(ownSymbol => ownSymbol === Symbol.for('treecipe.coreModuleFunctionSnapshots'));

            expect(stashSymbol).toBeDefined();
            expect(Object.getOwnPropertyDescriptor(fs, stashSymbol!)?.enumerable).toBe(false);

        });

    });

    describe('restoreFunctions', () => {

        test('given a function replaced by assignment, puts the original back and names it', () => {

            const originalReaddir = fs.promises.readdir;
            const capturedSnapshots = CoreModuleIsolation.captureFunctions(CoreModuleIsolation.getGuardedCoreModules());

            (fs.promises as unknown as Record<string, unknown>).readdir = jest.fn();

            const restoredFunctionNames = CoreModuleIsolation.restoreFunctions(capturedSnapshots);

            expect(restoredFunctionNames).toEqual(['fs.promises.readdir']);
            expect(fs.promises.readdir).toBe(originalReaddir);

        });

        test('given an accessor backed function replaced by assignment, puts that back too', () => {

            const originalOpendir = fs.opendir;
            const capturedSnapshots = CoreModuleIsolation.captureFunctions(CoreModuleIsolation.getGuardedCoreModules());

            (fs as unknown as Record<string, unknown>).opendir = jest.fn();
            expect(jest.isMockFunction(fs.opendir)).toBe(true);

            const restoredFunctionNames = CoreModuleIsolation.restoreFunctions(capturedSnapshots);

            expect(restoredFunctionNames).toEqual(['fs.opendir']);
            expect(fs.opendir).toBe(originalOpendir);

        });

        test('given nothing replaced, restores nothing rather than reassigning every function', () => {

            const capturedSnapshots = CoreModuleIsolation.captureFunctions(CoreModuleIsolation.getGuardedCoreModules());

            expect(CoreModuleIsolation.restoreFunctions(capturedSnapshots)).toEqual([]);

        });

    });

    /*
        The regression the guard exists for. The first test replaces fs.promises.readdir the way
        VSCodeWorkspaceService.test.ts used to -- by assignment, which restoreMocks cannot undo --
        and with the answer that caused the CI heap failures: every path reads as two subdirectories,
        so any recursive walk branches forever. The second test is what an unrelated suite scheduled
        next onto the same worker sees. Without the afterEach in setupCoreModuleIsolation it sees the
        canned function; the assertions below fail rather than the next suite exhausting its heap.
    */
    describe('a core module function replaced by assignment', () => {

        const readdirBeforeAnyTestReplacedIt = fs.promises.readdir;

        test('is replaced for the test that wrote it', async () => {

            (fs.promises as unknown as Record<string, unknown>).readdir = jest.fn().mockResolvedValue([
                { name: 'other1', isDirectory: () => true },
                { name: 'other2', isDirectory: () => true }
            ]);

            const entries = await fs.promises.readdir('/a/path/that/does/not/exist');

            expect(entries).toHaveLength(2);

        });

        test('does not survive into the next test, which reads the real filesystem', async () => {

            expect(jest.isMockFunction(fs.promises.readdir)).toBe(false);
            expect(fs.promises.readdir).toBe(readdirBeforeAnyTestReplacedIt);

            const jestSetupDirectoryEntries = await fs.promises.readdir(path.resolve(__dirname, '..'));

            expect(jestSetupDirectoryEntries).toContain('CoreModuleIsolation.ts');

        });

    });

});
