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

import {
    RecipeCockpitService,
    IRecipeCockpitRecipeViewModel,
    RECIPE_COCKPIT_PARENT_NICKNAME_EMOJI,
    RECIPE_COCKPIT_CHILD_REFERENCE_MENU_HINT,
    RECIPE_COCKPIT_PARENT_REFERENCE_MENU_HINT
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    A row's nickname, the fields that point to it, and a child field's way back (#380), drawn from
    the recipes both backends write: a faker-js tree nested under friends: with a self-lookup
    iteration, and a flat snowfakery tree whose lookups #151 wired. Nothing is posted to the host,
    and no message gains a nickname.
*/

const RUN_FOLDER_NAME = 'recipe-2026-10-01T00-00-00';
const TREE_KEY = 'RelationshipTree_1';
const MOCKS_PATH = path.join(__dirname, 'mocks', 'recipeWriter');
const FAKER_JS_RECIPE = fs.readFileSync(path.join(MOCKS_PATH, 'recipe-fakerjs-selfLookupFriends--RelationshipTree_1.yml'), 'utf-8');
const SNOWFAKERY_RECIPE = fs.readFileSync(path.join(MOCKS_PATH, 'recipe-snowfakery--RelationshipTree_1.yml'), 'utf-8');

// WHAT #151's "Wire to…" WRITES: THE TODO LINE OF A LOOKUP REPLACED BY THE PARENT'S NICKNAME, NOTHING ELSE
const wireSnowfakeryLookup = (recipeText: string, objectApiName: string, fieldApiName: string, nickname: string): string => {
    const lines = recipeText.split('\n');
    const headerIndex = lines.indexOf(`- object: ${objectApiName}`);
    const fieldIndex = lines.findIndex((line, lineIndex) => lineIndex > headerIndex && line === `    ${fieldApiName}: ### TODO -- REFERENCE ID REQUIRED`);
    lines[fieldIndex] = `    ${fieldApiName}: ${nickname}`;
    return lines.join('\n');
};

const WIRED_SNOWFAKERY_RECIPE = wireSnowfakeryLookup(
    wireSnowfakeryLookup(SNOWFAKERY_RECIPE, 'Contact', 'AccountId', 'Account_NickName'),
    'Opportunity', 'AccountId', 'Account_NickName'
);

describe('RecipeCockpitService, nicknames and the fields that point to them (#380)', () => {

    let workspaceRoot: string;

    const writeWorkspace = (recipeText: string, objectApiNames: string[], selfLookupObjectApiName?: string) => {

        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-nicknames-'));
        const runFolderPath = path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', RUN_FOLDER_NAME);
        fs.mkdirSync(path.join(runFolderPath, TREE_KEY), { recursive: true });

        // NO FIELDS IN THE WRAPPER: EVERY ROW IS READ FROM THE RECIPE FILE, WHICH IS WHAT HOLDS THE NICKNAMES
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

    const objectElementNamed = (panel: any, nickname: string) => panel.objectElements()
        .find((objectElement: any) => panel.findAll(objectElement.children[0], 'treeNicknameText').some((nicknameElement: any) => nicknameElement.textContent === nickname));
    const nicknameChipOf = (panel: any, nickname: string) => panel.findAll(objectElementNamed(panel, nickname).children[0], 'treeNickname')[0];
    const menuItemsOf = (panel: any, nickname: string) => panel.findAll(objectElementNamed(panel, nickname).children[0], 'treeNicknameMenuItem');
    const menuItemLabels = (panel: any, nickname: string) => menuItemsOf(panel, nickname).map((itemElement: any) => itemElement.textContent);
    const backLinkOf = (panel: any, nickname: string, fieldApiName: string) => panel.findAll(panel.fieldRowNamed(objectElementNamed(panel, nickname), fieldApiName), 'treeNicknameBackLink')[0];
    const backLinkMenuItemsOf = (panel: any, nickname: string, fieldApiName: string) => panel.findAll(panel.fieldRowNamed(objectElementNamed(panel, nickname), fieldApiName), 'treeNicknameMenuItem');

    describe('the model', () => {

        it('carries the one nickname of an object without iterations as recipeNickname, and never as nickname', () => {

            writeWorkspace(FAKER_JS_RECIPE, ['Account', 'Contact', 'Case', 'Opportunity', 'Lead'], 'Account');
            const objectsByApiName = new Map(loadModel().objects.map(object => [object.objectApiName, object]));

            expect(objectsByApiName.get('Contact')).toMatchObject({ recipeNickname: 'Contact_NickName' });
            expect(objectsByApiName.get('Contact')).not.toHaveProperty('nickname');
            expect(objectsByApiName.get('Lead')).toMatchObject({ recipeNickname: 'Lead_NickName' });
            // AN OBJECT WITH ITERATIONS ALREADY CARRIES ITS NICKNAME AS nickname, SO IT IS NOT REPEATED
            expect(objectsByApiName.get('Account')).toMatchObject({ nickname: 'Account_NickName' });
            expect(objectsByApiName.get('Account')).not.toHaveProperty('recipeNickname');

        });

        it('carries no recipeNickname on an object whose block names none', () => {

            writeWorkspace('- object: Account\n  count: 1\n  fields:\n    Name: Acme\n', ['Account']);

            expect(loadModel().objects[0]).not.toHaveProperty('recipeNickname');

        });

    });

    describe('a faker-js tree nested under friends:', () => {

        beforeEach(() => writeWorkspace(FAKER_JS_RECIPE, ['Account', 'Contact', 'Case', 'Opportunity', 'Lead'], 'Account'));

        it('draws every row\'s nickname beside its name', () => {

            const panel = renderModel(loadModel());

            expect(panel.findAll(panel.cockpitBodyElement, 'treeNicknameText').map((element: any) => element.textContent)).toEqual([
                'Account_NickName', 'Account_child_NickName', 'Contact_NickName', 'Case_NickName', 'Opportunity_NickName', 'Lead_NickName'
            ]);

        });

        it('draws the nickname right after the object name, before the count box and lookups', () => {

            const panel = renderModel(loadModel());
            const headerChildren = objectElementNamed(panel, 'Contact_NickName').children[0].children;
            const nameIndex = headerChildren.findIndex((element: any) => element.classList.contains('treeObjectName'));

            expect(headerChildren[nameIndex + 1].classList.contains('treeNicknameSlot')).toBe(true);
            expect(panel.findAll(headerChildren[nameIndex + 1], 'treeNicknameText')[0].textContent).toBe('Contact_NickName');

            const iterationHeaderChildren = objectElementNamed(panel, 'Account_child_NickName').children[0].children;
            const iterationNameIndex = iterationHeaderChildren.findIndex((element: any) => element.classList.contains('treeObjectName'));
            expect(iterationHeaderChildren[iterationNameIndex + 1].classList.contains('treeNicknameSlot')).toBe(true);
            expect(iterationHeaderChildren[iterationNameIndex + 2].textContent).toBe('nested under Account_NickName');

        });

        it('makes a nickname a list button only where a field points to it, and plain text where none does', () => {

            const panel = renderModel(loadModel());

            ['Account_NickName', 'Contact_NickName'].forEach(nickname => {
                expect(nicknameChipOf(panel, nickname).tagName).toBe('button');
                expect(nicknameChipOf(panel, nickname).attributes['aria-haspopup']).toBe('menu');
                expect(nicknameChipOf(panel, nickname).attributes['aria-expanded']).toBe('false');
            });
            ['Account_child_NickName', 'Case_NickName', 'Opportunity_NickName', 'Lead_NickName'].forEach(nickname => {
                expect(nicknameChipOf(panel, nickname).tagName).toBe('span');
                expect(nicknameChipOf(panel, nickname).attributes.title).toBe(`No field of this treecipe points to ${nickname}`);
            });
            expect(nicknameChipOf(panel, 'Account_NickName').attributes['aria-label']).toBe('Account_NickName: 4 fields point to it');

        });

        it('starts every nickname, button or plain text, with a 🌳 hidden from a screen reader (#432)', () => {

            const panel = renderModel(loadModel());

            expect(RECIPE_COCKPIT_PARENT_NICKNAME_EMOJI).toBe('🌳');
            ['Account_NickName', 'Contact_NickName', 'Account_child_NickName', 'Lead_NickName'].forEach(nickname => {
                const [emojiElement, textElement] = nicknameChipOf(panel, nickname).children;
                expect(emojiElement.classList.contains('treeChipEmoji')).toBe(true);
                expect(emojiElement.textContent).toBe('🌳');
                expect(emojiElement.attributes['aria-hidden']).toBe('true');
                expect(textElement.classList.contains('treeNicknameText')).toBe(true);
                expect(textElement.textContent).toBe(nickname);
            });
            expect(nicknameChipOf(panel, 'Contact_NickName').attributes['aria-label']).not.toContain('🌳');
            expect(nicknameChipOf(panel, 'Lead_NickName').attributes.title).not.toContain('🌳');

        });

        it('lists every field pointing to the nickname in recipe order: nested friends, a grandchild and the self-lookup iteration', () => {

            const panel = renderModel(loadModel());
            nicknameChipOf(panel, 'Account_NickName').dispatch('click');

            expect(menuItemLabels(panel, 'Account_NickName')).toEqual([
                'Contact.AccountId',
                'Case.AccountId',
                'Opportunity.AccountId',
                'Account · Account_child_NickName.ParentId'
            ]);
            expect(nicknameChipOf(panel, 'Account_NickName').attributes['aria-expanded']).toBe('true');
            expect(menuItemsOf(panel, 'Account_NickName').every((itemElement: any) => itemElement.attributes.role === 'menuitem')).toBe(true);
            expect(panel.activeElement()).toBe(menuItemsOf(panel, 'Account_NickName')[0]);

            nicknameChipOf(panel, 'Contact_NickName').dispatch('click');
            expect(menuItemLabels(panel, 'Contact_NickName')).toEqual(['Case.ContactId']);

        });

        it('keeps one list open at a time, and closes it on a second click of its nickname', () => {

            const panel = renderModel(loadModel());

            nicknameChipOf(panel, 'Account_NickName').dispatch('click');
            nicknameChipOf(panel, 'Contact_NickName').dispatch('click');
            expect(menuItemsOf(panel, 'Account_NickName')).toHaveLength(0);
            expect(nicknameChipOf(panel, 'Account_NickName').attributes['aria-expanded']).toBe('false');

            nicknameChipOf(panel, 'Contact_NickName').dispatch('click');
            expect(menuItemsOf(panel, 'Contact_NickName')).toHaveLength(0);
            expect(panel.activeElement()).toBe(nicknameChipOf(panel, 'Contact_NickName'));

        });

        it('closes the list on a click anywhere else, even one a listener stops', () => {

            const panel = renderModel(loadModel());
            nicknameChipOf(panel, 'Account_NickName').dispatch('click');

            const leadHeader = objectElementNamed(panel, 'Lead_NickName').children[0];
            leadHeader.addEventListener('click', (event: any) => event.stopPropagation());
            leadHeader.dispatch('click');

            expect(menuItemsOf(panel, 'Account_NickName')).toHaveLength(0);
            expect(panel.isHidden(panel.findAll(panel.cockpitBodyElement, 'treeNicknameMenu')[0])).toBe(true);

        });

        it('moves between entries with the arrow keys, Home and End, and gives focus back on Escape', () => {

            const panel = renderModel(loadModel());
            nicknameChipOf(panel, 'Account_NickName').dispatch('click');
            const items = menuItemsOf(panel, 'Account_NickName');

            items[0].dispatch('keydown', { key: 'ArrowDown' });
            expect(panel.activeElement()).toBe(items[1]);
            expect(items.map((itemElement: any) => itemElement.attributes.tabindex)).toEqual(['-1', '0', '-1', '-1']);
            items[1].dispatch('keydown', { key: 'ArrowUp' });
            items[0].dispatch('keydown', { key: 'ArrowUp' });
            expect(panel.activeElement()).toBe(items[3]);
            items[3].dispatch('keydown', { key: 'Home' });
            expect(panel.activeElement()).toBe(items[0]);
            items[0].dispatch('keydown', { key: 'End' });
            expect(panel.activeElement()).toBe(items[3]);

            items[3].dispatch('keydown', { key: 'Escape' });
            expect(menuItemsOf(panel, 'Account_NickName')).toHaveLength(0);
            expect(panel.activeElement()).toBe(nicknameChipOf(panel, 'Account_NickName'));

        });

        it('opens the chosen child and scrolls to its field, by click or by Enter, focusing the field\'s way back', () => {

            const panel = renderModel(loadModel());
            const caseElement = objectElementNamed(panel, 'Case_NickName');
            expect(panel.isHidden(caseElement.children[1])).toBe(true);

            nicknameChipOf(panel, 'Account_NickName').dispatch('click');
            menuItemsOf(panel, 'Account_NickName')[1].dispatch('click');

            const caseAccountRow = panel.fieldRowNamed(caseElement, 'AccountId');
            expect(panel.isHidden(caseElement.children[1])).toBe(false);
            expect(caseAccountRow.scrolledIntoViewCount).toBe(1);
            expect(menuItemsOf(panel, 'Account_NickName')).toHaveLength(0);
            expect(panel.activeElement()).toBe(panel.findAll(caseAccountRow, 'treeNicknameBackLink')[0]);

            nicknameChipOf(panel, 'Account_NickName').dispatch('click');
            menuItemsOf(panel, 'Account_NickName')[3].dispatch('keydown', { key: 'Enter' });
            const iterationParentRow = panel.fieldRowNamed(objectElementNamed(panel, 'Account_child_NickName'), 'ParentId');
            expect(iterationParentRow.scrolledIntoViewCount).toBe(1);

        });

        it('clears the Treecipe search when it hides the field chosen', () => {

            const panel = renderModel(loadModel());
            const caseElement = objectElementNamed(panel, 'Case_NickName');
            panel.expandObject(caseElement);
            panel.typeIntoFilter('Subject');
            expect(panel.isHidden(panel.fieldRowNamed(caseElement, 'ContactId'))).toBe(true);

            nicknameChipOf(panel, 'Contact_NickName').dispatch('click');
            menuItemsOf(panel, 'Contact_NickName')[0].dispatch('click');

            expect(panel.isHidden(panel.fieldRowNamed(caseElement, 'ContactId'))).toBe(false);
            expect(panel.findAll(panel.cockpitBodyElement, 'tabSearchInput')[0].value).toBe('');

        });

        it('draws a highlighted way back on each field holding a nickname, which opens the parent row and focuses its nickname', () => {

            const panel = renderModel(loadModel());
            panel.objectElements().forEach((objectElement: any) => panel.expandObject(objectElement));

            expect(panel.findAll(panel.cockpitBodyElement, 'treeNicknameBackLink').map((element: any) => element.textContent)).toEqual([
                '↖ Account_NickName', '↖ Account_NickName', '↖ Account_NickName', '↖ Contact_NickName', '↖ Account_NickName'
            ]);

            const accountElement = objectElementNamed(panel, 'Account_NickName');
            panel.expandObject(accountElement);
            expect(panel.isHidden(accountElement.children[1])).toBe(true);

            const caseContactRow = panel.fieldRowNamed(objectElementNamed(panel, 'Case_NickName'), 'ContactId');
            const contactBackLink = panel.findAll(caseContactRow, 'treeNicknameBackLink')[0];
            expect(contactBackLink.attributes['aria-label']).toBe('Contact_NickName: show the Contact this field points to');
            backLinkOf(panel, 'Case_NickName', 'AccountId').dispatch('click');
            backLinkMenuItemsOf(panel, 'Case_NickName', 'AccountId')[0].dispatch('click');

            expect(panel.isHidden(accountElement.children[1])).toBe(false);
            expect(accountElement.scrolledIntoViewCount).toBe(1);
            expect(panel.activeElement()).toBe(nicknameChipOf(panel, 'Account_NickName'));

        });

        it('draws no way back on a TODO lookup, and posts nothing to the host for any of it', () => {

            const panel = renderModel(loadModel());
            panel.objectElements().forEach((objectElement: any) => panel.expandObject(objectElement));
            const postedCount = panel.postedHostMessages.length;

            expect(panel.findAll(panel.fieldRowNamed(objectElementNamed(panel, 'Account_NickName'), 'ParentId'), 'treeNicknameBackLink')).toHaveLength(0);
            expect(panel.findAll(panel.fieldRowNamed(objectElementNamed(panel, 'Contact_NickName'), 'ReportsToId'), 'treeNicknameBackLink')).toHaveLength(0);

            nicknameChipOf(panel, 'Account_NickName').dispatch('click');
            menuItemsOf(panel, 'Account_NickName')[0].dispatch('click');
            panel.findAll(panel.cockpitBodyElement, 'treeNicknameBackLink')[0].dispatch('click');
            panel.findAll(panel.cockpitBodyElement, 'treeNicknameMenuItem')[0].dispatch('click');

            expect(panel.postedHostMessages.slice(postedCount).filter((hostMessage: any) => hostMessage.command !== 'savePlace')).toEqual([]);

        });

        it('marks a child the tree icon excluded, and still lists it', () => {

            const recipeViewModel = loadModel();
            const panel = renderModel(recipeViewModel);
            objectElementNamed(panel, 'Case_NickName').classList.add('excluded');

            nicknameChipOf(panel, 'Contact_NickName').dispatch('click');

            expect(menuItemLabels(panel, 'Contact_NickName')).toEqual(['Case.ContactId — excluded']);

        });

    });

    describe('a hint on each references list (#491)', () => {

        beforeEach(() => writeWorkspace(FAKER_JS_RECIPE, ['Account', 'Contact', 'Case', 'Opportunity', 'Lead'], 'Account'));

        const openMenuOf = (panel: any, objectElement: any) => panel.findAll(objectElement, 'treeNicknameMenu').find((menuElement: any) => !panel.isHidden(menuElement));

        it('starts a nickname\'s list with a line saying a click goes to a child reference, which names the list and is never focused', () => {

            const panel = renderModel(loadModel());
            nicknameChipOf(panel, 'Account_NickName').dispatch('click');

            const menuElement = openMenuOf(panel, objectElementNamed(panel, 'Account_NickName').children[0]);
            const hintElement = menuElement.children[0];
            const itemsElement = menuElement.children[1];
            expect(hintElement.classList.contains('treeNicknameMenuHint')).toBe(true);
            expect(hintElement.textContent).toBe(RECIPE_COCKPIT_CHILD_REFERENCE_MENU_HINT);
            expect(hintElement.tagName.toLowerCase()).toBe('span');
            expect(hintElement.attributes.tabindex).toBeUndefined();
            expect(hintElement.attributes.role).toBeUndefined();

            // A MENU OWNS ONLY ITS ITEMS, SO THE HINT IS ITS SIBLING AND NAMES IT
            expect(menuElement.attributes.role).toBeUndefined();
            expect(itemsElement.attributes.role).toBe('menu');
            expect(itemsElement.attributes['aria-labelledby']).toBe(hintElement.attributes.id);
            expect(itemsElement.children.every((itemElement: any) => itemElement.attributes.role === 'menuitem')).toBe(true);

            const items = menuItemsOf(panel, 'Account_NickName');
            expect(panel.activeElement()).toBe(items[0]);
            items[0].dispatch('keydown', { key: 'ArrowUp' });
            expect(panel.activeElement()).toBe(items[items.length - 1]);
            items[items.length - 1].dispatch('keydown', { key: 'Home' });
            expect(panel.activeElement()).toBe(items[0]);

        });

        it('gives each opened list its own hint id', () => {

            const panel = renderModel(loadModel());
            nicknameChipOf(panel, 'Account_NickName').dispatch('click');
            const firstId = openMenuOf(panel, objectElementNamed(panel, 'Account_NickName').children[0]).children[1].attributes['aria-labelledby'];
            nicknameChipOf(panel, 'Contact_NickName').dispatch('click');
            const secondId = openMenuOf(panel, objectElementNamed(panel, 'Contact_NickName').children[0]).children[1].attributes['aria-labelledby'];

            expect(secondId).not.toBe(firstId);

        });

        it('makes a field\'s way back open a list of its parent, led by a line saying a click goes to the parent reference', () => {

            const panel = renderModel(loadModel());
            const caseElement = objectElementNamed(panel, 'Case_NickName');
            panel.expandObject(caseElement);
            const backLink = backLinkOf(panel, 'Case_NickName', 'ContactId');
            const contactElement = objectElementNamed(panel, 'Contact_NickName');

            expect(backLink.attributes['aria-haspopup']).toBe('menu');
            expect(backLink.attributes['aria-expanded']).toBe('false');
            expect(backLink.attributes.title).toBe('Show the Contact that holds Contact_NickName');

            backLink.dispatch('click');

            expect(backLink.attributes['aria-expanded']).toBe('true');
            expect(contactElement.scrolledIntoViewCount || 0).toBe(0);
            const menuElement = openMenuOf(panel, panel.fieldRowNamed(caseElement, 'ContactId'));
            expect(menuElement.children[0].textContent).toBe(RECIPE_COCKPIT_PARENT_REFERENCE_MENU_HINT);
            expect(menuElement.children[1].attributes.role).toBe('menu');
            expect(menuElement.children[1].attributes['aria-labelledby']).toBe(menuElement.children[0].attributes.id);
            const items = backLinkMenuItemsOf(panel, 'Case_NickName', 'ContactId');
            expect(items.map((itemElement: any) => itemElement.textContent)).toEqual(['Contact']);
            expect(items[0].attributes.role).toBe('menuitem');
            expect(panel.activeElement()).toBe(items[0]);

        });

        it('opens the parent row from its list by click or Enter, focusing the parent\'s nickname', () => {

            const panel = renderModel(loadModel());
            const caseElement = objectElementNamed(panel, 'Case_NickName');
            panel.expandObject(caseElement);
            const contactElement = objectElementNamed(panel, 'Contact_NickName');

            backLinkOf(panel, 'Case_NickName', 'ContactId').dispatch('click');
            backLinkMenuItemsOf(panel, 'Case_NickName', 'ContactId')[0].dispatch('click');

            expect(contactElement.scrolledIntoViewCount).toBe(1);
            expect(panel.activeElement()).toBe(nicknameChipOf(panel, 'Contact_NickName'));
            expect(backLinkMenuItemsOf(panel, 'Case_NickName', 'ContactId')).toHaveLength(0);
            expect(backLinkOf(panel, 'Case_NickName', 'ContactId').attributes['aria-expanded']).toBe('false');

            backLinkOf(panel, 'Case_NickName', 'AccountId').dispatch('click');
            backLinkMenuItemsOf(panel, 'Case_NickName', 'AccountId')[0].dispatch('keydown', { key: 'Enter' });
            expect(objectElementNamed(panel, 'Account_NickName').scrolledIntoViewCount).toBe(1);
            expect(panel.activeElement()).toBe(nicknameChipOf(panel, 'Account_NickName'));

        });

        it('names a parent written more than once by its nickname, and marks an excluded parent', () => {

            const panel = renderModel(loadModel());
            const iterationElement = objectElementNamed(panel, 'Account_child_NickName');
            panel.expandObject(iterationElement);
            objectElementNamed(panel, 'Account_NickName').classList.add('excluded');

            backLinkOf(panel, 'Account_child_NickName', 'ParentId').dispatch('click');

            expect(backLinkMenuItemsOf(panel, 'Account_child_NickName', 'ParentId').map((itemElement: any) => itemElement.textContent)).toEqual(['Account · Account_NickName — excluded']);

        });

        it('closes the parent list on Escape (focus back), Tab, a second click and a click elsewhere', () => {

            const panel = renderModel(loadModel());
            panel.expandObject(objectElementNamed(panel, 'Case_NickName'));
            const backLink = backLinkOf(panel, 'Case_NickName', 'ContactId');

            backLink.dispatch('click');
            backLinkMenuItemsOf(panel, 'Case_NickName', 'ContactId')[0].dispatch('keydown', { key: 'Escape' });
            expect(backLinkMenuItemsOf(panel, 'Case_NickName', 'ContactId')).toHaveLength(0);
            expect(panel.activeElement()).toBe(backLink);
            expect(backLink.attributes['aria-expanded']).toBe('false');

            backLink.dispatch('click');
            backLinkMenuItemsOf(panel, 'Case_NickName', 'ContactId')[0].dispatch('keydown', { key: 'Tab' });
            expect(backLinkMenuItemsOf(panel, 'Case_NickName', 'ContactId')).toHaveLength(0);

            backLink.dispatch('click');
            backLink.dispatch('click');
            expect(backLinkMenuItemsOf(panel, 'Case_NickName', 'ContactId')).toHaveLength(0);
            expect(panel.activeElement()).toBe(backLink);

            backLink.dispatch('click');
            objectElementNamed(panel, 'Lead_NickName').children[0].dispatch('click');
            expect(backLinkMenuItemsOf(panel, 'Case_NickName', 'ContactId')).toHaveLength(0);

        });

        it('keeps one list open across both kinds', () => {

            const panel = renderModel(loadModel());
            panel.expandObject(objectElementNamed(panel, 'Case_NickName'));
            const backLink = backLinkOf(panel, 'Case_NickName', 'ContactId');

            nicknameChipOf(panel, 'Account_NickName').dispatch('click');
            backLink.dispatch('click');
            expect(menuItemsOf(panel, 'Account_NickName')).toHaveLength(0);
            expect(nicknameChipOf(panel, 'Account_NickName').attributes['aria-expanded']).toBe('false');
            expect(backLinkMenuItemsOf(panel, 'Case_NickName', 'ContactId')).toHaveLength(1);

            nicknameChipOf(panel, 'Account_NickName').dispatch('click');
            expect(backLinkMenuItemsOf(panel, 'Case_NickName', 'ContactId')).toHaveLength(0);
            expect(backLink.attributes['aria-expanded']).toBe('false');
            expect(menuItemsOf(panel, 'Account_NickName')).toHaveLength(4);

        });

        it('posts nothing to the host but the saved place', () => {

            const panel = renderModel(loadModel());
            panel.expandObject(objectElementNamed(panel, 'Case_NickName'));
            const postedCount = panel.postedHostMessages.length;

            nicknameChipOf(panel, 'Contact_NickName').dispatch('click');
            backLinkOf(panel, 'Case_NickName', 'ContactId').dispatch('click');
            backLinkMenuItemsOf(panel, 'Case_NickName', 'ContactId')[0].dispatch('click');

            expect(panel.postedHostMessages.slice(postedCount).filter((hostMessage: any) => hostMessage.command !== 'savePlace')).toEqual([]);

        });

    });

    describe('a flat snowfakery tree whose lookups #151 wired', () => {

        const SNOWFAKERY_OBJECTS = ['Account', 'Product_Family__c', 'Contact', 'Example_Everything__c', 'MegaMapMadness__c', 'Opportunity', 'Order__c', 'Product__c', 'MasterDetailMadness__c', 'Order_Item__c'];

        it('lists the wired fields under the parent\'s nickname and draws their way back', () => {

            writeWorkspace(WIRED_SNOWFAKERY_RECIPE, SNOWFAKERY_OBJECTS);
            const panel = renderModel(loadModel());

            nicknameChipOf(panel, 'Account_NickName').dispatch('click');
            expect(menuItemLabels(panel, 'Account_NickName')).toEqual(['Contact.AccountId', 'Opportunity.AccountId']);

            menuItemsOf(panel, 'Account_NickName')[1].dispatch('click');
            const opportunityAccountRow = panel.fieldRowNamed(objectElementNamed(panel, 'Opportunity_NickName'), 'AccountId');
            expect(panel.findAll(opportunityAccountRow, 'treeNicknameBackLink').map((element: any) => element.textContent)).toEqual(['↖ Account_NickName']);

        });

        it('draws every nickname as text before a lookup is wired', () => {

            writeWorkspace(SNOWFAKERY_RECIPE, SNOWFAKERY_OBJECTS);
            const panel = renderModel(loadModel());

            expect(panel.findAll(panel.cockpitBodyElement, 'treeNickname').every((element: any) => element.tagName === 'span')).toBe(true);
            expect(panel.findAll(panel.cockpitBodyElement, 'treeNickname')).toHaveLength(SNOWFAKERY_OBJECTS.length);

        });

    });

    describe('what is never a reference', () => {

        const buildRecipe = (blocks: { objectApiName: string; nickname: string; fields: string[] }[]) => blocks
            .map(block => [`- object: ${block.objectApiName}`, `  nickname: ${block.nickname}`, '  count: 1', '  fields:', ...block.fields.map(field => `    ${field}`), ''].join('\n'))
            .join('\n');

        const backLinksOf = (panel: any) => {
            panel.objectElements().forEach((objectElement: any) => panel.expandObject(objectElement));
            return panel.findAll(panel.cockpitBodyElement, 'treeNicknameBackLink').map((element: any) => element.textContent);
        };

        it('a value that only contains a nickname, one quoted, or one with more than a comment after it', () => {

            writeWorkspace(buildRecipe([
                { objectApiName: 'Account', nickname: 'Account_NickName', fields: ['Name: Acme'] },
                { objectApiName: 'Contact', nickname: 'Contact_Account_NickName', fields: [
                    'AccountId: Contact_Account_NickName_2',
                    'Other__c: "Account_NickName"',
                    'Third__c: Account_NickName and more',
                    'Fourth__c: |',
                    '      Account_NickName',
                    '      ${{ faker.word.noun() }}',
                    'Fifth__c: Account_NickName',
                    '    ### TODO -- RECORD TYPE BLOCKS -- a note under the lookup'
                ] }
            ]), ['Account', 'Contact']);

            expect(backLinksOf(renderModel(loadModel()))).toEqual(['↖ Account_NickName']);

        });

        it('a nickname YAML loads as a boolean or null, and one that is not a plain name', () => {

            writeWorkspace(buildRecipe([
                { objectApiName: 'Account', nickname: 'Yes', fields: ['Name: Acme'] },
                { objectApiName: 'Lead', nickname: 'null', fields: ['LastName: Smith'] },
                { objectApiName: 'Contact', nickname: 'Contact_NickName', fields: ['AccountId: Yes', 'LeadId: null'] }
            ]), ['Account', 'Lead', 'Contact']);
            const panel = renderModel(loadModel());

            expect(backLinksOf(panel)).toEqual([]);
            expect(nicknameChipOf(panel, 'Yes').attributes.title).toBe('Yes does not name exactly one object of this recipe, so no field can point to it');

        });

        it('a nickname two objects of the recipe hold', () => {

            writeWorkspace(buildRecipe([
                { objectApiName: 'Account', nickname: 'Shared_NickName', fields: ['Name: Acme'] },
                { objectApiName: 'Lead', nickname: 'Shared_NickName', fields: ['LastName: Smith'] },
                { objectApiName: 'Contact', nickname: 'Contact_NickName', fields: ['AccountId: Shared_NickName'] }
            ]), ['Account', 'Lead', 'Contact']);
            const panel = renderModel(loadModel());

            expect(backLinksOf(panel)).toEqual([]);
            expect(panel.findAll(panel.cockpitBodyElement, 'treeNickname').filter((element: any) => element.tagName === 'button')).toHaveLength(0);

        });

        it('a nickname of an object written twice with nothing to tell the occurrences apart', () => {

            writeWorkspace(buildRecipe([
                { objectApiName: 'Account', nickname: 'Account_NickName', fields: ['Name: Acme'] },
                { objectApiName: 'Account', nickname: 'Account_NickName', fields: ['Name: Other'] },
                { objectApiName: 'Contact', nickname: 'Contact_NickName', fields: ['AccountId: Account_NickName'] }
            ]), ['Account', 'Contact']);
            const recipeViewModel = loadModel();

            expect(recipeViewModel.objects.find(object => object.objectApiName === 'Account')).toMatchObject({ hasIndistinctOccurrences: true });
            expect(backLinksOf(renderModel(recipeViewModel))).toEqual([]);

        });

        it('a nickname another card holds', () => {

            writeWorkspace(buildRecipe([
                { objectApiName: 'Account', nickname: 'Account_NickName', fields: ['Name: Acme'] },
                { objectApiName: 'Contact', nickname: 'Contact_NickName', fields: ['AccountId: Account_NickName'] }
            ]), ['Account', 'Contact']);
            const recipeViewModel = loadModel();
            const [tree] = recipeViewModel.trees;
            const splitModel = { ...recipeViewModel, trees: [
                { ...tree, objects: tree.objects.filter(treeObject => treeObject.objectApiName === 'Account') },
                { ...tree, treeKey: 'Other', title: 'Other', objects: tree.objects.filter(treeObject => treeObject.objectApiName === 'Contact') }
            ] };

            const panel = renderModel(splitModel);

            expect(backLinksOf(panel)).toEqual([]);
            expect(panel.findAll(panel.cockpitBodyElement, 'treeNickname').filter((element: any) => element.tagName === 'button')).toHaveLength(0);

        });

        it('a hand edit naming objects and nicknames after prototype members breaks nothing', () => {

            writeWorkspace(buildRecipe([
                { objectApiName: 'constructor', nickname: '__proto__', fields: ['Name: Acme'] },
                { objectApiName: 'toString', nickname: 'constructor', fields: ['Name: Other'] },
                { objectApiName: 'Contact', nickname: 'hasOwnProperty', fields: ['First__c: __proto__', 'Second__c: constructor', 'Third__c: toString'] }
            ]), ['constructor', 'toString', 'Contact']);
            const panel = renderModel(loadModel());

            expect(panel.objectElements()).toHaveLength(3);
            expect(backLinksOf(panel)).toEqual(['↖ constructor']);
            expect(panel.findAll(panel.cockpitBodyElement, 'treeNicknameText').map((element: any) => element.textContent)).toEqual(['__proto__', 'constructor', 'hasOwnProperty']);

        });

    });

});
