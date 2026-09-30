import * as childProcess from 'child_process';
import { PythonTestHarness } from './mocks/PythonTestHarness';

/*
    #158. The gate every PyYAML / Jinja check goes through. The probe is stubbed, so these run the
    same with or without python3; CI is set and cleared explicitly, because GitHub Actions sets it and
    a developer machine does not.
*/
describe('PythonTestHarness', () => {

    const originalCIValue = process.env.CI;

    afterEach(() => {
        if ( originalCIValue === undefined ) {
            delete process.env.CI;
        } else {
            process.env.CI = originalCIValue;
        }
    });

    const stubImportableModules = (importableModuleNames: string[]) => {
        return jest.spyOn(childProcess, 'execFileSync').mockImplementation(((executable: string, commandArguments: string[]) => {
            const importedModuleName = commandArguments[1].replace(/^import /, '');
            if ( !importableModuleNames.includes(importedModuleName) ) {
                throw new Error(`ModuleNotFoundError: No module named '${importedModuleName}'`);
            }
            return Buffer.from('');
        }) as unknown as typeof childProcess.execFileSync);
    };

    describe('selectTestMode', () => {

        test.each([
            ['importable, CI set', ['yaml'], 'true', 'run'],
            ['importable, CI not set', ['yaml'], undefined, 'run'],
            ['missing, CI not set', [], undefined, 'skip'],
            ['missing, CI set to false', [], 'false', 'skip'],
            ['missing, CI set', [], 'true', 'fail'],
            ['missing, CI set to 1', [], '1', 'fail']
        ] as const)('%s -> %s', (unusedDescription, importableModuleNames, ciValue, expectedTestMode) => {

            stubImportableModules([...importableModuleNames]);
            if ( ciValue === undefined ) {
                delete process.env.CI;
            } else {
                process.env.CI = ciValue;
            }

            expect(PythonTestHarness.selectTestMode(['yaml'])).toBe(expectedTestMode);

        });

        test('probes each module by importing it with python3, and nothing else', () => {

            const execFileSyncSpy = stubImportableModules(['yaml', 'jinja2']);

            PythonTestHarness.selectTestMode(['yaml', 'jinja2']);

            expect(execFileSyncSpy).toHaveBeenCalledWith('python3', ['-c', 'import yaml'], { stdio: 'ignore' });
            expect(execFileSyncSpy).toHaveBeenCalledWith('python3', ['-c', 'import jinja2'], { stdio: 'ignore' });

        });

        test('treats a missing python3 like a missing module', () => {

            jest.spyOn(childProcess, 'execFileSync').mockImplementation(() => {
                throw Object.assign(new Error('spawn python3 ENOENT'), { code: 'ENOENT' });
            });
            process.env.CI = 'true';

            expect(PythonTestHarness.selectTestMode(['yaml'])).toBe('fail');

        });

    });

    describe('testRequiringModules', () => {

        test('returns test itself when every module imports', () => {

            stubImportableModules(['yaml']);

            expect(PythonTestHarness.testRequiringModules('yaml')).toBe(test);

        });

        test('returns test.skip when a module is missing and CI is not set', () => {

            stubImportableModules([]);
            delete process.env.CI;

            expect(PythonTestHarness.testRequiringModules('yaml')).toBe(test.skip);

        });

        test('returns a failing stand-in, with .each, when a module is missing and CI is set', () => {

            stubImportableModules([]);
            process.env.CI = 'true';

            const gatedTest = PythonTestHarness.testRequiringModules('yaml');

            expect(gatedTest).not.toBe(test);
            expect(gatedTest).not.toBe(test.skip);
            expect(typeof gatedTest.each).toBe('function');

        });

    });

    describe('buildFailingStandIn', () => {

        const failingTestBody = PythonTestHarness.buildFailingTestBody(['yaml']);

        test('registers a test under the SAME name, whose body is the failing one', () => {

            const registerTest = jest.fn();

            PythonTestHarness.buildFailingStandIn(failingTestBody, registerTest as unknown as jest.It)('every recipe file loads with PyYAML', () => undefined);

            expect(registerTest).toHaveBeenCalledTimes(1);
            expect(registerTest).toHaveBeenCalledWith('every recipe file loads with PyYAML', failingTestBody);

        });

        test('registers .each rows under the same table and name template, whose body is the failing one', () => {

            const registerEachRow = jest.fn();
            const registerTest = Object.assign(jest.fn(), { each: jest.fn(() => registerEachRow) });
            const table = [['LF', 'a\nb'], ['CR', 'a\rb']];

            PythonTestHarness.buildFailingStandIn(failingTestBody, registerTest as unknown as jest.It).each(table)('a value with %s renders in Jinja', () => undefined);

            expect(registerTest.each).toHaveBeenCalledWith(table);
            expect(registerEachRow).toHaveBeenCalledWith('a value with %s renders in Jinja', failingTestBody);
            expect(registerTest).not.toHaveBeenCalled();

        });

    });

    describe('buildFailingTestBody', () => {

        test('throws naming only the missing module and how to install it', () => {

            stubImportableModules(['jinja2']);

            const failingTestBody = PythonTestHarness.buildFailingTestBody(PythonTestHarness.findMissingModules(['yaml', 'jinja2']));

            expect(failingTestBody).toThrow("python3 cannot import yaml, and CI is set, so this check fails rather than skipping. Install it with: python3 -m pip install PyYAML Jinja2");

        });

    });

});
