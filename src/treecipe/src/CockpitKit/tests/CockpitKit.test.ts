import * as fs from 'fs';
import * as path from 'path';
jest.mock('vscode', () => ({
    workspace: { workspaceFolders: undefined, getConfiguration: jest.fn().mockReturnValue({ get: jest.fn(), update: jest.fn(), inspect: jest.fn() }) },
    env: { openExternal: jest.fn() },
    window: { createWebviewPanel: jest.fn(), showWarningMessage: jest.fn(), showInformationMessage: jest.fn(), showErrorMessage: jest.fn() },
    commands: { registerCommand: jest.fn(), executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ProgressLocation: { Notification: 15, Window: 10 },
    ConfigurationTarget: { Workspace: 2 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }), parse: (uriValue: string) => ({ toString: () => uriValue }) }
}), { virtual: true });
import * as CockpitPaletteModule from '../CockpitPalette';
import * as CockpitButtonKindsModule from '../CockpitButtonKinds';
import * as CockpitOrgPickerModule from '../CockpitOrgPicker';
import * as CockpitConfirmDialogModule from '../CockpitConfirmDialog';
import { COCKPIT_PALETTE, CockpitPalette, CockpitPaletteToken } from '../CockpitPalette';
import { COCKPIT_BUTTON_KINDS, CockpitButtonKinds } from '../CockpitButtonKinds';
import { CockpitOrgPicker } from '../CockpitOrgPicker';
import { COCKPIT_KIT_CONFIRM_DIALOG_SCRIPT, COCKPIT_KIT_CONFIRM_DIALOG_SCRIPT_REQUIRES, CockpitConfirmDialog } from '../CockpitConfirmDialog';
import {
    RecipeCockpitService,
    RECIPE_COCKPIT_BUTTON_KINDS,
    RECIPE_COCKPIT_CONFIRM_CHANGE_ORG_LABEL,
    RECIPE_COCKPIT_CONFIRM_WARNINGS_LABEL,
    RECIPE_COCKPIT_PALETTE
} from '../../RecipeCockpitService/RecipeCockpitService';

/*
    #524: the first cut of the cockpit kit. The Recipe Cockpit's document must be what it was, so
    every piece the kit holds has to be IN that document, verbatim and once; that is also what keeps
    the Recipe Cockpit's contrast, button-kind and dialog suites covering the kit's code.
*/
const KIT_DIRECTORY = path.join(__dirname, '..');

const kitPieces = (): [string, string][] =>
    [CockpitButtonKindsModule, CockpitOrgPickerModule, CockpitConfirmDialogModule]
        .flatMap(kitModule => Object.entries(kitModule))
        .filter(([exportName, exportValue]) => exportName.startsWith('COCKPIT_KIT_') && typeof exportValue === 'string') as [string, string][];

const recipeShell = () => RecipeCockpitService.buildWebviewShellHtml('kitNonce');
const panelScriptOf = (html: string) => html.substring(html.lastIndexOf('<script nonce="kitNonce">'), html.lastIndexOf('</script>'));
const countOccurrences = (text: string, piece: string) => text.split(piece).length - 1;

