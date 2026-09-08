import { CoreModuleIsolation } from './CoreModuleIsolation';

/*
    Captured once per WORKER rather than once per test file. setupFilesAfterEnv is re-evaluated for
    every test file, so capturing here unconditionally would take whatever the previous file left
    behind as this file's baseline. captureFunctionsOncePerWorker stashes the first snapshot on the
    shared fs object, so every file in the worker restores to the same set -- the earliest observed
    one, which is the only defensible definition of pristine available here.
*/
const coreModuleFunctionSnapshots = CoreModuleIsolation.captureFunctionsOncePerWorker();

/*
    afterEach rather than afterAll, matching restoreMocks' own cadence: an unrestorable assignment
    then costs one test rather than every test after it in the file.

    ORDERING, stated correctly because an earlier version of this comment had it backwards. Hooks
    registered from setupFilesAfterEnv and hooks registered at the top level of a test file are both
    hooks of jest-circus's ROOT describe block, and root-block afterEach hooks run in DECLARATION
    order -- setup files are evaluated before the test file, so THIS HOOK RUNS FIRST, not last.
    Hooks declared inside a describe still run before it, because jest-circus runs afterEach from
    the innermost block outwards.

    The consequence worth knowing: a file-scope afterEach that asserts on an fs spy would find the
    property already restored, since `fs.existsSync` no longer resolves to the spy object (the
    spy's own recorded calls are untouched). No suite in this repository does that today. Restoring
    early is still the right trade -- a spy that outlives its file is the failure this guard exists
    to prevent, and it cost four CI runs and three misdiagnoses to find.
*/
afterEach(() => {

    CoreModuleIsolation.restoreFunctions(coreModuleFunctionSnapshots);

});
