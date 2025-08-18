import { IPicklistValue } from "../ObjectInfoWrapper/FieldInfo";

export class GlobalValueSetSingleton {

    private static instance: GlobalValueSetSingleton | null = null;
    private globalValueSets: Record<string, IPicklistValue[]>;
    private isInitialized: any;

    private constructor() {}

    async initialize(): Promise<void> {

        if ( this.isInitialized ) {
            return;
        }

        this.globalValueSets = await this.getPicklistValueMapsFromLocalProjectGlobalValueSetDirectory();  // get the stuff

        this.isInitialized = true;

    }

    static getInstance(): GlobalValueSetSingleton {
        
        if (!GlobalValueSetSingleton.instance) {
            GlobalValueSetSingleton.instance = new GlobalValueSetSingleton();
        }

        return GlobalValueSetSingleton.instance;

    }

    private async getPicklistValueMapsFromLocalProjectGlobalValueSetDirectory():Promise<Record<string, IPicklistValue[]>> {

        const picklistApiNamesByPicklistValues: Record<string, IPicklistValue[]> = {};
        return await picklistApiNamesByPicklistValues;

    }

    getPicklistValueMaps() {
        return this.globalValueSets;
    }


}