describe('CockpitKit (#524)', () => {

    describe('the Recipe Cockpit draws from the kit', () => {

        it('holds every kit piece in the Recipe Cockpit\'s document, verbatim and exactly once', () => {

            const html = recipeShell();
            const pieces = kitPieces();

            expect(pieces.map(([pieceName]) => pieceName).sort()).toEqual([
                'COCKPIT_KIT_BUTTON_KINDS_SCRIPT',
                'COCKPIT_KIT_BUTTON_KIND_BASE_STYLES',
                'COCKPIT_KIT_BUTTON_KIND_CHECK_STYLES',
                'COCKPIT_KIT_BUTTON_KIND_PRIMARY_STYLES',
                'COCKPIT_KIT_BUTTON_KIND_STATE_STYLES',
                'COCKPIT_KIT_CONFIRM_DIALOG_HOST_MARKUP',
                'COCKPIT_KIT_CONFIRM_DIALOG_SCRIPT',
                'COCKPIT_KIT_CONFIRM_DIALOG_STATE_SCRIPT',
                'COCKPIT_KIT_CONFIRM_DIALOG_STYLES',
                'COCKPIT_KIT_CONFIRM_LABELS_SCRIPT',
                'COCKPIT_KIT_CREATE_BUTTON_SCRIPT',
                'COCKPIT_KIT_ORG_PICKER_REFRESH_STYLES',
                'COCKPIT_KIT_ORG_PICKER_STYLES',
                'COCKPIT_KIT_PINNED_SECTION_STYLES'
            ]);
            pieces.forEach(([pieceName, piece]) => {
                expect(piece.length).toBeGreaterThan(0);
                expect({ pieceName, count: countOccurrences(html, piece) }).toEqual({ pieceName, count: 1 });
            });

        });

        it('writes the kit palette as the Recipe Cockpit\'s custom properties, and keeps the names the cockpit already exported', () => {

            expect(RECIPE_COCKPIT_PALETTE).toBe(COCKPIT_PALETTE);
            expect(RECIPE_COCKPIT_BUTTON_KINDS).toBe(COCKPIT_BUTTON_KINDS);
            expect(RECIPE_COCKPIT_CONFIRM_WARNINGS_LABEL).toBe(CockpitConfirmDialogModule.COCKPIT_CONFIRM_WARNINGS_LABEL);
            expect(RECIPE_COCKPIT_CONFIRM_CHANGE_ORG_LABEL).toBe(CockpitConfirmDialogModule.COCKPIT_CONFIRM_CHANGE_ORG_LABEL);
            expect(countOccurrences(recipeShell(), CockpitPalette.buildCustomProperties())).toBe(1);
            expect(RecipeCockpitService.buildPaletteCustomProperties()).toBe(CockpitPalette.buildCustomProperties());

        });

        it('leaves the shell builder taking only a nonce', () => {

            expect(RecipeCockpitService.buildWebviewShellHtml.length).toBe(1);

        });

    });

    describe('palette', () => {

        it('names one custom property per token, kebab-cased, each with its value', () => {

            const customProperties = CockpitPalette.buildCustomProperties().split('\n');

            expect(customProperties).toHaveLength(Object.keys(COCKPIT_PALETTE).length);
            expect(CockpitPalette.buildCustomPropertyName('orgSection')).toBe('--sdt-org-section');
            expect(CockpitPalette.buildCustomPropertyName('page')).toBe('--sdt-page');
            (Object.keys(COCKPIT_PALETTE) as CockpitPaletteToken[]).forEach(paletteToken =>
                expect(customProperties).toContain(`        ${CockpitPalette.buildCustomPropertyName(paletteToken)}: ${COCKPIT_PALETTE[paletteToken]};`));

        });

        it('is frozen, so no cockpit can recolour another at run time', () => {

            expect(Object.isFrozen(COCKPIT_PALETTE)).toBe(true);
            expect(Object.isFrozen(COCKPIT_BUTTON_KINDS)).toBe(true);

        });

    });

    describe('button kinds', () => {

        it('joins the kind rules in the order the Recipe Cockpit draws them', () => {

            const html = recipeShell();
            const styles = CockpitButtonKinds.buildStyles();
            const pieces = styles.split('\n').length;

            expect(pieces).toBeGreaterThan(50);
            [CockpitButtonKindsModule.COCKPIT_KIT_BUTTON_KIND_BASE_STYLES, CockpitButtonKindsModule.COCKPIT_KIT_BUTTON_KIND_PRIMARY_STYLES,
                CockpitButtonKindsModule.COCKPIT_KIT_BUTTON_KIND_STATE_STYLES, CockpitButtonKindsModule.COCKPIT_KIT_BUTTON_KIND_CHECK_STYLES]
                .map(piece => html.indexOf(piece))
                .reduce((previousIndex, pieceIndex) => {
                    expect(pieceIndex).toBeGreaterThan(previousIndex);
                    return pieceIndex;
                }, -1);

        });

        it('styles every kind, and states only through one kind class per rule', () => {

            const styles = CockpitButtonKinds.buildStyles();
            const stateRules = Array.from(styles.matchAll(/\n\s*([^{}\n]*:(?:hover|active|disabled)[^{}\n]*) \{/g), match => match[1]);

            COCKPIT_BUTTON_KINDS.forEach(kind => expect(styles).toContain(`.sdtButton-${kind}`));
            expect(styles).toContain('.sdtButton-compact');
            expect(stateRules.length).toBeGreaterThan(5);
            stateRules.forEach(selectorList => selectorList.split(',').forEach(selector =>
                expect((selector.match(/\.sdtButton-[a-z]+/g) ?? []).length).toBeLessThanOrEqual(1)));

        });

        it('declares the kinds createButton checks, and refuses any other', () => {

            expect(CockpitButtonKindsModule.COCKPIT_KIT_BUTTON_KINDS_SCRIPT).toBe(`    const BUTTON_KINDS = ${JSON.stringify(COCKPIT_BUTTON_KINDS)};`);
            expect(CockpitButtonKindsModule.COCKPIT_KIT_CREATE_BUTTON_SCRIPT).toContain('if (BUTTON_KINDS.indexOf(kind) === -1) { throw new Error(\'Unknown button kind: \' + kind); }');
            expect(CockpitButtonKindsModule.COCKPIT_KIT_CREATE_BUTTON_SCRIPT.match(/createElement\('button'/g) ?? []).toHaveLength(1);

        });

    });

    describe('org picker', () => {

        it('joins the picker, refresh and pinned section rules, the pinned section opaque and sticky', () => {

            const styles = CockpitOrgPicker.buildStyles();

            ['.dataOrgSelect', '.dataOrgType', '.dataOrgSpinner', '.dataOrgRefresh', '.cockpitSectionHeader'].forEach(selector => expect(styles).toContain(selector));
            expect(styles).toContain('#cockpitOrgSection { position: sticky; top: 0;');
            expect(styles).toContain('background-color: var(--sdt-org-section)');
            expect(styles).toContain(`scroll-padding-top: ${CockpitOrgPickerModule.COCKPIT_PINNED_ORG_SECTION_SCROLL_PADDING};`);
            expect(styles).toContain(`animation: sdtSpin ${CockpitOrgPickerModule.COCKPIT_SPINNER_ROTATION_MILLISECONDS}ms linear infinite;`);

        });

    });

    describe('confirmation dialog', () => {

        it('names every function and element the dialog script uses but does not declare, and the Recipe Cockpit declares each', () => {

            const declaredInPiece = new Set(Array.from(COCKPIT_KIT_CONFIRM_DIALOG_SCRIPT.matchAll(/function ([A-Za-z]\w*)\(|(?:const|let) ([A-Za-z]\w*)\b/g), match => match[1] ?? match[2]));
            const languageNames = new Set(['if', 'for', 'while', 'switch', 'function', 'return', 'typeof', 'catch', 'Array', 'Number', 'String', 'Object', 'Error']);
            const calledFunctions = Array.from(COCKPIT_KIT_CONFIRM_DIALOG_SCRIPT.matchAll(/(?<![.\w])([A-Za-z_]\w*)\(/g), match => match[1])
                .filter(functionName => !declaredInPiece.has(functionName) && !languageNames.has(functionName));
            const readElements = Array.from(COCKPIT_KIT_CONFIRM_DIALOG_SCRIPT.matchAll(/\b(\w+Element)\b(?!\s*=)/g), match => match[1])
                .filter(elementName => !declaredInPiece.has(elementName) && /^(cockpit|loadStatus)/.test(elementName));

            expect(new Set([...calledFunctions, ...readElements, 'vscodeApi', 'renderedSequence', 'SVG_NAMESPACE']))
                .toEqual(new Set(COCKPIT_KIT_CONFIRM_DIALOG_SCRIPT_REQUIRES));

            const recipePanelScript = panelScriptOf(recipeShell()).replace(COCKPIT_KIT_CONFIRM_DIALOG_SCRIPT, '');
            COCKPIT_KIT_CONFIRM_DIALOG_SCRIPT_REQUIRES.forEach(requiredName =>
                expect({ requiredName, isDeclared: new RegExp(`(?:function ${requiredName}\\(|(?:const|let) ${requiredName}\\b)`).test(recipePanelScript) })
                    .toEqual({ requiredName, isDeclared: true }));

        });

        it('makes a 32-character hex id, a new one each time', () => {

            const firstId = CockpitConfirmDialog.buildConfirmationId();

            expect(firstId).toMatch(/^[0-9a-f]{32}$/);
            expect(CockpitConfirmDialog.buildConfirmationId()).not.toBe(firstId);

        });

        it('reads an offered index as its label, and anything else as Cancel', () => {

            const buttonLabels = ['Deploy', 'Deploy and assign'];
            const cancelled = { chosenLabel: undefined, isChecked: false };

            expect(CockpitConfirmDialog.readAnswer(buttonLabels, false, 0)).toEqual({ chosenLabel: 'Deploy', isChecked: false });
            expect(CockpitConfirmDialog.readAnswer(buttonLabels, false, 1)).toEqual({ chosenLabel: 'Deploy and assign', isChecked: false });
            [null, undefined, -1, 2, 0.5, '0', NaN, Infinity, {}, [0]].forEach(choice =>
                expect(CockpitConfirmDialog.readAnswer(buttonLabels, false, choice)).toEqual(cancelled));
            expect(CockpitConfirmDialog.readAnswer([], false, 0)).toEqual(cancelled);

        });

        it('counts a ticked box only when one was drawn, and reads a box that is not a boolean as Cancel', () => {

            expect(CockpitConfirmDialog.readAnswer(['Deploy'], true, 0, true)).toEqual({ chosenLabel: 'Deploy', isChecked: true });
            expect(CockpitConfirmDialog.readAnswer(['Deploy'], true, 0, false)).toEqual({ chosenLabel: 'Deploy', isChecked: false });
            expect(CockpitConfirmDialog.readAnswer(['Deploy'], true, 0)).toEqual({ chosenLabel: 'Deploy', isChecked: false });
            expect(CockpitConfirmDialog.readAnswer(['Deploy'], false, 0, true)).toEqual({ chosenLabel: 'Deploy', isChecked: false });
            ['true', 1, null, {}].forEach(isChecked =>
                expect(CockpitConfirmDialog.readAnswer(['Deploy'], true, 0, isChecked)).toEqual({ chosenLabel: undefined, isChecked: false }));

        });

    });

    describe('what the kit may import', () => {

        it('imports no vscode and no other service, so any cockpit can take it', () => {

            const kitFiles = fs.readdirSync(KIT_DIRECTORY).filter(fileName => fileName.endsWith('.ts'));

            expect(kitFiles.sort()).toEqual(['CockpitButtonKinds.ts', 'CockpitConfirmDialog.ts', 'CockpitOrgPicker.ts', 'CockpitPalette.ts']);
            kitFiles.forEach(fileName => {
                const importedModules = Array.from(fs.readFileSync(path.join(KIT_DIRECTORY, fileName), 'utf8').matchAll(/^import .* from '([^']+)';$/gm), match => match[1]);
                expect({ fileName, importedModules: importedModules.filter(moduleName => moduleName !== 'crypto') }).toEqual({ fileName, importedModules: [] });
            });
            expect(Object.keys(CockpitPaletteModule).sort()).toEqual(['COCKPIT_PALETTE', 'CockpitPalette']);

        });

    });

});
