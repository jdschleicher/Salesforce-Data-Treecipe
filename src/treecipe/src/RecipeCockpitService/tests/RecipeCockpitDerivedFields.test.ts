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

import { RecipeCockpitService } from '../RecipeCockpitService';
import {
    RECIPE_COCKPIT_DERIVED_FIELD_BADGE_LABEL,
    RECIPE_COCKPIT_DERIVED_FIELD_REASON_PREFIX
} from '../RecipeCockpitFieldRowsConstants';
import { RecipeCockpitModelBuild } from '../RecipeCockpitModelBuild';
import { RecipeCockpitTreeSelectionStore } from '../RecipeCockpitTreeSelectionStore';
import { RecipeCockpitRecipeWriter } from '../../RecipeWriter/RecipeCockpitRecipeWriter';
import { IRecipeCockpitRecipeViewModel } from '../RecipeCockpitViewModel';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    #680: Quote.AccountId is set by Salesforce from the quote's Opportunity, so generation writes it
    as "AccountId: Opportunity_NickName.AccountId". Its row on the Treecipe tab is read only, says
    which lookup sets it and which Account that Opportunity holds, and links to the Opportunity row.
*/

const RUN_FOLDER_NAME = 'recipe-2026-11-20T00-00-00';
const TREE_KEY = 'RelationshipTree_1';

// THE SHAPE GENERATION WRITES; opportunityAccountIdValue IS A NICKNAME ONCE THE OPPORTUNITY'S LOOKUP IS WIRED, ELSE THE TODO
const buildQuoteRecipe = (opportunityAccountIdValue: string) => [
    '- object: Account',
    '  nickname: Account_NickName',
    '  count: 1',
    '  fields:',
    '    Name: Acme',
    '- object: Opportunity',
    '  nickname: Opportunity_NickName',
    '  count: 1',
    '  fields:',
    `    AccountId: ${opportunityAccountIdValue}`,
    '    Name: Deal',
    '- object: Quote',
    '  nickname: Quote_NickName',
    '  count: 1',
    '  fields:',
    '    AccountId: Opportunity_NickName.AccountId',
    '    OpportunityId: Opportunity_NickName',
    '    Name: Q-1',
    ''
].join('\n');

