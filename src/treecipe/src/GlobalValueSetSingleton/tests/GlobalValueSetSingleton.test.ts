import { GlobalValueSetSingleton } from "../GlobalValueSetSingleton";


describe("Shared GlobalValueSetSingletonService Tests", () => {

    // let globalValueSetSingleton = new GlobalValueSetSingleton();

    describe("initialize", () => {

        test("given expected 'globalValueSets' directory with expected globalValueSet markup files, sets expected globalValueSet initialization values and isInitialized is set to true", () => {

            // globalValueSetSingleton

            
        });

    });

    describe("getInstance", () => {

        test("given getInstance is called, expected instance of GlobalValueSetSingleton is set", () => {

            let globalValueSetSingleton = GlobalValueSetSingleton.getInstance();
            expect(globalValueSetSingleton).toBeInstanceOf(GlobalValueSetSingleton);
        
        });

    });
    
});