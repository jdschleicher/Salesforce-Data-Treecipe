
export class GlobalValueSetSingleton {

    private static instance: GlobalValueSetSingleton | null = null;
    private static globalValueSets: any[];
    private static isInitialized: any;

    private constructor() {}

    static async initialize(): Promise<void> {

        if ( this.isInitialized ) {
            return;
        }

        this.globalValueSets =  [];

        this.isInitialized = true;

    }

    static getInstance(): GlobalValueSetSingleton {
        
        if (!GlobalValueSetSingleton.instance) {
            GlobalValueSetSingleton.instance = new GlobalValueSetSingleton();
        }

        return GlobalValueSetSingleton.instance;

    }


}