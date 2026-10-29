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

import { RecipeCockpitService, IRecipeCockpitRecipeViewModel, RECIPE_COCKPIT_FRIEND_EMOJI, RECIPE_COCKPIT_FRIENDS_MENU_HINT } from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    A parent row's 👥 N (#492): the friend rows #411's index numbers under it, listed under the
    row's header, each taking the reader to that friend and its chip pointing back.
*/

const RUN_FOLDER_NAME = 'recipe-2026-10-01T00-00-00';
const TREE_KEY = 'RelationshipTree_1';
const MOCKS_PATH = path.join(__dirname, 'mocks', 'recipeWriter');
const FAKER_JS_RECIPE = fs.readFileSync(path.join(MOCKS_PATH, 'recipe-fakerjs-selfLookupFriends--RelationshipTree_1.yml'), 'utf-8');
const SNOWFAKERY_RECIPE = fs.readFileSync(path.join(MOCKS_PATH, 'recipe-snowfakery--RelationshipTree_1.yml'), 'utf-8');

const ACCOUNT_FRIEND_LABELS = [
    'Account_NickName-1: Contact',
    'Account_NickName-2: Case',
    'Account_NickName-3: Opportunity',
    'Account_NickName-4: Account · Account_child_NickName'
];

describe('RecipeCockpitService, a parent row\'s friends list (#492)', () => {

    let workspaceRoot: string;

    const writeWorkspace = (recipeText: string, objectApiNames: string[], selfLookupObjectApiName?: string) => {

        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-friends-menu-'));
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

    const objectElementNamed = (panel: any, nickname: string) => panel.objectElements()
        .find((objectElement: any) => panel.findAll(objectElement.children[0], 'treeNicknameText').some((nicknameElement: any) => nicknameElement.textContent === nickname));
    const friendsButtonOf = (panel: any, nickname: string) => panel.findAll(objectElementNamed(panel, nickname).children[0], 'treeFriendsButton')[0];
    const nicknameChipOf = (panel: any, nickname: string) => panel.findAll(objectElementNamed(panel, nickname).children[0], 'treeNickname')[0];
    const friendsMenuOf = (panel: any, nickname: string) => {
        const menus = panel.findAll(objectElementNamed(panel, nickname).children[0], 'treeNicknameMenu').filter((menuElement: any) => !panel.isHidden(menuElement));
        return menus[0];
    };
    const friendItemsOf = (panel: any, nickname: string) => {
        const menuElement = friendsMenuOf(panel, nickname);
        return menuElement ? panel.findAll(menuElement, 'treeNicknameMenuItem') : [];
    };
    const friendItemLabels = (panel: any, nickname: string) => friendItemsOf(panel, nickname).map((itemElement: any) => itemElement.textContent);
    const friendChipsOf = (panel: any, nickname: string) => panel.findAll(objectElementNamed(panel, nickname).children[0], 'treeFriendChip');

    describe('a faker-js tree nested under friends:', () => {

        beforeEach(() => writeWorkspace(FAKER_JS_RECIPE, ['Account', 'Contact', 'Case', 'Opportunity', 'Lead'], 'Account'));

        it('draws 👥 N right after the nickname, only on a row with friends', () => {

            const panel = renderModel(loadModel());

            const accountButton = friendsButtonOf(panel, 'Account_NickName');
            expect(accountButton.tagName).toBe('button');
            expect(accountButton.classList.contains('sdtButton-secondary')).toBe(true);
            expect(accountButton.classList.contains('sdtButton-compact')).toBe(true);
            expect(accountButton.attributes['aria-haspopup']).toBe('menu');
            expect(accountButton.attributes['aria-expanded']).toBe('false');
            expect(accountButton.attributes['aria-label']).toBe('Account: 4 friends');
            expect(accountButton.children[0].classList.contains('treeChipEmoji')).toBe(true);
            expect(accountButton.children[0].textContent).toBe(RECIPE_COCKPIT_FRIEND_EMOJI);
            expect(accountButton.children[0].attributes['aria-hidden']).toBe('true');
            expect(panel.findAll(accountButton, 'treeFriendsCount')[0].textContent).toBe('4');

            const slotChildren = nicknameChipOf(panel, 'Account_NickName').parentNode.children;
            expect(slotChildren.indexOf(accountButton)).toBe(slotChildren.indexOf(nicknameChipOf(panel, 'Account_NickName')) + 1);

            expect(friendsButtonOf(panel, 'Contact_NickName').attributes['aria-label']).toBe('Contact: 1 friend');
            ['Account_child_NickName', 'Case_NickName', 'Opportunity_NickName', 'Lead_NickName'].forEach(nickname => {
                expect(friendsButtonOf(panel, nickname)).toBeUndefined();
            });

        });

        it('opens a list led by its hint, then every friend in recipe order, labelled as its chip reads', () => {

            const panel = renderModel(loadModel());
            const accountButton = friendsButtonOf(panel, 'Account_NickName');

            accountButton.dispatch('click');

            const menuElement = friendsMenuOf(panel, 'Account_NickName');
            const hintElement = menuElement.children[0];
            const itemsElement = menuElement.children[1];
            expect(hintElement.classList.contains('treeNicknameMenuHint')).toBe(true);
            expect(hintElement.textContent).toBe(RECIPE_COCKPIT_FRIENDS_MENU_HINT);
            expect(RECIPE_COCKPIT_FRIENDS_MENU_HINT).toBe('Click to go to a friend');
            expect(hintElement.attributes.tabindex).toBeUndefined();
            expect(itemsElement.attributes.role).toBe('menu');
            expect(itemsElement.attributes['aria-labelledby']).toBe(hintElement.attributes.id);

            expect(friendItemLabels(panel, 'Account_NickName')).toEqual(ACCOUNT_FRIEND_LABELS);
            expect(accountButton.attributes['aria-expanded']).toBe('true');
            expect(panel.activeElement()).toBe(friendItemsOf(panel, 'Account_NickName')[0]);

            // EACH LABEL STARTS WITH THE CHIP ITS FRIEND DRAWS FOR THIS PARENT
            friendItemsOf(panel, 'Account_NickName').forEach((itemElement: any) => {
                const chipLabel = itemElement.textContent.split(':')[0];
                const chipLabels = panel.findAll(panel.cockpitBodyElement, 'treeFriendLabel').map((labelElement: any) => labelElement.textContent);
                expect(chipLabels).toContain(chipLabel);
            });

        });

        it('opens the chosen friend\'s row, by click or by Enter, and focuses its chip pointing back to this parent', () => {

            const panel = renderModel(loadModel());
            const caseElement = objectElementNamed(panel, 'Case_NickName');
            expect(panel.isHidden(panel.objectBodyOf(caseElement))).toBe(true);
            const postedCount = panel.postedHostMessages.length;

            friendsButtonOf(panel, 'Account_NickName').dispatch('click');
            friendItemsOf(panel, 'Account_NickName')[1].dispatch('click');

            expect(panel.isHidden(panel.objectBodyOf(caseElement))).toBe(false);
            // CASE'S SECOND CHIP IS THE ONE FOR Account_NickName; ITS FIRST IS Contact_NickName'S
            expect(panel.activeElement()).toBe(friendChipsOf(panel, 'Case_NickName')[1]);
            expect(friendItemsOf(panel, 'Account_NickName')).toHaveLength(0);
            expect(friendsButtonOf(panel, 'Account_NickName').attributes['aria-expanded']).toBe('false');

            friendsButtonOf(panel, 'Contact_NickName').dispatch('click');
            friendItemsOf(panel, 'Contact_NickName')[0].dispatch('keydown', { key: 'Enter' });
            expect(panel.activeElement()).toBe(friendChipsOf(panel, 'Case_NickName')[0]);

            expect(panel.postedHostMessages.slice(postedCount).filter((hostMessage: any) => hostMessage.command !== 'savePlace')).toEqual([]);

        });

        it('marks a friend the tree icon excluded, and rebuilds the list on every open', () => {

            const panel = renderModel(loadModel());

            friendsButtonOf(panel, 'Account_NickName').dispatch('click');
            friendsButtonOf(panel, 'Account_NickName').dispatch('click');
            objectElementNamed(panel, 'Opportunity_NickName').classList.add('excluded');
            friendsButtonOf(panel, 'Account_NickName').dispatch('click');

            expect(friendItemLabels(panel, 'Account_NickName')[2]).toBe('Account_NickName-3: Opportunity — excluded');

        });

        it('moves with the arrow keys, Home and End, gives focus back on Escape, and closes on Tab, a second click and a click elsewhere', () => {

            const panel = renderModel(loadModel());
            const accountButton = friendsButtonOf(panel, 'Account_NickName');

            accountButton.dispatch('click');
            let items = friendItemsOf(panel, 'Account_NickName');
            items[0].dispatch('keydown', { key: 'ArrowDown' });
            expect(panel.activeElement()).toBe(items[1]);
            items[1].dispatch('keydown', { key: 'ArrowUp' });
            items[0].dispatch('keydown', { key: 'ArrowUp' });
            expect(panel.activeElement()).toBe(items[3]);
            items[3].dispatch('keydown', { key: 'Home' });
            expect(panel.activeElement()).toBe(items[0]);
            items[0].dispatch('keydown', { key: 'End' });
            expect(panel.activeElement()).toBe(items[3]);
            items[3].dispatch('keydown', { key: 'Escape' });
            expect(friendItemsOf(panel, 'Account_NickName')).toHaveLength(0);
            expect(panel.activeElement()).toBe(accountButton);
            expect(accountButton.attributes['aria-expanded']).toBe('false');

            accountButton.dispatch('click');
            items = friendItemsOf(panel, 'Account_NickName');
            items[0].dispatch('keydown', { key: ' ' });
            expect(panel.activeElement()).toBe(friendChipsOf(panel, 'Contact_NickName')[0]);

            accountButton.dispatch('click');
            friendItemsOf(panel, 'Account_NickName')[0].dispatch('keydown', { key: 'Tab' });
            expect(friendItemsOf(panel, 'Account_NickName')).toHaveLength(0);

            accountButton.dispatch('click');
            accountButton.dispatch('click');
            expect(friendItemsOf(panel, 'Account_NickName')).toHaveLength(0);
            expect(panel.activeElement()).toBe(accountButton);

            accountButton.dispatch('click');
            objectElementNamed(panel, 'Lead_NickName').children[0].dispatch('click');
            expect(friendItemsOf(panel, 'Account_NickName')).toHaveLength(0);

        });

        it('keeps one list open at a time across the 🌳, back-link and friends lists', () => {

            const panel = renderModel(loadModel());
            panel.expandObject(objectElementNamed(panel, 'Case_NickName'));
            const backLink = panel.findAll(panel.fieldRowNamed(objectElementNamed(panel, 'Case_NickName'), 'ContactId'), 'treeNicknameBackLink')[0];
            const nicknameMenuItems = () => panel.findAll(panel.cockpitBodyElement, 'treeNicknameMenuItem');

            friendsButtonOf(panel, 'Account_NickName').dispatch('click');
            nicknameChipOf(panel, 'Account_NickName').dispatch('click');
            expect(friendsButtonOf(panel, 'Account_NickName').attributes['aria-expanded']).toBe('false');
            expect(nicknameChipOf(panel, 'Account_NickName').attributes['aria-expanded']).toBe('true');
            expect(nicknameMenuItems()).toHaveLength(4);

            friendsButtonOf(panel, 'Account_NickName').dispatch('click');
            expect(nicknameChipOf(panel, 'Account_NickName').attributes['aria-expanded']).toBe('false');
            expect(nicknameMenuItems().map((itemElement: any) => itemElement.textContent)).toEqual(ACCOUNT_FRIEND_LABELS);

            backLink.dispatch('click');
            expect(friendsButtonOf(panel, 'Account_NickName').attributes['aria-expanded']).toBe('false');
            expect(nicknameMenuItems()).toHaveLength(1);

            friendsButtonOf(panel, 'Contact_NickName').dispatch('click');
            expect(backLink.attributes['aria-expanded']).toBe('false');
            expect(nicknameMenuItems().map((itemElement: any) => itemElement.textContent)).toEqual(['Contact_NickName-1: Case']);

        });

        it('joins no search: the Treecipe search finds no row by the button\'s count', () => {

            const panel = renderModel(loadModel());
            panel.typeIntoFilter('4');

            expect(panel.visibleFieldNamesOf(objectElementNamed(panel, 'Account_NickName'))).toEqual([]);

        });

    });

    describe('a flat snowfakery tree', () => {

        it('draws no friends button on any row, even one whose nickname a lookup holds', () => {

            writeWorkspace(SNOWFAKERY_RECIPE.replace('AccountId: ### TODO -- REFERENCE ID REQUIRED', 'AccountId: Account_NickName'), ['Account', 'Contact', 'Opportunity']);
            const panel = renderModel(loadModel());

            expect(panel.findAll(panel.cockpitBodyElement, 'treeFriendsButton')).toEqual([]);

        });

    });

    describe('a root whose every row is a friend', () => {

        it('lists every friend in recipe order', () => {

            const contactBlocks = Array.from({ length: 300 }, (_unused, contactIndex) => [
                '    - object: Contact',
                `      nickname: Contact_${contactIndex}_NickName`,
                '      count: 1',
                '      fields:',
                '        LastName: Smith'
            ].join('\n')).join('\n');
            writeWorkspace(['- object: Account', '  nickname: Account_NickName', '  count: 1', '  fields:', '    Name: Acme', '  friends:', contactBlocks, ''].join('\n'), ['Account', 'Contact']);

            const panel = renderModel(loadModel());
            friendsButtonOf(panel, 'Account_NickName').dispatch('click');

            expect(friendsButtonOf(panel, 'Account_NickName').attributes['aria-label']).toBe('Account: 300 friends');
            const labels = friendItemLabels(panel, 'Account_NickName');
            expect(labels).toHaveLength(300);
            expect(labels[0]).toBe('Account_NickName-1: Contact · Contact_0_NickName');
            expect(labels[299]).toBe('Account_NickName-300: Contact · Contact_299_NickName');

        });

    });

});