describe('RecipeCockpitService, a field Salesforce sets from another lookup (#680)', () => {

    let workspaceRoot: string;

    const writeWorkspace = (recipeText: string) => {

        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-derived-'));
        const runFolderPath = path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', RUN_FOLDER_NAME);
        fs.mkdirSync(path.join(runFolderPath, TREE_KEY), { recursive: true });

        const relationshipDetailOf = (level: number, parentObjectToFieldReferences: Record<string, string[]>) => ({ Fields: [], RelationshipDetail: { level, parentObjectToFieldReferences } });
        fs.writeFileSync(path.join(runFolderPath, 'treecipeObjectsWrapper-2026-11-20T00-00-00.json'), JSON.stringify({
            ObjectToObjectInfoMap: {
                Account: relationshipDetailOf(0, {}),
                Opportunity: relationshipDetailOf(1, { Account: ['AccountId'] }),
                Quote: relationshipDetailOf(2, { Account: ['AccountId'], Opportunity: ['OpportunityId'] })
            },
            RecipeFiles: [{ objects: ['Account', 'Opportunity', 'Quote'] }]
        }));
        fs.writeFileSync(path.join(runFolderPath, TREE_KEY, `recipe--${TREE_KEY}-2026-11-20T00-00-00.yml`), recipeText);

    };

    afterEach(() => {
        if ( workspaceRoot ) { fs.rmSync(workspaceRoot, { recursive: true, force: true }); }
    });

    const loadModel = (): IRecipeCockpitRecipeViewModel => RecipeCockpitModelBuild.buildRecipeViewModel(workspaceRoot);

    const renderModel = (recipeViewModel: IRecipeCockpitRecipeViewModel) => {
        const panel = runPanelScript();
        panel.postToPanel({ command: 'recipeData', recipe: recipeViewModel, renderSequence: 1 });
        panel.expandAllTrees();
        panel.objectElements().forEach((objectElement: any) => panel.expandObject(objectElement));
        return panel;
    };

    const objectElementNamed = (panel: any, nickname: string) => panel.objectElements()
        .find((objectElement: any) => panel.findAll(objectElement.children[0], 'treeNicknameText').some((nicknameElement: any) => nicknameElement.textContent === nickname));
    const quoteAccountIdRow = (panel: any) => panel.fieldRowNamed(objectElementNamed(panel, 'Quote_NickName'), 'AccountId');

    test('the row is marked read only and names the lookup that sets it and the Account its Opportunity holds', () => {

        writeWorkspace(buildQuoteRecipe('Account_NickName'));
        const panel = renderModel(loadModel());
        const accountIdRow = quoteAccountIdRow(panel);
        const [badgeElement] = panel.findAll(accountIdRow, 'derivedFieldBadge');

        expect(badgeElement.textContent).toBe(RECIPE_COCKPIT_DERIVED_FIELD_BADGE_LABEL);
        expect(badgeElement.attributes.title).toBe('Salesforce sets AccountId from OpportunityId, so it is never inserted');
        expect(panel.findAll(accountIdRow, 'derivedFieldNote').map((noteElement: any) => noteElement.textContent)).toEqual([`${RECIPE_COCKPIT_DERIVED_FIELD_REASON_PREFIX}OpportunityId → Account_NickName`]);
        expect(panel.findAll(accountIdRow, 'expression').map((expressionElement: any) => expressionElement.textContent)).toEqual(['Opportunity_NickName.AccountId']);

    });

    test('the value links to the Opportunity row it comes from, and opening it scrolls there', () => {

        writeWorkspace(buildQuoteRecipe('Account_NickName'));
        const panel = renderModel(loadModel());
        const accountIdRow = quoteAccountIdRow(panel);
        const [backLink] = panel.findAll(accountIdRow, 'treeNicknameBackLink');

        expect(backLink.textContent).toBe('↖ Opportunity_NickName');
        backLink.dispatch('click');
        panel.findAll(accountIdRow, 'treeNicknameMenuItem')[0].dispatch('click');

        expect(objectElementNamed(panel, 'Opportunity_NickName').scrolledIntoViewCount).toBe(1);

    });

    test('the pencil is disabled with the reason, in the panel and in the host that checks it before writing', () => {

        writeWorkspace(buildQuoteRecipe('Account_NickName'));
        const recipeViewModel = loadModel();
        const panel = renderModel(recipeViewModel);
        const [pinElement] = panel.findAll(quoteAccountIdRow(panel), 'treeFieldFixedValue');
        const tree = recipeViewModel.trees[0];
        const quoteObject = tree.objects.find(treeObject => treeObject.objectApiName === 'Quote');
        const quoteAccountIdField = recipeViewModel.objects.find(object => object.objectApiName === 'Quote').fields.find(field => field.fieldApiName === 'AccountId');

        expect(pinElement.disabled).toBeTrue();
        expect(pinElement.attributes.title).toBe(`Cannot be edited: ${RECIPE_COCKPIT_DERIVED_FIELD_REASON_PREFIX}OpportunityId`);
        expect(RecipeCockpitTreeSelectionStore.findFixedValueLockReason(tree, quoteObject as any, quoteAccountIdField)).toBe(`${RECIPE_COCKPIT_DERIVED_FIELD_REASON_PREFIX}OpportunityId`);

    });

    test('with the Opportunity\'s AccountId still a TODO, the note names only the lookup that sets it', () => {

        writeWorkspace(buildQuoteRecipe('### TODO -- REFERENCE ID REQUIRED'));
        const panel = renderModel(loadModel());

        expect(panel.findAll(quoteAccountIdRow(panel), 'derivedFieldNote').map((noteElement: any) => noteElement.textContent)).toEqual([`${RECIPE_COCKPIT_DERIVED_FIELD_REASON_PREFIX}OpportunityId`]);

    });

    test('the Opportunity\'s nickname lists Quote.AccountId among the fields that point to it', () => {

        writeWorkspace(buildQuoteRecipe('Account_NickName'));
        const panel = renderModel(loadModel());
        const opportunityHeader = objectElementNamed(panel, 'Opportunity_NickName').children[0];

        panel.findAll(opportunityHeader, 'treeNickname')[0].dispatch('click');

        expect(panel.findAll(opportunityHeader, 'treeNicknameMenuItem').map((itemElement: any) => itemElement.textContent).join('\n')).toContain('AccountId');

    });

    test('no other field of the tree is marked read only', () => {

        writeWorkspace(buildQuoteRecipe('Account_NickName'));
        const panel = renderModel(loadModel());

        expect(panel.findAll(panel.cockpitBodyElement, 'derivedFieldBadge')).toHaveLength(1);

    });

});

