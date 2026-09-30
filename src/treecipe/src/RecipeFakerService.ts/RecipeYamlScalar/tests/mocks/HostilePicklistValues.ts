import * as childProcess from 'child_process';
import { RecordTypeWrapper } from '../../../../RecordTypeService/RecordTypesWrapper';
import { IRecipeFakerService } from '../../../IRecipeFakerService';

/*
    Picklist values a metadata author controls, shaped to break out of a generated recipe. Shared by
    both backends' suites and the recipe-writing tests so every sink is held to the same list.

    Every break either parser recognises: js-yaml ends a line only at \n and \r, PyYAML also at
    U+0085, U+2028 and U+2029. Each is followed by a line that would be a live field of the object
    if the break survived, carrying a marker the faker-js processor would set if it evaluated it.
*/
export const INJECTED_FIELD_API_NAME = 'Injected__c';
export const INJECTION_MARKER = '__treecipeInjectedByPicklistValue';
export const INJECTED_FIELD_LINE = `    ${INJECTED_FIELD_API_NAME}: \${{ globalThis.${INJECTION_MARKER} = true }}`;

export const LINE_BREAK_BY_NAME: Record<string, string> = {
    'LF': '\n',
    'CR': '\r',
    'CRLF': '\r\n',
    'NEL (U+0085)': '\u0085',
    'LS (U+2028)': '\u2028',
    'PS (U+2029)': '\u2029'
};

// A LINE BREAK AS EITHER PARSER SEES ONE; SPLITTING ON THIS COUNTS LINES THE WAY THE STRICTER OF THE TWO DOES
export const ANY_YAML_LINE_BREAK = /\r\n|\r|\n|\u0085|\u2028|\u2029/;

export const LINE_BREAK_PAYLOADS: Array<[string, string]> = Object.entries(LINE_BREAK_BY_NAME)
    .map(([lineBreakName, lineBreak]) => [lineBreakName, `before${lineBreak}${INJECTED_FIELD_LINE}`]);

export const QUOTE_PAYLOADS: Array<[string, string]> = [
    ['an apostrophe that closes a single-quoted string', "x' or True or '"],
    ['a backtick that closes a template literal', `a\`,globalThis.${INJECTION_MARKER}=true,\`b`],
    ['a template interpolation', `\${globalThis.${INJECTION_MARKER}=true}`],
    ['an expression opener', `\${{ globalThis.${INJECTION_MARKER} = true }}`],
    ['an expression closer', 'a}}b'],
    ['a trailing backslash', 'trailing\\'],
    ['a colon-space and a space-hash', 'Type: A #1'],
    // WHAT snowfakery WOULD RENDER, IN EACH OF ITS TEMPLATE SYNTAXES: RENDERED, THESE READ 49 AND X
    ['a snowfakery expression', '${{ 7*7 }}'],
    ['a legacy snowfakery expression', '<< 7*7 >>'],
    ['a legacy snowfakery block', '<% if true %>X<% endif %>']
];

// PLAIN, EACH OF THESE LOADS AS A BOOLEAN, NULL OR NUMBER IN AT LEAST ONE OF THE TWO YAML PARSERS
export const NON_STRING_SCALAR_PAYLOADS: Array<[string, string]> = [
    ['a YAML 1.1 boolean', 'Yes'],
    ['a YAML 1.1 boolean', 'No'],
    ['a YAML 1.1 boolean', 'on'],
    ['a boolean', 'true'],
    ['a null', 'null'],
    ['a null', '~'],
    ['an octal-looking number', '007'],
    ['a float', '1e3'],
    ['a hex number', '0x1F'],
    ['a date', '2024-01-01'],
    ['an infinity', '.inf']
];


export const HOSTILE_PICKLIST_VALUES: Array<[string, string]> = [...LINE_BREAK_PAYLOADS, ...QUOTE_PAYLOADS, ...NON_STRING_SCALAR_PAYLOADS];

export const ORDINARY_PICKLIST_VALUES = ["Rock 'n' Roll", 'A&B', 'C#', 'Some Value', 'Ohio_City'];

/*
    snowfakery reads recipes with PyYAML and evaluates ${{ }} with Jinja. Neither is a dependency of
    this extension, so a check that needs them is skipped where python3 lacks them -- except in CI,
    which installs both, where a missing module FAILS: a check that silently stops running is the
    one that lets U+2028 back in.
*/
export const isPythonModuleAvailable = (moduleName: string): boolean => {
    try {
        childProcess.execFileSync('python3', ['-c', `import ${moduleName}`], { stdio: 'ignore' });
        return true;
    } catch {
        if ( process.env.CI === 'true' ) {
            throw new Error(`python3 cannot import ${moduleName}; CI installs it so the recipe escaping checks run rather than skip`);
        }
        return false;
    }
};

