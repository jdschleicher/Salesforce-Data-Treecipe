import * as childProcess from 'child_process';

export type PythonTestMode = 'run' | 'skip' | 'fail';

export type SnowfakeryJinjaRenderResult = { rendered?: string, error?: string };

/*
    The recipe checks that need python3 -- PyYAML, snowfakery's parser, and Jinja, its template
    engine. Neither is a dependency of this extension, so a check that needs one runs where python3
    has it and is skipped where it does not -- EXCEPT in CI, where a missing module FAILS the test
    instead. A skip is green, and checkJestTestCoverage.ps1 does not count skips, so a runner image
    that stopped shipping PyYAML would otherwise switch the snowfakery-side checks off without anyone
    being told (#158). It fails the TEST, not the suite: a throw while collecting would take down
    every js-yaml check in the same file with it.
*/
export class PythonTestHarness {

    static readonly installCommand = 'python3 -m pip install PyYAML Jinja2';

    static isModuleImportable(moduleName: string): boolean {

        try {
            childProcess.execFileSync('python3', ['-c', `import ${moduleName}`], { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }

    }

    // GITHUB ACTIONS SETS CI=true; ANY OTHER NON-EMPTY VALUE BUT "false" IS READ AS SET TOO
    static isRunningInCI(): boolean {

        const ciValue = process.env.CI;
        return ciValue !== undefined && ciValue !== '' && ciValue.toLowerCase() !== 'false';

    }

    static findMissingModules(moduleNames: string[]): string[] {

        return moduleNames.filter(moduleName => !PythonTestHarness.isModuleImportable(moduleName));

    }

    static selectTestMode(moduleNames: string[]): PythonTestMode {

        if ( PythonTestHarness.findMissingModules(moduleNames).length === 0 ) {
            return 'run';
        }
        return PythonTestHarness.isRunningInCI() ? 'fail' : 'skip';

    }

    static buildMissingModuleMessage(missingModuleNames: string[]): string {

        return `python3 cannot import ${missingModuleNames.join(', ')}, and CI is set, so this check fails rather than skipping. `
            + `Install it with: ${PythonTestHarness.installCommand}`;

    }

    static buildFailingTestBody(missingModuleNames: string[]): () => never {

        const missingModuleMessage = PythonTestHarness.buildMissingModuleMessage(missingModuleNames);
        return () => {
            throw new Error(missingModuleMessage);
        };

    }

    /*
        Use in place of `test` for a check that needs the named modules. Returns `test` or `test.skip`
        themselves, or -- in CI with a module missing -- a stand-in that registers the SAME test names,
        `.each` included, with a body that fails naming what to install.
    */
    static testRequiringModules(...moduleNames: string[]): jest.It {

        const testMode = PythonTestHarness.selectTestMode(moduleNames);
        if ( testMode === 'run' ) {
            return test;
        }
        if ( testMode === 'skip' ) {
            return test.skip;
        }

        return PythonTestHarness.buildFailingStandIn(PythonTestHarness.buildFailingTestBody(PythonTestHarness.findMissingModules(moduleNames)));

    }

    // THE REGISTRAR IS A PARAMETER SO A TEST CAN CALL THE STAND-IN WITHOUT REGISTERING A TEST INSIDE A TEST
    static buildFailingStandIn(failingTestBody: () => never, registerTest: jest.It = test): jest.It {

        const failingTest = (testName: string) => registerTest(testName, failingTestBody);
        const failingTestEach = (table: ReadonlyArray<unknown>) => (testName: string) => registerTest.each(table as unknown[][])(testName, failingTestBody);
        return Object.assign(failingTest, { each: failingTestEach }) as unknown as jest.It;

    }

    // ONE INTERPRETER PER CALL: JSON IN ON STDIN, JSON OUT ON STDOUT, SO NO VALUE EVER PASSES THROUGH A COMMAND LINE
    static runPython(script: string, input: unknown): unknown {

        const output = childProcess.execFileSync('python3', ['-c', script], { input: JSON.stringify(input), encoding: 'utf-8' });
        return JSON.parse(output);

    }

    static loadWithPyYaml(yamlTexts: string[]): unknown[] {

        return PythonTestHarness.runPython([
            'import json, sys, yaml',
            'print(json.dumps([yaml.safe_load(text) for text in json.load(sys.stdin)]))'
        ].join('\n'), yamlTexts) as unknown[];

    }

    /*
        A copy of snowfakery's JinjaTemplateEvaluatorFactory in its DEFAULT mode (snowfakery_version 2):
        two environments, "${{" / "${%" and the legacy "<<" / "<%", and a string is compiled by the first
        whose start delimiter it contains -- or not compiled at all, and returned as it is. The legacy one
        is why a value with no "${" in it can still be a template. Each item is rendered with the given
        context; a render that raises is reported as { error } rather than failing the batch.
    */
    static renderWithSnowfakeryJinja(templates: Array<{ template: string, context?: Record<string, unknown> }>): SnowfakeryJinjaRenderResult[] {

        return PythonTestHarness.runPython([
            'import json, sys, jinja2',
            'compilers = [',
            '    jinja2.Environment(block_start_string="${%", block_end_string="%}", variable_start_string="${{", variable_end_string="}}"),',
            '    jinja2.Environment(block_start_string="<%", block_end_string="%>", variable_start_string="<<", variable_end_string=">>"),',
            ']',
            // DETERMINISTIC STAND-INS FOR snowfakery'S random_choice AND faker'S random_sample: THE FIRST OPTION, SO A TEST CAN SAY WHICH VALUE IT GETS
            'class DeterministicFake:',
            '    def random_sample(self, elements):',
            '        return list(elements)[:1]',
            'for compiler in compilers:',
            '    compiler.globals.update(random_choice=lambda *options: options[0], fake=DeterministicFake())',
            'def compiler_for_string(definition):',
            '    for compiler in compilers:',
            '        for start_string in (compiler.block_start_string, compiler.variable_start_string):',
            '            if start_string in definition:',
            '                return compiler',
            '    return None',
            'results = []',
            'for item in json.load(sys.stdin):',
            '    try:',
            '        compiler = compiler_for_string(item["template"])',
            '        rendered = compiler.from_string(item["template"]).render(**(item.get("context") or {})) if compiler else item["template"]',
            '        results.append({"rendered": rendered})',
            '    except Exception as render_error:',
            '        results.append({"error": str(render_error)})',
            'print(json.dumps(results))'
        ].join('\n'), templates) as SnowfakeryJinjaRenderResult[];

    }

}
