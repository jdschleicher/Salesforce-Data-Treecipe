import { CoreModuleIsolation } from './CoreModuleIsolation';

/*
    setupFilesAfterEnv runs once per test file, before the file itself is loaded, so this snapshot is
    always of the pristine core modules rather than of whatever a previous suite left behind.
*/
const coreModuleFunctionSnapshots = CoreModuleIsolation.captureFunctions(
    CoreModuleIsolation.getGuardedCoreModules()
);

/*
    afterEach rather than afterAll: restoreMocks already puts jest.spyOn replacements back between
    tests, so matching that cadence means an unrestorable assignment costs one test rather than
    every test after it in the file. Hooks registered here are the outermost ones, so they run LAST
    among afterEach hooks -- a suite's own afterEach can still assert against its spies.
*/
afterEach(() => {

    CoreModuleIsolation.restoreFunctions(coreModuleFunctionSnapshots);

});
