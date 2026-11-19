import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
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
import { COCKPIT_BUTTON_KINDS } from '../CockpitButtonKinds';
import {
    COCKPIT_KIT_CONFIRM_DIALOG_STYLE_REQUIRES,
    CockpitConfirmDialog
} from '../CockpitConfirmDialog';
import { COCKPIT_KIT_CUSTOM_PROPERTIES, COCKPIT_KIT_STYLESHEET_FILES, CockpitKitStylesheet } from '../CockpitKitStylesheet';
import { COCKPIT_MOTION_CONCEAL_MILLISECONDS, COCKPIT_MOTION_REVEAL_MILLISECONDS } from '../CockpitMotion';
import {
    RecipeCockpitService,
    RECIPE_COCKPIT_BUTTON_KINDS,
    RECIPE_COCKPIT_CONFIRM_CHANGE_ORG_LABEL,
    RECIPE_COCKPIT_CONFIRM_WARNINGS_LABEL,
    RECIPE_COCKPIT_PALETTE
} from '../../RecipeCockpitService/RecipeCockpitService';
import { RECIPE_COCKPIT_PANEL_BUNDLE_SCRIPT } from '../../RecipeCockpitService/RecipeCockpitPanelBundle.generated';
import { RECIPE_COCKPIT_PANEL_STYLESHEET } from '../../RecipeCockpitService/RecipeCockpitPanelStylesheet.generated';

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

// A KIT .css FILE (#644) AS esbuild.panel.js INLINES IT: VERBATIM, LESS ITS LAST LINE BREAK
const KIT_PANEL_DIRECTORY = path.join(KIT_DIRECTORY, 'panel');
const kitCss = (fileName: string) => fs.readFileSync(path.join(KIT_PANEL_DIRECTORY, fileName), 'utf8').replace(/\n$/, '');
const buttonKindCss = () => ['base', 'primary', 'state', 'check'].map(piece => kitCss(`CockpitButtonKinds.${piece}.css`)).join('\n');
const orgPickerCss = () => ['CockpitOrgPicker.refresh.css', 'CockpitOrgPicker.css', 'CockpitOrgPicker.pinnedSection.css'].map(kitCss).join('\n');

const recipeShell = () => RecipeCockpitService.buildWebviewShellHtml('kitNonce');
const panelScriptOf = (html: string) => html.substring(html.lastIndexOf('<script nonce="kitNonce">'), html.lastIndexOf('</script>'));
const styleSheetOf = (html: string) => html.substring(html.indexOf('<style nonce="kitNonce">'), html.indexOf('</style>'));
const countOccurrences = (text: string, piece: string) => text.split(piece).length - 1;

// THE CONFIRMATION'S PANEL HALF (#637): A CHECKED MODULE, BUNDLED INTO THE COCKPIT'S SCRIPT
const CONFIRM_DIALOG_PANEL_PATH = path.join(KIT_DIRECTORY, 'panel', 'CockpitConfirmDialogPanel.ts');
const confirmDialogPanelSource = () => fs.readFileSync(CONFIRM_DIALOG_PANEL_PATH, 'utf8');

// THE NAMES A MODULE TAKES FROM THE SCRIPT AROUND IT: ITS TOP-LEVEL declare const / let / function
const ambientNamesOf = (moduleSource: string): Set<string> => {
    const sourceFile = ts.createSourceFile('panelModule.ts', moduleSource, ts.ScriptTarget.Latest, true);
    const isDeclared = (statement: ts.Statement) => ts.canHaveModifiers(statement) && !!ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword);
    return new Set(sourceFile.statements.filter(isDeclared).flatMap(statement => {
        if (ts.isVariableStatement(statement)) { return statement.declarationList.declarations.map(declaration => declaration.name.getText(sourceFile)); }
        return ts.isFunctionDeclaration(statement) && statement.name ? [statement.name.text] : [];
    }));
};

const classSelectorsOf = (styleSheet: string): Set<string> =>
    new Set(Array.from(styleSheet.replace(/\{[^{}]*\}/g, '{}').matchAll(/\.([A-Za-z][\w-]*)/g), match => match[1]));

