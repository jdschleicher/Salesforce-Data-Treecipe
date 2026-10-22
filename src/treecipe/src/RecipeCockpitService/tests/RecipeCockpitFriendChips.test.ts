import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn(), showWarningMessage: jest.fn(), showQuickPick: jest.fn() },
    commands: { executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import { RecipeCockpitService, IRecipeCockpitRecipeViewModel, RECIPE_COCKPIT_FRIEND_GLYPH_PATH } from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    A friend row's chips (#411): one per parent it belongs to -- the occurrence its friends: block
    nests it under, then every other row a field of it points to by nickname -- each reading
    "<parent nickname>-<n>", n being the row's place among that parent's friends in recipe order.
*/

const RUN_FOLDER_NAME = 'recipe-2026-10-01T00-00-00';
const TREE_KEY = 'RelationshipTree_1';
const MOCKS_PATH = path.join(__dirname, 'mocks', 'recipeWriter');
const FAKER_JS_RECIPE = fs.readFileSync(path.join(MOCKS_PATH, 'recipe-fakerjs-selfLookupFriends--RelationshipTree_1.yml'), 'utf-8');
const SNOWFAKERY_RECIPE = fs.readFileSync(path.join(MOCKS_PATH, 'recipe-snowfakery--RelationshipTree_1.yml'), 'utf-8');

const NESTED_RECIPE_WITHOUT_PARENT_NICKNAME = [
    '- object: Account',
    '  count: 1',
    '  fields:',
    '    Name: Acme',
    '  friends:',
    '    - object: Contact',
    '      nickname: Contact_NickName',
    '      count: 1',
    '      fields:',
    '        LastName: Smith',
    ''
].join('\n');

describe('RecipeCockpitService, friend chips (#411)', () => {

    let workspaceRoot: string;

    const writeWorkspace = (recipeText: string, objectApiNames: string[], selfLookupObjectApiName?: string) => {

        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-friends-'));
        const runFolderPath = path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', RUN_FOLDER_NAME);
        fs.mkdirSync(path.join(runFolderPath, TREE_KEY), { recursive: true });

        const objectToObjectInfoMap = Object.fromEntries(objectApiNames.map(objectApiName => [objectApiName, {
            Fields: [],
            RelationshipDetail: {
                level: 0,
                parentObjectToFieldReferences: objectApiName === selfLookupObjectApiName ? { [objectApiName]: ['ParentId'] } : {}
            }
        }]));

        fs.writeFileSync(path.join(runFolderPath, 'treecipeObjectsWrapper-2026-10-01T00-00-00.json'), JSON.stringify({
            ObjectToObjectInfoMap: objectToObjectInfoMap,
            RecipeFiles: [{ objects: objectApiNames }]
        }));
        fs.writeFileSync(path.join(runFolderPath, TREE_KEY, `recipe--${TREE_KEY}-2026-10-01T00-00-00.yml`), recipeText);

    };

    afterEach(() => {
        if ( workspaceRoot ) { fs.rmSync(workspaceRoot, { recursive: true, force: true }); }
    });

    const loadModel = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.buildRecipeViewModel(workspaceRoot);

    const renderModel = (recipeViewModel: IRecipeCockpitRecipeViewModel) => {
        const panel = runPanelScript();
        panel.postToPanel({ command: 'recipeData', recipe: recipeViewModel, renderSequence: 1 });
        panel.expandAllTrees();
        return panel;
    };

    const deepText = (element: any): string => (element.textContent || '') + element.children.map(deepText).join('');

    // EACH ROW AS "<object>: <chip>, <chip>", IN THE ORDER THE CARD DRAWS THEM
    const chipLines = (panel: any): string[] => panel.objectElements().map((objectElement: any) => {
        const chips = panel.findAll(objectElement.children[0], 'treeFriendChip').map((chipElement: any) => panel.findAll(chipElement, 'treeFriendLabel')[0].textContent);
        return panel.objectNameOf(objectElement) + ': ' + chips.join(', ');
    });

    const objectElementWithNickname = (panel: any, nickname: string) => panel.objectElements()
        .find((objectElement: any) => panel.findAll(objectElement.children[0], 'treeNickname').some((nicknameElement: any) => nicknameElement.textContent === nickname));

    describe('the model', () => {

        it('carries parentNickname only on a nested friend whose parent occurrence has one nickname', () => {

            writeWorkspace(FAKER_JS_RECIPE, ['Account', 'Contact', 'Case', 'Opportunity', 'Lead'], 'Account');
            const objectsByApiName = new Map(loadModel().objects.map(object => [object.objectApiName, object]));

            expect(objectsByApiName.get('Contact')).toMatchObject({ countParentObjectApiName: 'Account', parentNickname: 'Account_NickName' });
            expect(objectsByApiName.get('Case')).toMatchObject({ countParentObjectApiName: 'Contact', parentNickname: 'Contact_NickName' });
            expect(objectsByApiName.get('Account')).not.toHaveProperty('parentNickname');
            expect(objectsByApiName.get('Lead')).not.toHaveProperty('parentNickname');

        });

        it('carries no parentNickname on a flat snowfakery tree, so its model is what it was', () => {

            writeWorkspace(SNOWFAKERY_RECIPE, ['Account', 'Contact', 'Opportunity']);

            loadModel().objects.forEach(object => expect(object).not.toHaveProperty('parentNickname'));

        });

        it('carries no parentNickname when the parent occurrence names none', () => {

            writeWorkspace(NESTED_RECIPE_WITHOUT_PARENT_NICKNAME, ['Account', 'Contact']);
            const contact = loadModel().objects.find(object => object.objectApiName === 'Contact');

            expect(contact).toMatchObject({ countParentObjectApiName: 'Account' });
            expect(contact).not.toHaveProperty('parentNickname');

        });

    });

    describe('a faker-js tree nested under friends:', () => {

        beforeEach(() => writeWorkspace(FAKER_JS_RECIPE, ['Account', 'Contact', 'Case', 'Opportunity', 'Lead'], 'Account'));

        it('draws one chip per parent, nesting parent first, numbered by place among that parent\'s friends in recipe order', () => {

            const panel = renderModel(loadModel());

            expect(chipLines(panel)).toEqual([
                'Account: ',
                'Account: Account_NickName-4',
                'Contact: Account_NickName-1',
                'Case: Contact_NickName-1, Account_NickName-2',
                'Opportunity: Account_NickName-3',
                'Lead: '
            ]);

        });

        it('draws the holding-hands glyph with createElementNS, hidden from a screen reader, and names each chip in words', () => {

            const panel = renderModel(loadModel());
            const caseChips = panel.findAll(objectElementWithNickname(panel, 'Case_NickName').children[0], 'treeFriendChip');
            const glyphElement = caseChips[0].children[0];

            expect(glyphElement.attributes['aria-hidden']).toBe('true');
            expect(glyphElement.children[0].attributes.d).toBe(RECIPE_COCKPIT_FRIEND_GLYPH_PATH);
            expect(caseChips.map((chipElement: any) => chipElement.attributes['aria-label'])).toEqual([
                'Friend 1 of Contact_NickName: go to Contact',
                'Friend 2 of Account_NickName: go to Account'
            ]);
            expect(caseChips.every((chipElement: any) => chipElement.classList.contains('sdtButton-secondary'))).toBe(true);

        });

        it('opens the parent\'s row and focuses its nickname when a chip is clicked', () => {

            const panel = renderModel(loadModel());
            const contactElement = objectElementWithNickname(panel, 'Contact_NickName');
            const caseChips = panel.findAll(objectElementWithNickname(panel, 'Case_NickName').children[0], 'treeFriendChip');

            expect(panel.isHidden(panel.objectBodyOf(contactElement))).toBe(true);
            const postedBeforeClickCount = panel.postedHostMessages.length;

            caseChips[0].dispatch('click');

            expect(panel.isHidden(panel.objectBodyOf(contactElement))).toBe(false);
            expect(panel.activeElement()).toBe(panel.findAll(contactElement.children[0], 'treeNickname')[0]);
            expect(panel.postedHostMessages.slice(postedBeforeClickCount).filter((message: any) => message.command !== 'savePlace')).toEqual([]);

        });

        it('lets the Treecipe tab\'s search find a row by its chip', () => {

            const panel = renderModel(loadModel());
            panel.typeIntoFilter('account_nickname-3');

            const opportunityElement = objectElementWithNickname(panel, 'Opportunity_NickName');
            const leadElement = objectElementWithNickname(panel, 'Lead_NickName');

            expect(panel.visibleFieldNamesOf(opportunityElement)).not.toEqual([]);
            expect(panel.visibleFieldNamesOf(leadElement)).toEqual([]);

        });

        it('lets the Treecipes section search find an object by its chip', () => {

            const panel = renderModel(loadModel());
            panel.typeIntoTreecipesSearch('Contact_NickName-1');

            const resultTexts = panel.findAll(panel.cockpitBodyElement, 'treecipesResult').map(deepText);

            expect(resultTexts.some((resultText: string) => resultText.includes('Case · Contact_NickName-1, Account_NickName-2'))).toBe(true);

        });

        it('names each object\'s chips in the object list under the Treecipes dropdown', () => {

            const panel = renderModel(loadModel());
            const listedObjects = panel.findAll(panel.cockpitBodyElement, 'treePickerObject').map((element: any) => element.textContent);

            expect(listedObjects).toEqual([
                'Account (Account_NickName-4)',
                'Contact (Account_NickName-1)',
                'Case (Contact_NickName-1, Account_NickName-2)',
                'Opportunity (Account_NickName-3)',
                'Lead'
            ]);

        });

        it('draws no extra chip for a field naming a nickname no row holds', () => {

            fs.writeFileSync(
                path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', RUN_FOLDER_NAME, TREE_KEY, `recipe--${TREE_KEY}-2026-10-01T00-00-00.yml`),
                FAKER_JS_RECIPE.replace('Subject: ${{ faker.lorem.sentence() }}', 'Subject: Nobody_NickName')
            );

            expect(chipLines(renderModel(loadModel()))).toContain('Case: Contact_NickName-1, Account_NickName-2');

        });

    });

    describe('a parent no one row holds by nickname', () => {

        it('falls back to the parent object, as muted text with no row to open', () => {

            writeWorkspace(NESTED_RECIPE_WITHOUT_PARENT_NICKNAME, ['Account', 'Contact']);
            const panel = renderModel(loadModel());
            const contactChips = panel.findAll(objectElementWithNickname(panel, 'Contact_NickName').children[0], 'treeFriendChip');

            expect(chipLines(panel)).toEqual(['Account: ', 'Contact: Account-1']);
            expect(contactChips[0].tagName.toLowerCase()).toBe('span');
            expect(contactChips[0].classList.contains('muted')).toBe(true);

        });

        it('falls back for a __proto__ nickname, and a lookup holding it draws nothing more', () => {

            writeWorkspace(
                NESTED_RECIPE_WITHOUT_PARENT_NICKNAME
                    .replace('  count: 1\n  fields:\n    Name: Acme', '  nickname: __proto__\n  count: 1\n  fields:\n    Name: Acme')
                    .replace('        LastName: Smith', '        LastName: Smith\n        AccountId: __proto__'),
                ['Account', 'Contact']
            );

            expect(chipLines(renderModel(loadModel()))).toEqual(['Account: ', 'Contact: Account-1']);

        });

    });

    describe('a flat snowfakery tree', () => {

        it('draws no chip on any row, even one whose lookup holds a nickname', () => {

            writeWorkspace(SNOWFAKERY_RECIPE.replace('AccountId: ### TODO -- REFERENCE ID REQUIRED', 'AccountId: Account_NickName'), ['Account', 'Contact', 'Opportunity']);
            const panel = renderModel(loadModel());

            expect(panel.findAll(panel.cockpitBodyElement, 'treeFriendChip')).toEqual([]);
            expect(panel.findAll(panel.cockpitBodyElement, 'treeFriendSlot')).toEqual([]);

        });

    });

});
