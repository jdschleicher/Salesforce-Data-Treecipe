import * as fs from 'fs';
import * as path from 'path';

import { CoreModuleIsolation } from '../CoreModuleIsolation';

describe('CoreModuleIsolation', () => {

    describe('captureFunctions', () => {

        test('given the guarded core modules, captures fs and fs.promises separately', () => {

            const capturedSnapshots = CoreModuleIsolation.captureFunctions(CoreModuleIsolation.getGuardedCoreModules());

            expect(capturedSnapshots.map(snapshot => snapshot.moduleName)).toEqual(['fs', 'fs.promises']);
            expect(capturedSnapshots[0].functionsByName['existsSync']).toBe(fs.existsSync);
            expect(capturedSnapshots[1].functionsByName['readdir']).toBe(fs.promises.readdir);

        });

        test('given a getter backed property, leaves it out rather than invoking it', () => {

            let getterInvocationCount = 0;
            const moduleWithGetter = {};
            Object.defineProperty(moduleWithGetter, 'lazilyBuilt', {
                configurable: true,
                get: () => {
                    getterInvocationCount++;
                    return () => undefined;
                }
            });

            const capturedSnapshots = CoreModuleIsolation.captureFunctions([moduleWithGetter as Record<string, unknown>]);

            expect(getterInvocationCount).toBe(0);
            expect(Object.keys(capturedSnapshots[0].functionsByName)).not.toContain('lazilyBuilt');

        });

        test('given non function properties, captures only the functions', () => {

            const moduleWithMixedProperties = {
                constants: { SOME_FLAG: 1 },
                doSomething: () => undefined
            };

            const capturedSnapshots = CoreModuleIsolation.captureFunctions([moduleWithMixedProperties as unknown as Record<string, unknown>]);

            expect(Object.keys(capturedSnapshots[0].functionsByName)).toEqual(['doSomething']);

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

        test('given nothing replaced, restores nothing rather than reassigning every function', () => {

            const capturedSnapshots = CoreModuleIsolation.captureFunctions(CoreModuleIsolation.getGuardedCoreModules());

            expect(CoreModuleIsolation.restoreFunctions(capturedSnapshots)).toEqual([]);

        });

    });

    /*
        The regression the guard exists for. The first test replaces fs.promises.readdir the way
        VSCodeWorkspaceService.test.ts used to -- by assignment, which restoreMocks cannot undo -- and
        with the answer that caused the CI heap failures: every path reads as two subdirectories, so
        any recursive walk branches forever. The second test is what an unrelated suite scheduled next
        onto the same worker sees. Without the afterEach in setupCoreModuleIsolation it sees the
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