// ONE INTERPRETER PER CALL: JSON IN ON STDIN, JSON OUT ON STDOUT, SO NO VALUE EVER PASSES THROUGH A COMMAND LINE
export const runPython = (script: string, input: unknown): unknown => {
    const output = childProcess.execFileSync('python3', ['-c', script], { input: JSON.stringify(input), encoding: 'utf-8' });
    return JSON.parse(output);
};

export const loadWithPyYaml = (yamlTexts: string[]): unknown[] => runPython([
    'import json, sys, yaml',
    'print(json.dumps([yaml.safe_load(text) for text in json.load(sys.stdin)]))'
].join('\n'), yamlTexts) as unknown[];

/*
    A copy of snowfakery's JinjaTemplateEvaluatorFactory in its DEFAULT mode (snowfakery_version 2):
    two environments, "${{" / "${%" and the legacy "<<" / "<%", and a string is compiled by the first
    whose start delimiter it contains -- or not compiled at all, and returned as it is. The legacy one
    is why a value with no "${" in it can still be a template. Each item is rendered with the given
    context; a render that raises is reported as { error } rather than failing the batch.
*/
export const renderWithSnowfakeryJinja = (templates: Array<{ template: string, context?: Record<string, unknown> }>): Array<{ rendered?: string, error?: string }> => runPython([
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
].join('\n'), templates) as Array<{ rendered?: string, error?: string }>;

export const CONTROLLING_FIELD_API_NAME = 'Controlling__c';
export const DEPENDENT_FIELD_API_NAME = 'Dependent__c';
export const MULTI_PICKLIST_FIELD_API_NAME = 'MultiPicklist__c';
export const OTHER_PICKLIST_VALUE = 'other';

/*
    One object whose three fields between them reach EVERY picklist-value sink a backend has: the
    default picklist and multi-select expressions, each record type's commented variant, a
    dependent picklist's when: condition and choices, a record type's dependent choices, and the
    TODO naming a controlling value a record type does not have. Laid out exactly as RecipeService
    writes a field -- four spaces, the api name, ": ", the value -- so it is the FILE that is judged.
*/
export const buildRecipeWithEveryPicklistSink = (fakerService: IRecipeFakerService, picklistValue: string): string => {

    const recordTypeByApiName: Record<string, RecordTypeWrapper> = {
        WithValue: {
            DeveloperName: 'WithValue',
            PicklistFieldSectionsToPicklistDetail: {
                [CONTROLLING_FIELD_API_NAME]: [picklistValue],
                [DEPENDENT_FIELD_API_NAME]: [picklistValue],
                [MULTI_PICKLIST_FIELD_API_NAME]: [picklistValue]
            }
        },
        WithoutValue: {
            DeveloperName: 'WithoutValue',
            PicklistFieldSectionsToPicklistDetail: { [CONTROLLING_FIELD_API_NAME]: [OTHER_PICKLIST_VALUE] }
        }
    };

    const fieldRecipeValues: Array<[string, string]> = [
        [CONTROLLING_FIELD_API_NAME, fakerService.buildPicklistRecipeValueByXMLFieldDetail([picklistValue], recordTypeByApiName, CONTROLLING_FIELD_API_NAME)],
        [DEPENDENT_FIELD_API_NAME, fakerService.buildDependentPicklistRecipeFakerValue({ [picklistValue]: [picklistValue, OTHER_PICKLIST_VALUE] }, recordTypeByApiName, CONTROLLING_FIELD_API_NAME, DEPENDENT_FIELD_API_NAME)],
        [MULTI_PICKLIST_FIELD_API_NAME, fakerService.buildMultiSelectPicklistRecipeValueByXMLFieldDetail([picklistValue, OTHER_PICKLIST_VALUE], recordTypeByApiName, MULTI_PICKLIST_FIELD_API_NAME)]
    ];

    const fieldLines = fieldRecipeValues.map(([fieldApiName, recipeValue]) => `    ${fieldApiName}: ${recipeValue}`);
    return ['- object: Example__c', '  nickname: Example__c_1', '  fields:', ...fieldLines, ''].join('\n');

};

export type LoadedRecipeWithEveryPicklistSink = Array<{
    object: string,
    nickname: string,
    fields: Record<string, unknown> & {
        [DEPENDENT_FIELD_API_NAME]: { if: Array<{ choice: { when: string, pick: { random_choice: unknown[] } } }> }
    }
}>;
