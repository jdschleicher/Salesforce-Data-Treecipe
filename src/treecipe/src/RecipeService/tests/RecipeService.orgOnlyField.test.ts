jest.mock('vscode', () => ({}), { virtual: true });

import { RecipeService } from "../RecipeService";
import { XMLFieldDetail } from "../../XMLProcessingService/XMLFieldDetail";
import { FakerJSRecipeFakerService } from "../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService";
import { SnowfakeryRecipeFakerService } from "../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService";
import { RecipeCockpitRecipeWriter } from "../../RecipeCockpitService/RecipeCockpitRecipeWriter";

const buildFieldDetail = (fieldDetail: Partial<XMLFieldDetail>): XMLFieldDetail => Object.assign(new XMLFieldDetail(), { apiName: 'New_Field__c', fieldLabel: 'New Field', xmlMarkup: '', ...fieldDetail });

describe.each([
    ['faker-js', () => new FakerJSRecipeFakerService(), '${{ faker.lorem.text(80).substring(0, 80) }}'],
    ['snowfakery', () => new SnowfakeryRecipeFakerService(), '${{fake.text(max_nb_chars=80)}}']
])('getOrgOnlyFieldExpression with %s (#446)', (_backend, createFakerService, textExpression) => {

    const recipeService = new RecipeService(createFakerService());

    test('a Text(80) field is offered the expression the backend writes for Text(80)', () => {
        const expression = recipeService.getOrgOnlyFieldExpression(buildFieldDetail({ fieldType: 'Text', length: 80 }));
        expect(expression).toBe(textExpression);
        expect(expression).toBe(recipeService.getRecipeFakeValueByXMLFieldDetail(buildFieldDetail({ fieldType: 'Text', length: 80 }), {}));
    });

    test.each([
        ['Checkbox', {}],
        ['Number', { precision: 5, scale: 0 }],
        ['Currency', { precision: 10, scale: 2 }],
        ['Date', {}],
        ['Email', {}]
    ])('a %s field is offered one expression held to checkConstrainedExpression', (fieldType, sizes) => {
        const expression = recipeService.getOrgOnlyFieldExpression(buildFieldDetail({ fieldType: fieldType, ...sizes }));
        expect(expression).toBeDefined();
        expect(RecipeCockpitRecipeWriter.checkConstrainedExpression(expression as string)).toBeUndefined();
    });

    test('an unknown type is offered no expression', () => {
        expect(recipeService.getOrgOnlyFieldExpression(buildFieldDetail({ fieldType: 'Hologram' }))).toBeUndefined();
        expect(recipeService.getOrgOnlyFieldExpression(buildFieldDetail({ fieldType: '' }))).toBeUndefined();
    });

    test('a picklist whose file lists no values is offered no expression', () => {
        expect(recipeService.getOrgOnlyFieldExpression(buildFieldDetail({ fieldType: 'Picklist', globalValueSetName: 'Not_Loaded' }))).toBeUndefined();
        expect(recipeService.getOrgOnlyFieldExpression(buildFieldDetail({ fieldType: 'MultiselectPicklist' }))).toBeUndefined();
    });

});

describe('getOrgOnlyFieldExpression per backend (#446)', () => {

    test('a faker-js picklist is one arrayElement expression of its values', () => {
        const recipeService = new RecipeService(new FakerJSRecipeFakerService());
        const expression = recipeService.getOrgOnlyFieldExpression(buildFieldDetail({
            fieldType: 'Picklist',
            picklistValues: [{ picklistOptionApiName: 'Frozen', label: 'Frozen' }, { picklistOptionApiName: 'Fresh', label: 'Fresh' }]
        }));
        expect(expression).toContain('Frozen');
        expect(expression).toContain('Fresh');
        expect(RecipeCockpitRecipeWriter.checkConstrainedExpression(expression as string)).toBeUndefined();
    });

    test('a snowfakery picklist is one random_choice expression of its values', () => {
        const recipeService = new RecipeService(new SnowfakeryRecipeFakerService());
        expect(recipeService.getOrgOnlyFieldExpression(buildFieldDetail({
            fieldType: 'Picklist',
            picklistValues: [{ picklistOptionApiName: 'Frozen', label: 'Frozen' }]
        }))).toBe("${{ random_choice('Frozen') }}");
    });

    test('an expression longer than checkConstrainedExpression allows is offered no expression', () => {
        const recipeService = new RecipeService(new FakerJSRecipeFakerService());
        const picklistValues = Array.from({ length: 200 }, (_value, valueIndex) => ({ picklistOptionApiName: `Value_${valueIndex}`, label: `Value ${valueIndex}` }));
        expect(recipeService.getOrgOnlyFieldExpression(buildFieldDetail({ fieldType: 'Picklist', picklistValues: picklistValues }))).toBeUndefined();
    });

    test('a backend that throws is offered no expression', () => {
        const recipeService = new RecipeService(new FakerJSRecipeFakerService());
        jest.spyOn(recipeService, 'getRecipeFakeValueByXMLFieldDetail').mockImplementation(() => { throw new Error('boom'); });
        expect(recipeService.getOrgOnlyFieldExpression(buildFieldDetail({ fieldType: 'Text', length: 80 }))).toBeUndefined();
    });

});
