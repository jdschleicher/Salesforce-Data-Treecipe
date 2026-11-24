import type * as vscode from 'vscode';
import type { XMLFieldDetail } from '../XMLProcessingService/XMLFieldDetail';
import type { RecordTypeWrapper } from '../ObjectInfoWrapper/RecordTypesWrapper';
import type { IValidationRuleAnalysis } from '../ValidationRuleAnalyzerService/ValidationRuleAnalyzerService';

/*
    What one click's recipe builds read of the object metadata (#702). "A data set for each record
    type" walks the metadata once per set; with a snapshot each file is read and parsed by the first
    walk, and the later walks build their recipes from memory. It lives for one click only, so a
    recipe always matches the metadata as it is when the reader clicks.
*/
export class ObjectMetadataSnapshot {

    private readonly directoryEntriesByPath = new Map<string, Promise<[string, vscode.FileType][]>>();
    private readonly fieldXmlDetailByPath = new Map<string, Promise<XMLFieldDetail>>();
    private readonly recordTypesByFieldsDirectoryPath = new Map<string, Promise<Record<string, RecordTypeWrapper>>>();
    private readonly validationRuleAnalysesByObjectDirectoryPath = new Map<string, Promise<IValidationRuleAnalysis[]>>();

    async readDirectoryEntries(directoryPath: string, read: () => Promise<[string, vscode.FileType][]>): Promise<[string, vscode.FileType][]> {

        const directoryEntries = await ObjectMetadataSnapshot.readOnce(this.directoryEntriesByPath, directoryPath, read);
        return directoryEntries ? [...directoryEntries] : directoryEntries;

    }

    // A COPY EACH TIME: THE WALK SETS A STANDARD FIELD'S PARENT AND READ-ONLY REASON ON THE DETAIL IT IS HANDED
    async readFieldXmlDetail(fieldFilePath: string, read: () => Promise<XMLFieldDetail>): Promise<XMLFieldDetail> {

        const fieldXmlDetail = await ObjectMetadataSnapshot.readOnce(this.fieldXmlDetailByPath, fieldFilePath, read);
        return Object.assign(Object.create(Object.getPrototypeOf(fieldXmlDetail)), structuredClone(fieldXmlDetail));

    }

    // SHARED, NOT COPIED: NOTHING CHANGES A RECORD TYPE MAP ONCE RecordTypeService HAS BUILT IT
    readRecordTypes(fieldsDirectoryPath: string, read: () => Promise<Record<string, RecordTypeWrapper>>): Promise<Record<string, RecordTypeWrapper>> {

        return ObjectMetadataSnapshot.readOnce(this.recordTypesByFieldsDirectoryPath, fieldsDirectoryPath, read);

    }

    readValidationRuleAnalyses(objectDirectoryPath: string, read: () => Promise<IValidationRuleAnalysis[]>): Promise<IValidationRuleAnalysis[]> {

        return ObjectMetadataSnapshot.readOnce(this.validationRuleAnalysesByObjectDirectoryPath, objectDirectoryPath, read);

    }

    private static readOnce<T>(readsByPath: Map<string, Promise<T>>, metadataPath: string, read: () => Promise<T>): Promise<T> {

        const earlierRead = readsByPath.get(metadataPath);
        if ( earlierRead ) {
            return earlierRead;
        }
        const firstRead = read();
        readsByPath.set(metadataPath, firstRead);
        return firstRead;

    }

}