/*
    #704: the read-only row follows the record the Quote's OpportunityId holds NOW. A snowfakery
    recipe with two Opportunity record type blocks writes AccountId naming the first block while
    OpportunityId is still a TODO; once Wire lookup points OpportunityId at the other block, the
    row's link and note follow it, and the recipe line stays as generated.
*/
describe('RecipeCockpitService, a derived field follows its through lookup (#704)', () => {

    let workspaceRoot: string;

    const ENTERPRISE = 'Opportunity_Enterprise_NickName';
    const SMB = 'Opportunity_SMB_NickName';
    const GENERATED_ACCOUNT_ID_LINE = `    AccountId: ${ENTERPRISE}.AccountId`;

    const buildOpportunityBlock = (nickname: string, recordTypeName: string, accountNickname: string) => [
        '- object: Opportunity',
        `  nickname: ${nickname}`,
        '  count: 1',
        '  fields:',
        `    RecordTypeId: Opportunity.${recordTypeName}`,
        '    Name: ${{fake.catch_phrase}}',
        `    AccountId: ${accountNickname}`
    ];

    // THE SHAPE THE FLAT SNOWFAKERY WRITER GIVES A QUOTE WHOSE OPPORTUNITY HAS TWO SELECTED RECORD TYPES (#705)
    const buildSnowfakeryQuoteRecipe = (opportunityIdLines: string[]) => [
        '- object: Account',
        '  nickname: Account_NickName',
        '  count: 1',
        '  fields:',
        '    Name: ${{fake.company}}',
        '- object: Account',
        '  nickname: Account_Partner_NickName',
        '  count: 1',
        '  fields:',
        '    Name: ${{fake.company}}',
        ...buildOpportunityBlock(ENTERPRISE, 'Enterprise', 'Account_NickName'),
        ...buildOpportunityBlock(SMB, 'SMB', 'Account_Partner_NickName'),
        '- object: Quote',
        '  nickname: Quote_NickName',
        '  count: 1',
        '  fields:',
        GENERATED_ACCOUNT_ID_LINE,
        ...opportunityIdLines,
        '    Name: ${{fake.catch_phrase}}',
        ''
    ].join('\n');

    const GENERATED_RECIPE = buildSnowfakeryQuoteRecipe([
        '    OpportunityId: ### TODO -- REFERENCE ID REQUIRED',
        `    ### TODO -- RECORD TYPE BLOCKS -- OpportunityId can reference any record type block of Opportunity: ${ENTERPRISE}, ${SMB}`
    ]);

    const wireQuoteOpportunityId = (recipeText: string, parentNickname: string): string => {
        const wiringResult = RecipeCockpitRecipeWriter.wireLookups(recipeText,
            [{ objectApiName: 'Quote', fieldApiName: 'OpportunityId', parentNickname }],
            { parentLookupsByObjectApiName: new Map([
                ['Opportunity', [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }]],
                ['Quote', [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }, { fieldApiName: 'OpportunityId', parentObjectApiName: 'Opportunity' }]]
            ]), levelsByObjectApiName: new Map([['Account', 0], ['Opportunity', 1], ['Quote', 2]]) });
        if ( 'refusal' in wiringResult ) { throw new Error(wiringResult.refusal.message); }
        return wiringResult.recipeText;
    };

    const writeWorkspace = (recipeText: string) => {

        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-derived-through-'));
        const runFolderPath = path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', RUN_FOLDER_NAME);
        fs.mkdirSync(path.join(runFolderPath, TREE_KEY), { recursive: true });

        const relationshipDetailOf = (level: number, parentObjectToFieldReferences: Record<string, string[]>) => ({ Fields: [], RelationshipDetail: { level, parentObjectToFieldReferences } });
        fs.writeFileSync(path.join(runFolderPath, 'treecipeObjectsWrapper-2026-11-20T00-00-00.json'), JSON.stringify({
            ObjectToObjectInfoMap: {
                Account: relationshipDetailOf(0, {}),
                Opportunity: relationshipDetailOf(1, { Account: ['AccountId'] }),
                Quote: relationshipDetailOf(2, { Account: ['AccountId'], Opportunity: ['OpportunityId'] })
            },
            RecipeFiles: [{ objects: ['Account', 'Opportunity', 'Quote'] }]
        }));
        fs.writeFileSync(path.join(runFolderPath, TREE_KEY, `recipe--${TREE_KEY}-2026-11-20T00-00-00.yml`), recipeText);

    };

    afterEach(() => {
        if ( workspaceRoot ) { fs.rmSync(workspaceRoot, { recursive: true, force: true }); }
    });

    const renderRecipe = (recipeText: string) => {
        writeWorkspace(recipeText);
        const panel = runPanelScript();
        panel.postToPanel({ command: 'recipeData', recipe: RecipeCockpitModelBuild.buildRecipeViewModel(workspaceRoot), renderSequence: 1 });
        panel.expandAllTrees();
        panel.objectElements().forEach((objectElement: any) => panel.expandObject(objectElement));
        return panel;
    };

    const objectElementNamed = (panel: any, nickname: string) => panel.objectElements()
        .find((objectElement: any) => panel.findAll(objectElement.children[0], 'treeNicknameText').some((nicknameElement: any) => nicknameElement.textContent === nickname));

    // WHAT THE ROW SAYS: ITS BACK LINK AND ITS NOTE
    const readQuoteAccountIdRow = (panel: any) => {
        const accountIdRow = panel.fieldRowNamed(objectElementNamed(panel, 'Quote_NickName'), 'AccountId');
        return {
            backLinks: panel.findAll(accountIdRow, 'treeNicknameBackLink').map((linkElement: any) => linkElement.textContent),
            notes: panel.findAll(accountIdRow, 'derivedFieldNote').map((noteElement: any) => noteElement.textContent)
        };
    };

    const listFieldsPointingTo = (panel: any, nickname: string): string => {
        const objectHeader = objectElementNamed(panel, nickname).children[0];
        panel.findAll(objectHeader, 'treeNickname')[0].dispatch('click');
        return panel.findAll(objectHeader, 'treeNicknameMenuItem').map((itemElement: any) => itemElement.textContent).join('\n');
    };

    test('before wiring, OpportunityId is a TODO, so the row names the block its own value was written with', () => {

        const panel = renderRecipe(GENERATED_RECIPE);

        expect(readQuoteAccountIdRow(panel)).toEqual({
            backLinks: [`↖ ${ENTERPRISE}`],
            notes: [`${RECIPE_COCKPIT_DERIVED_FIELD_REASON_PREFIX}OpportunityId → Account_NickName`]
        });

    });

    test('after Wire lookup points OpportunityId at the SMB block, the row links to it and names the Account it holds', () => {

        const wiredRecipe = wireQuoteOpportunityId(GENERATED_RECIPE, SMB);
        const panel = renderRecipe(wiredRecipe);

        expect(readQuoteAccountIdRow(panel)).toEqual({
            backLinks: [`↖ ${SMB}`],
            notes: [`${RECIPE_COCKPIT_DERIVED_FIELD_REASON_PREFIX}OpportunityId → Account_Partner_NickName`]
        });

        const [backLink] = panel.findAll(panel.fieldRowNamed(objectElementNamed(panel, 'Quote_NickName'), 'AccountId'), 'treeNicknameBackLink');
        backLink.dispatch('click');
        panel.findAll(panel.fieldRowNamed(objectElementNamed(panel, 'Quote_NickName'), 'AccountId'), 'treeNicknameMenuItem')[0].dispatch('click');
        expect(objectElementNamed(panel, SMB).scrolledIntoViewCount).toBe(1);

    });

    test('after wiring, the SMB block lists Quote.AccountId among the fields that point to it, and the Enterprise block no longer does', () => {

        const panel = renderRecipe(wireQuoteOpportunityId(GENERATED_RECIPE, SMB));

        expect(listFieldsPointingTo(panel, SMB)).toContain('AccountId');
        expect(listFieldsPointingTo(panel, ENTERPRISE)).not.toContain('AccountId');

    });

    test('the recipe line is left as generated: only the cockpit follows the lookup', () => {

        const wiredRecipe = wireQuoteOpportunityId(GENERATED_RECIPE, SMB);

        expect(wiredRecipe.split('\n')).toContain(GENERATED_ACCOUNT_ID_LINE);
        expect(wiredRecipe.split('\n')).toContain(`    OpportunityId: ${SMB}`);

    });

    test('a child copy\'s reference() names the block the row follows', () => {

        const panel = renderRecipe(buildSnowfakeryQuoteRecipe([`    OpportunityId: Opportunity_Reference_\${{reference(${SMB}).id}}`]));

        expect(readQuoteAccountIdRow(panel).backLinks).toEqual([`↖ ${SMB}`]);

    });

    test.each([
        ['a faker expression', '${{fake.uuid4}}'],
        ['a YAML keyword', 'true'],
        ['a reference() in a YAML comment', `\${{fake.uuid4}} # was reference(${SMB})`]
    ])('with %s in OpportunityId, the row stays as it is today', (unusedCase, opportunityIdValue) => {

        const panel = renderRecipe(buildSnowfakeryQuoteRecipe([`    OpportunityId: ${opportunityIdValue}`]));

        expect(readQuoteAccountIdRow(panel)).toEqual({
            backLinks: [`↖ ${ENTERPRISE}`],
            notes: [`${RECIPE_COCKPIT_DERIVED_FIELD_REASON_PREFIX}OpportunityId → Account_NickName`]
        });

    });

    test('with a nickname no row holds in OpportunityId, the row links to nothing rather than to the block its own value names', () => {

        const panel = renderRecipe(buildSnowfakeryQuoteRecipe(['    OpportunityId: Opportunity_Missing_NickName']));

        expect(readQuoteAccountIdRow(panel)).toEqual({
            backLinks: [],
            notes: [`${RECIPE_COCKPIT_DERIVED_FIELD_REASON_PREFIX}OpportunityId`]
        });

    });

});