describe('CockpitKit (#524)', () => {

    describe('the Recipe Cockpit draws from the kit', () => {

        it('holds every kit piece in the Recipe Cockpit\'s document, verbatim and exactly once', () => {

            const html = recipeShell();
            const pieces = kitPieces();

            expect(pieces.map(([pieceName]) => pieceName).sort()).toEqual(['COCKPIT_KIT_CONFIRM_DIALOG_HOST_MARKUP']);
            pieces.forEach(([pieceName, piece]) => {
                expect(piece.length).toBeGreaterThan(0);
                expect({ pieceName, count: countOccurrences(html, piece) }).toEqual({ pieceName, count: 1 });
            });

        });

        // #644: THE KIT'S STYLES ARE .css FILES THE RECIPE COCKPIT'S .css INCLUDES, EACH ONCE, IN THE ORDER THE KIT LISTS THEM
        it('lists every .css file under panel/, and the Recipe Cockpit\'s stylesheet holds each verbatim, once, in that order', () => {

            const cssFileNames = fs.readdirSync(KIT_PANEL_DIRECTORY).filter(fileName => fileName.endsWith('.css'));

            expect([...COCKPIT_KIT_STYLESHEET_FILES].sort()).toEqual(cssFileNames.sort());
            COCKPIT_KIT_STYLESHEET_FILES.map(fileName => {
                expect({ fileName, count: countOccurrences(RECIPE_COCKPIT_PANEL_STYLESHEET, kitCss(fileName)) }).toEqual({ fileName, count: 1 });
                return RECIPE_COCKPIT_PANEL_STYLESHEET.indexOf(kitCss(fileName));
            }).reduce((previousIndex, fileIndex) => {
                expect(fileIndex).toBeGreaterThan(previousIndex);
                return fileIndex;
            }, -1);

        });

        it('writes each value its .css files read into the Recipe Cockpit\'s :root, once, from the kit\'s constants', () => {

            const html = recipeShell();
            const kitCssText = COCKPIT_KIT_STYLESHEET_FILES.map(kitCss).join('\n');

            expect(COCKPIT_KIT_CUSTOM_PROPERTIES).toEqual({
                '--sdt-motion-reveal': `${COCKPIT_MOTION_REVEAL_MILLISECONDS}ms`,
                '--sdt-motion-conceal': `${COCKPIT_MOTION_CONCEAL_MILLISECONDS}ms`,
                '--sdt-spinner-rotation': `${CockpitOrgPickerModule.COCKPIT_SPINNER_ROTATION_MILLISECONDS}ms`,
                '--sdt-pinned-org-section-scroll-padding': CockpitOrgPickerModule.COCKPIT_PINNED_ORG_SECTION_SCROLL_PADDING,
                '--sdt-action-card-height': CockpitButtonKindsModule.COCKPIT_ACTION_CARD_HEIGHT
            });
            expect(countOccurrences(html, CockpitKitStylesheet.buildCustomProperties())).toBe(1);
            // A .css FILE HOLDS NO NUMBER THE TYPESCRIPT READS: NO TEMPLATE LEFT IN IT, AND NO TIMING OUTSIDE A var()
            expect(kitCssText).not.toContain('${');
            expect(kitCssText).not.toMatch(/\b\d+ms\b/);

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
            const styles = buttonKindCss();
            const pieces = styles.split('\n').length;

            expect(pieces).toBeGreaterThan(50);
            ['base', 'primary', 'state', 'check'].map(piece => kitCss(`CockpitButtonKinds.${piece}.css`))
                .map(piece => html.indexOf(piece))
                .reduce((previousIndex, pieceIndex) => {
                    expect(pieceIndex).toBeGreaterThan(previousIndex);
                    return pieceIndex;
                }, -1);

        });

        it('styles every kind, and states only through one kind class per rule', () => {

            const styles = buttonKindCss();
            const stateRules = Array.from(styles.matchAll(/\n\s*([^{}\n]*:(?:hover|active|disabled)[^{}\n]*) \{/g), match => match[1]);

            COCKPIT_BUTTON_KINDS.forEach(kind => expect(styles).toContain(`.sdtButton-${kind}`));
            expect(styles).toContain('.sdtButton-compact');
            expect(stateRules.length).toBeGreaterThan(5);
            stateRules.forEach(selectorList => selectorList.split(',').forEach(selector =>
                expect((selector.match(/\.sdtButton-[a-z]+/g) ?? []).length).toBeLessThanOrEqual(1)));

        });

        it('checks every kind against COCKPIT_BUTTON_KINDS, refuses any other, and makes the only button (#638)', () => {

            const panelElementsSource = fs.readFileSync(path.join(KIT_DIRECTORY, 'panel', 'CockpitPanelElements.ts'), 'utf8');

            expect(panelElementsSource).toContain("import { COCKPIT_BUTTON_KINDS, CockpitButtonKind } from '../CockpitButtonKindNames';");
            expect(panelElementsSource).toContain('if (COCKPIT_BUTTON_KINDS.indexOf(kind) === -1) { throw new Error(\'Unknown button kind: \' + kind); }');
            expect(panelElementsSource.match(/createElement\('button'/g) ?? []).toHaveLength(1);
            expect(COCKPIT_BUTTON_KINDS).toEqual(['primary', 'secondary', 'icon', 'check', 'link', 'card']);

        });

    });

    describe('org picker', () => {

        it('joins the picker, refresh and pinned section rules, the pinned section opaque and sticky', () => {

            const styles = orgPickerCss();

            ['.dataOrgSelect', '.dataOrgType', '.dataOrgSpinner', '.dataOrgRefresh', '.cockpitSectionHeader'].forEach(selector => expect(styles).toContain(selector));
            expect(styles).toContain('#cockpitOrgSection { position: sticky; top: 0;');
            expect(styles).toContain('background-color: var(--sdt-org-section)');
            expect(styles).toContain('scroll-padding-top: var(--sdt-pinned-org-section-scroll-padding);');
            expect(styles).toContain('animation: sdtSpin var(--sdt-spinner-rotation) linear infinite;');

        });

    });

    describe('confirmation dialog', () => {

        // THE KIT CANNOT IMPORT A COCKPIT (#657): A COCKPIT HANDS IT WHAT IT POSTS THROUGH AND DRAWS ON, ONCE, WHEN ITS PANEL STARTS
        it('declares nothing from a cockpit, and the Recipe Cockpit connects it before it routes a message', () => {

            const recipePanelScript = panelScriptOf(recipeShell());
            const recipeStartSource = fs.readFileSync(path.join(KIT_DIRECTORY, '..', 'RecipeCockpitService', 'panel', 'RecipeCockpitPanelHost.ts'), 'utf8');

            expect(ambientNamesOf(confirmDialogPanelSource())).toEqual(new Set());
            expect(countOccurrences(recipePanelScript, RECIPE_COCKPIT_PANEL_BUNDLE_SCRIPT)).toBe(1);
            expect(recipeStartSource.indexOf('connectConfirmDialog(')).toBeGreaterThan(-1);
            expect(recipeStartSource.indexOf('connectConfirmDialog(')).toBeLessThan(recipeStartSource.indexOf("window.addEventListener('message'"));

        });

        it('names every class it draws with that its own styles do not, and the Recipe Cockpit styles each outside them', () => {

            const confirmDialogCss = kitCss('CockpitConfirmDialog.css');
            const styledByKit = classSelectorsOf(confirmDialogCss);
            const namedByModule = Array.from(confirmDialogPanelSource().matchAll(/(?:classList\.add\(|setAttribute\('class', )'([A-Za-z][\w-]*)'/g), match => match[1]);
            const recipeStyleSheet = styleSheetOf(recipeShell()).replace(confirmDialogCss, '');

            expect(namedByModule.length).toBeGreaterThan(0);
            namedByModule.filter(className => !styledByKit.has(className)).forEach(className =>
                expect(COCKPIT_KIT_CONFIRM_DIALOG_STYLE_REQUIRES).toContain(className));
            COCKPIT_KIT_CONFIRM_DIALOG_STYLE_REQUIRES.forEach(className =>
                expect({ className, isStyled: classSelectorsOf(recipeStyleSheet).has(className) }).toEqual({ className, isStyled: true }));

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
            const isKitModule = (moduleName: string) => moduleName === 'crypto' || /^\.\/[A-Za-z]+$/.test(moduleName);

            expect(kitFiles.sort()).toEqual(['CockpitButtonKindNames.ts', 'CockpitButtonKinds.ts', 'CockpitConfirmDialog.ts', 'CockpitConfirmLabels.ts', 'CockpitKitStylesheet.ts', 'CockpitMotion.ts', 'CockpitOrgPicker.ts', 'CockpitPalette.ts']);
            kitFiles.forEach(fileName => {
                const importedModules = Array.from(fs.readFileSync(path.join(KIT_DIRECTORY, fileName), 'utf8').matchAll(/^import .* from '([^']+)';$/gm), match => match[1]);
                expect({ fileName, importedModules: importedModules.filter(moduleName => !isKitModule(moduleName)) }).toEqual({ fileName, importedModules: [] });
            });
            ['CockpitConfirmLabels.ts', 'CockpitMotion.ts', 'CockpitButtonKindNames.ts'].forEach(importFreeFileName =>
                expect({ importFreeFileName, imports: /^import /m.test(fs.readFileSync(path.join(KIT_DIRECTORY, importFreeFileName), 'utf8')) }).toEqual({ importFreeFileName, imports: false }));
            expect(Object.keys(CockpitPaletteModule).sort()).toEqual(['COCKPIT_PALETTE', 'CockpitPalette']);

        });

    });

});
